const prisma    = require('../utils/prisma')
const crypto    = require('crypto')
const exchanges = require('./exchanges')

// ENKRIPSI / DEKRIPSI API KEY
// AES-256-GCM dipakai (bukan CBC) karena GCM punya auth tag bawaan —
// jadi ciphertext yang dimodifikasi/dipalsukan bakal ketauan (integrity check),
// gak cuma confidentiality doang seperti CBC polos.
const ALGORITHM = 'aes-256-gcm'

// ENCRYPTION_KEY WAJIB di-set di .env, minimal 32 byte kalau di-hex-kan jadi 64 karakter.
// Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const RAW_KEY = process.env.ENCRYPTION_KEY
if (!RAW_KEY || RAW_KEY.length < 32) {
  throw new Error('ENCRYPTION_KEY belum di-set atau kurang dari 32 karakter. Cek file .env.')
}
// Derive 32-byte key yang konsisten dari string env (support hex 64-char atau string biasa)
const KEY = crypto.createHash('sha256').update(RAW_KEY).digest()

const encrypt = (text) => {
  if (!text) return null
  const iv     = crypto.randomBytes(12) // 96-bit IV, rekomendasi standar buat GCM
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${enc.toString('hex')}:${authTag.toString('hex')}`
}

const decrypt = (text) => {
  if (!text) return null
  try {
    const [ivHex, encHex, tagHex] = text.split(':')
    if (!ivHex || !encHex || !tagHex) return null // format lama (CBC) atau corrupt — tolak
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    // termasuk kalau auth tag gak cocok (ciphertext dimanipulasi) → gagal decrypt
    return null
  }
}

// CEK AKSES FITUR EXCHANGE
const assertAccess = async (userId) => {
  const sub = await prisma.userSubscription.findFirst({
    where: { userId, status: 'active', endDate: { gt: new Date() } },
    include: { plan: true },
  })
  const feat = (sub?.plan?.features || []).find(f => f.key === 'exchange_connect')
  if (!feat || !feat.value) {
    throw { status: 403, message: 'Koneksi exchange hanya tersedia di paket Pro dan Elite. Upgrade untuk menggunakan fitur ini.' }
  }
}

// GET DECRYPTED CREDENTIALS
const getCredentials = async (accountId, userId) => {
  const account = await prisma.exchangeAccount.findUnique({ where: { id: accountId } })
  if (!account)                  throw { status: 404, message: 'Akun tidak ditemukan.' }
  if (account.userId !== userId) throw { status: 403, message: 'Akses ditolak.' }

  return {
    account,
    apiKey:    decrypt(account.apiKey),
    apiSecret: decrypt(account.apiSecret),
    apiPassphrase: decrypt(account.apiPassphrase),
  }
}

//  CONNECT EXCHANGE ACCOUNT
const connectAccount = async (userId, data) => {
  await assertAccess(userId)

  const { platform, accountName, accountId, apiKey, apiSecret, apiPassphrase, serverName, loginNumber } = data
  const isMt = platform === 'mt4' || platform === 'mt5'

  // Cek duplikat
  const existing = await prisma.exchangeAccount.findFirst({
    where: { userId, platform, ...(accountId ? { accountId } : {}) },
  })
  if (existing) throw { status: 409, message: `Akun ${platform} ini sudah terhubung sebelumnya.` }

  // ── KHUSUS MT4/MT5: provision akun di MetaApi cloud (gantiin EA .mq5) ──
  // Bukan simpan file EA ke MT5 user, tapi bikin "terminal" MT4/5 yang jalan
  // di server MetaApi pakai login/password/server broker yang user kasih.
  // Makanya user tinggal isi form biasa dari HP, gak perlu install apa-apa.
  let metaApiAccountId = null
  if (isMt) {
    if (!loginNumber || !apiSecret || !serverName) {
      throw { status: 400, message: 'Login, password (investor password disarankan), dan nama server broker wajib diisi untuk MT4/MT5.' }
    }
    const metaapi = require('./exchanges/metaapi.service')
    const provisioned = await metaapi.provisionAccount({
      loginNumber, password: apiSecret, serverName, platform, accountName,
    })
    metaApiAccountId = provisioned.metaApiAccountId
  }

  const account = await prisma.exchangeAccount.create({
    data: {
      userId,
      platform,
      accountName,
      accountId:     accountId     || null,
      apiKey:        isMt ? null : (encrypt(apiKey) || null),
      apiSecret:     encrypt(apiSecret)      || null, // password MT juga tetap dienkripsi
      apiPassphrase: encrypt(apiPassphrase)  || null,
      serverName:    serverName    || null,
      loginNumber:   loginNumber   || null,
      status:        isMt ? 'active' : 'pending',
      isReadOnly:    true,
      // MT4/MT5: langsung nyalain auto-sync (cron bakal jalanin sync ulang tiap 30 menit tanpa disuruh lagi)
      autoSync:      isMt ? true : false,
      syncInterval:  isMt ? 30   : 60,
      metadata:      isMt ? { metaApiAccountId } : undefined,
    },
    select: {
      id: true, platform: true, accountName: true,
      accountId: true, status: true, isReadOnly: true,
      autoSync: true, createdAt: true,
    },
  })

  // ── LANGSUNG IMPORT HISTORY PERTAMA KALI SAAT INI JUGA ──
  // Biar user gak perlu manual pencet "import" abis connect — begitu akun kesambung,
  // history trade langsung ketarik saat itu juga. Sync berikutnya diambil alih cron (tiap 30 menit).
  let initialImport = null
  if (isMt) {
    try {
      initialImport = await importTrades(account.id, userId, {})
    } catch (err) {
      // Connect-nya tetap sukses walau import pertama gagal (misal history masih kosong) — gak nge-block response
      console.error(`[CONNECT] Initial import gagal untuk akun ${account.id}: ${err.message}`)
      initialImport = { error: err.message }
    }
  }

  return { ...account, initialImport }
}

//  GET MY CONNECTED ACCOUNTS
const getMyAccounts = async (userId) => {
  return prisma.exchangeAccount.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, platform: true, accountName: true,
      accountId: true, status: true, isReadOnly: true,
      autoSync: true, lastSyncAt: true, lastSyncStatus: true,
      metadata: true, createdAt: true,
    },
  })
}

//  UPDATE ACCOUNT SETTINGS
const updateAccount = async (accountId, userId, data) => {
  const account = await prisma.exchangeAccount.findUnique({ where: { id: accountId } })
  if (!account)                  throw { status: 404, message: 'Akun tidak ditemukan.' }
  if (account.userId !== userId) throw { status: 403, message: 'Akses ditolak.' }

  const { accountName, autoSync, syncInterval } = data
  return prisma.exchangeAccount.update({
    where: { id: accountId },
    data: {
      ...(accountName   !== undefined && { accountName }),
      ...(autoSync      !== undefined && { autoSync }),
      ...(syncInterval  !== undefined && { syncInterval }),
    },
    select: { id: true, platform: true, accountName: true, autoSync: true, syncInterval: true },
  })
}

//  DISCONNECT ACCOUNT
const disconnectAccount = async (accountId, userId) => {
  const { account } = await getCredentials(accountId, userId)

  if ((account.platform === 'mt4' || account.platform === 'mt5') && account.metadata?.metaApiAccountId) {
    const metaapi = require('./exchanges/metaapi.service')
    await metaapi.removeAccount({ metaApiAccountId: account.metadata.metaApiAccountId })
  }

  await prisma.exchangeAccount.delete({ where: { id: accountId } })
  return { disconnected: true, platform: account.platform }
}

//  TEST CONNECTION
const testConnection = async (accountId, userId) => {
  const { account, apiKey, apiSecret } = await getCredentials(accountId, userId)
  const isMt = account.platform === 'mt4' || account.platform === 'mt5'

  let result = { success: false, message: '' }

  try {
    const service = exchanges.getService(account.platform)
    result = isMt
      ? await service.testConnection({ metaApiAccountId: account.metadata?.metaApiAccountId })
      : await service.testConnection(apiKey, apiSecret)
  } catch (err) {
    result = { success: false, message: err.message || 'Koneksi gagal.' }
  }

  // Update status di DB
  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: {
      status:         result.success ? 'active' : 'error',
      lastSyncStatus: result.message,
      lastSyncAt:     new Date(),
      metadata:       result.success ? { balance: result.balances, accountType: result.accountType } : undefined,
    },
  })

  return result
}

//  IMPORT TRADES OTOMATIS — MAIN FUNCTION
const importTrades = async (accountId, userId, options = {}) => {
  const { account, apiKey, apiSecret } = await getCredentials(accountId, userId)
  const isMt = account.platform === 'mt4' || account.platform === 'mt5'

  if (!isMt && (!apiKey || !apiSecret)) {
    throw { status: 400, message: 'API Key tidak ditemukan. Reconnect akun terlebih dahulu.' }
  }
  if (isMt && !account.metadata?.metaApiAccountId) {
    throw { status: 400, message: 'Akun MetaApi belum di-provision. Reconnect akun MT4/MT5 terlebih dahulu.' }
  }

  // Ambil service yang sesuai
  const service = exchanges.getService(account.platform)

  // Fetch trades dari exchange (atau dari MetaApi buat MT4/MT5)
  console.log(`[IMPORT] Fetching trades from ${account.platform}...`)
  const fetched = isMt
    ? await service.importAll(
        { metaApiAccountId: account.metadata.metaApiAccountId, platform: account.platform },
        { sinceDate: options.sinceDate || account.lastSyncAt },
      )
    : await service.importAll(apiKey, apiSecret, {
        sinceDate:      options.sinceDate || account.lastSyncAt,
        symbols:        options.symbols,
        includeFutures: options.includeFutures || false,
      })

  if (!fetched.trades || fetched.trades.length === 0) {
    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date(), lastSyncStatus: 'Tidak ada trade baru ditemukan.' },
    })
    return { imported: 0, skipped: 0, journalId: null, message: 'Tidak ada trade baru.' }
  }

  // Buat satu journal untuk semua trade yang diimport
  const journal = await prisma.journal.create({
    data: {
      userId,
      title:      `Import ${account.platform.charAt(0).toUpperCase() + account.platform.slice(1)} — ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      content:    `Trade diimport otomatis dari ${account.platform} (${account.accountName}) pada ${new Date().toLocaleString('id-ID')}.\n\nTotal fetch: ${fetched.trades.length} trade.\nSymbols: ${fetched.symbols?.join(', ') || 'auto-detect'}.`,
      visibility: 'private',
      tags:       [account.platform, 'auto-import'],
    },
  })

  // Insert trades ke DB
  let imported = 0, skipped = 0
  const { calculatePnL } = require('./instrument.service')

  for (const trade of fetched.trades) {
    try {
      // Skip duplikat berdasarkan externalTradeId
      if (trade.externalTradeId) {
        const dup = await prisma.journalTrade.findFirst({
          where: { exchangeAccountId: accountId, externalTradeId: trade.externalTradeId },
        })
        if (dup) { skipped++; continue }
      }

      // Cari instrument di master data
      const instrument = await prisma.instrument.findFirst({
        where: { symbol: trade.symbol },
      })

      // Hitung PnL kalau ada
      const pnl = calculatePnL({
        instrumentType: trade.instrumentType,
        tradeType:      trade.tradeType,
        entryPrice:     trade.entryPrice,
        exitPrice:      trade.exitPrice || trade.realizedPnl ? trade.entryPrice : null,
        quantity:       trade.quantity,
        commission:     trade.commission || 0,
      })

      await prisma.journalTrade.create({
        data: {
          journalId:        journal.id,
          exchangeAccountId: accountId,
          externalTradeId:  trade.externalTradeId || null,
          instrumentId:     instrument?.id || null,
          instrumentType:   trade.instrumentType || 'crypto',
          symbol:           trade.symbol?.toUpperCase() || 'UNKNOWN',
          symbolName:       instrument?.name || trade.symbol || 'Unknown',
          baseCurrency:     instrument?.baseCurrency || trade.symbol?.replace('USDT','').replace('IDR','') || '',
          quoteCurrency:    instrument?.quoteCurrency || (trade.symbol?.endsWith('IDR') ? 'IDR' : 'USDT'),
          exchange:         account.accountName,
          tradeType:        trade.tradeType,
          entryPrice:       trade.entryPrice,
          exitPrice:        trade.exitPrice || null,
          quantity:         trade.quantity,
          commission:       trade.commission || null,
          swap:             trade.swap || null,
          pnlAmount:        trade.realizedPnl ?? pnl.pnlAmount,
          pnlPercent:       pnl.pnlPercent,
          status:           trade.exitPrice || trade.realizedPnl ? 'closed' : 'open',
          platform:         account.platform,
          tradeDate:        new Date(trade.tradeDate),
          rawData:          trade.raw || null,
        },
      })

      imported++
    } catch (err) {
      console.error(`[IMPORT] Skip trade ${trade.externalTradeId}: ${err.message}`)
      skipped++
    }
  }

  // Update last sync info
  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastSyncAt:     new Date(),
      lastSyncStatus: `✅ Imported ${imported} trades, skipped ${skipped} duplicates.`,
      status:         'active',
    },
  })

  // Notifikasi ke user
  await prisma.notification.create({
    data: {
      userId,
      type:    'trade_import_complete',
      title:   `✅ Import ${account.platform} selesai!`,
      message: `Berhasil import ${imported} trade baru dari ${account.accountName}. ${skipped > 0 ? `${skipped} trade dilewati (duplikat).` : ''}`,
      data:    { accountId, journalId: journal.id, imported, skipped },
    },
  })

  return { imported, skipped, journalId: journal.id, total: fetched.trades.length }
}

//  GET IMPORT HISTORY — riwayat sync per akun
const getImportHistory = async (accountId, userId) => {
  const { account } = await getCredentials(accountId, userId)

  const journals = await prisma.journal.findMany({
    where: {
      userId,
      trades: { some: { exchangeAccountId: accountId } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, title: true, createdAt: true,
      _count: { select: { trades: true } },
    },
  })

  return {
    account: {
      id:            account.id,
      platform:      account.platform,
      accountName:   account.accountName,
      lastSyncAt:    account.lastSyncAt,
      lastSyncStatus: account.lastSyncStatus,
    },
    importHistory: journals,
  }
}

module.exports = {
  connectAccount, getMyAccounts, updateAccount,
  disconnectAccount, testConnection,
  importTrades, getImportHistory,
}
