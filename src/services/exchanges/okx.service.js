const ccxt = require('ccxt')

// ─── HELPER: buat client ccxt ────────────────────────────────────────────────
// futures = true -> pakai defaultType 'swap' (OKX USDT-Margined Perpetual)
// PENTING: OKX WAJIB pakai apiPassphrase (bukan cuma apiKey + apiSecret)
// — ini kolom `apiPassphrase` yang udah disiapin di model ExchangeAccount
const makeClient = (apiKey, apiSecret, apiPassphrase, { futures = false } = {}) => {
  return new ccxt.okx({
    apiKey,
    secret:     apiSecret,
    password:   apiPassphrase, // ccxt nyebutnya 'password', bukan 'passphrase'
    enableRateLimit: true,
    options: { defaultType: futures ? 'swap' : 'spot' },
  })
}

// HELPER: convert 'BTCUSDT' -> 'BTC/USDT' (ccxt pakai unified symbol pakai slash)
const QUOTES = ['USDT', 'USDC', 'BTC', 'ETH', 'DAI', 'EUR']
const toCcxtSymbol = (raw) => {
  const s = raw.toUpperCase()
  if (s.includes('/')) return s
  const quote = QUOTES.find(q => s.endsWith(q) && s.length > q.length)
  if (!quote) throw { status: 400, message: `Simbol "${raw}" tidak dikenali` }
  return `${s.slice(0, s.length - quote.length)}/${quote}`
}
const fromCcxtSymbol = (symbol) => symbol.replace('/', '').replace(/:.*$/, '') // buang :USDT suffix perpetual kalau ada

//  TEST CONNECTION
// NOTE: signature beda dari exchange lain — OKX butuh apiPassphrase juga
const testConnection = async (apiKey, apiSecret, apiPassphrase) => {
  const client = makeClient(apiKey, apiSecret, apiPassphrase)
  try {
    const balance = await client.fetchBalance()

    const balances = Object.keys(balance.total || {})
      .filter(asset => (balance.total[asset] || 0) > 0)
      .map(asset => ({
        asset,
        free:   balance.free?.[asset]  || 0,
        locked: balance.used?.[asset]  || 0,
      }))

    return {
      success:     true,
      message:     'Koneksi OKX berhasil!',
      balances:    balances.slice(0, 10),
      totalAssets: balances.length,
    }
  } catch (err) {
    throw { status: 400, message: `OKX error: ${err.message}` }
  }
}

// ─── SPOT ────────────────────────────────────────────────────────────────────
// OKX (/api/v5/trade/fills): endpoint default cuma nyimpen riwayat 3 HARI terakhir!
// Kalau butuh histori lebih lama (sampai 3 bulan), ccxt bisa dipaksa pakai
// endpoint 'fills-history' lewat params — tapi endpoint ini kadang butuh
// approval/akses tambahan dari OKX buat akun tertentu.
const fetchSpotTrades = async (apiKey, apiSecret, apiPassphrase, symbol, options = {}) => {
  const { limit = 1000, startTime, endTime, useHistoryEndpoint = false } = options
  const client       = makeClient(apiKey, apiSecret, apiPassphrase)
  const ccxtSymbol   = toCcxtSymbol(symbol)
  const params       = useHistoryEndpoint ? { method: 'privateGetTradeFillsHistory' } : {}

  // Kalau tidak ada range waktu, langsung fetch (dapat trade terbaru, max 3 hari)
  if (!startTime) {
    try {
      const trades = await client.fetchMyTrades(ccxtSymbol, undefined, limit, params)
      return mapSpotTrades(trades)
    } catch (err) {
      throw { status: 400, message: `OKX error: ${err.message}` }
    }
  }

  // Loop per 3 hari (batasan endpoint 'fills' default OKX)
  const MS_3_DAYS  = 3 * 24 * 60 * 60 * 1000
  const rangeEnd   = endTime || Date.now()
  let cursor       = startTime
  const allTrades  = []

  while (cursor < rangeEnd) {
    const chunkEnd = Math.min(cursor + MS_3_DAYS - 1, rangeEnd)
    try {
      const trades = await client.fetchMyTrades(ccxtSymbol, cursor, 1000, { ...params, until: chunkEnd })
      allTrades.push(...trades)
    } catch (err) {
      console.warn(`[SPOT] chunk ${new Date(cursor).toISOString()} error: ${err.message}`)
    }
    cursor = chunkEnd + 1
    // enableRateLimit di ccxt sudah handle delay, tidak perlu setTimeout manual
  }

  return mapSpotTrades(allTrades)
}

const mapSpotTrades = (trades) => trades.map(t => ({
  externalTradeId: `OKX-SPOT-${t.id}`,
  symbol:          fromCcxtSymbol(t.symbol),
  instrumentType:  'crypto',
  tradeType:       t.side, // 'buy' | 'sell'
  entryPrice:      t.price,
  exitPrice:       null,
  quantity:        t.amount,
  commission:      t.fee?.cost || 0,
  commissionAsset: t.fee?.currency,
  tradeDate:       new Date(t.timestamp).toISOString(),
  isMaker:         t.takerOrMaker === 'maker',
  exchange:        'OKX Spot',
  raw:             t.info,
}))

// ─── FUTURES (USDT-Margined Perpetual Swap) ───────────────────────────────────
// OKX Futures: sama kayak spot, endpoint default cuma 3 hari ke belakang.
// Kalau perlu histori panjang, pakai 'fills-history' (max 3 bulan, butuh akses).
const fetchFuturesTrades = async (apiKey, apiSecret, apiPassphrase, symbol, options = {}) => {
  const MS_3_MONTHS = 3 * 30 * 24 * 60 * 60 * 1000
  const MS_3_DAYS   = 3  * 24 * 60 * 60 * 1000
  const now         = Date.now()

  const client       = makeClient(apiKey, apiSecret, apiPassphrase, { futures: true })
  const ccxtSymbol   = toCcxtSymbol(symbol)
  const useHistory   = options.useHistoryEndpoint ?? true
  const params       = useHistory ? { method: 'privateGetTradeFillsHistory' } : {}

  // Clamp startTime — OKX fills-history hanya support 3 bulan terakhir
  let startTime = options.startTime
  if (!startTime || (now - startTime) > MS_3_MONTHS) {
    startTime = now - MS_3_MONTHS
    console.warn(`[FUTURES] startTime di-clamp ke 3 bulan terakhir: ${new Date(startTime).toISOString()}`)
  }

  const rangeEnd  = options.endTime || now
  let cursor      = startTime
  const allTrades = []

  // Loop per 3 hari
  while (cursor < rangeEnd) {
    const chunkEnd = Math.min(cursor + MS_3_DAYS - 1, rangeEnd)
    try {
      const trades = await client.fetchMyTrades(ccxtSymbol, cursor, 1000, { ...params, until: chunkEnd })
      allTrades.push(...trades)
    } catch (err) {
      console.warn(`[FUTURES] chunk ${new Date(cursor).toISOString()} error: ${err.message}`)
    }
    cursor = chunkEnd + 1
  }

  return mapFuturesTrades(allTrades)
}

const mapFuturesTrades = (trades) => trades.map(t => ({
  externalTradeId: `OKX-FUT-${t.id}`,
  symbol:          fromCcxtSymbol(t.symbol),
  instrumentType:  'crypto_futures',
  tradeType:       t.side === 'buy' ? 'long' : 'short',
  entryPrice:      t.price,
  exitPrice:       null,
  quantity:        t.amount,
  realizedPnl:     parseFloat(t.info?.fillPnl || 0),
  commission:      t.fee?.cost || 0,
  tradeDate:       new Date(t.timestamp).toISOString(),
  positionSide:    t.info?.posSide, // long / short / net (tergantung mode akun)
  exchange:        'OKX Futures',
  raw:             t.info,
}))

// ─── AUTO-DETECT TRADED SYMBOLS ──────────────────────────────────────────────
const POPULAR_PAIRS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT',
  'DOGEUSDT','MATICUSDT','DOTUSDT','AVAXUSDT','SHIBUSDT',
  'LTCUSDT','LINKUSDT','UNIUSDT','ATOMUSDT','NEARUSDT',
  'ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','APTUSDT',
  'TIAUSDT','SEIUSDT','STXUSDT','RUNEUSDT','PEPEUSDT',
]

const detectTradedSymbols = async (apiKey, apiSecret, apiPassphrase) => {
  const client = makeClient(apiKey, apiSecret, apiPassphrase)
  const traded = []

  for (const sym of POPULAR_PAIRS) {
    try {
      const trades = await client.fetchMyTrades(toCcxtSymbol(sym), undefined, 1)
      if (trades.length > 0) traded.push(sym)
    } catch {}
  }

  return traded
}

// Auto-detect untuk futures — cek dari account positions
const detectFuturesSymbols = async (apiKey, apiSecret, apiPassphrase) => {
  const client = makeClient(apiKey, apiSecret, apiPassphrase, { futures: true })
  try {
    const positions = await client.fetchPositions()
    return positions
      .filter(p => (p.contracts && p.contracts > 0) || (p.entryPrice && p.entryPrice > 0))
      .map(p => fromCcxtSymbol(p.symbol))
  } catch (err) {
    console.warn('[FUTURES] detectFuturesSymbols gagal, pakai popular list:', err.message)
    return ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT',
            'DOGEUSDT','LINKUSDT','AVAXUSDT','ARBUSDT','SUIUSDT']
  }
}

// ─── IMPORT ALL ───────────────────────────────────────────────────────────────
const importAll = async (apiKey, apiSecret, apiPassphrase, options = {}) => {
  const { sinceDate, symbols, includeFutures = false } = options
  const startTime = sinceDate ? new Date(sinceDate).getTime() : undefined

  // Spot symbols
  let spotSymbols = symbols?.length > 0
    ? symbols
    : await detectTradedSymbols(apiKey, apiSecret, apiPassphrase)

  const result = { spot: [], futures: [], errors: [] }

  // ── SPOT ──
  for (const symbol of spotSymbols) {
    try {
      const spot = await fetchSpotTrades(apiKey, apiSecret, apiPassphrase, symbol, { startTime })
      result.spot.push(...spot)
    } catch (err) {
      result.errors.push({ symbol, type: 'spot', error: err.message })
    }
  }

  // ── FUTURES ──
  if (includeFutures) {
    let futSymbols = symbols?.length > 0
      ? symbols
      : await detectFuturesSymbols(apiKey, apiSecret, apiPassphrase)

    for (const symbol of futSymbols) {
      try {
        const futures = await fetchFuturesTrades(apiKey, apiSecret, apiPassphrase, symbol, { startTime })
        result.futures.push(...futures)
      } catch (err) {
        result.errors.push({ symbol, type: 'futures', error: err.message })
      }
    }
  }

  return {
    trades:       [...result.spot, ...result.futures],
    spotCount:    result.spot.length,
    futuresCount: result.futures.length,
    errors:       result.errors,
    symbols:      spotSymbols,
  }
}

module.exports = { testConnection, fetchSpotTrades, fetchFuturesTrades, detectTradedSymbols, detectFuturesSymbols, importAll }