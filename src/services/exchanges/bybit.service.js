const ccxt = require('ccxt')

// ─── HELPER: buat client ccxt ────────────────────────────────────────────────
// futures = true -> pakai defaultType 'swap' (Bybit USDT Perpetual / Linear Futures)
// NOTE: Bybit beda sama Binance — istilahnya bukan 'future' tapi 'swap' di ccxt
const makeClient = (apiKey, apiSecret, { futures = false } = {}) => {
  return new ccxt.bybit({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true, // ccxt otomatis atur delay antar request sesuai limit exchange
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
const testConnection = async (apiKey, apiSecret) => {
  const client = makeClient(apiKey, apiSecret)
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
      message:     'Koneksi Bybit berhasil!',
      accountType: balance.info?.result?.list?.[0]?.accountType,
      balances:    balances.slice(0, 10),
      totalAssets: balances.length,
    }
  } catch (err) {
    throw { status: 400, message: `Bybit error: ${err.message}` }
  }
}

// ─── SPOT ────────────────────────────────────────────────────────────────────
// Bybit v5 (/v5/execution/list): startTime-endTime MAX 7 HARI per request
// Data retention: bisa query sampai 2 tahun ke belakang, tapi tetap per-chunk 7 hari
const fetchSpotTrades = async (apiKey, apiSecret, symbol, options = {}) => {
  const { limit = 1000, startTime, endTime } = options
  const client       = makeClient(apiKey, apiSecret)
  const ccxtSymbol   = toCcxtSymbol(symbol)

  // Kalau tidak ada range waktu, langsung fetch (dapat trade terbaru)
  if (!startTime) {
    try {
      const trades = await client.fetchMyTrades(ccxtSymbol, undefined, limit)
      return mapSpotTrades(trades)
    } catch (err) {
      throw { status: 400, message: `Bybit error: ${err.message}` }
    }
  }

  // Loop per 7 hari (batasan Bybit v5 kalau pakai startTime+endTime)
  const MS_7_DAYS  = 7 * 24 * 60 * 60 * 1000
  const rangeEnd   = endTime || Date.now()
  let cursor       = startTime
  const allTrades  = []

  while (cursor < rangeEnd) {
    const chunkEnd = Math.min(cursor + MS_7_DAYS - 1, rangeEnd)
    try {
      const trades = await client.fetchMyTrades(ccxtSymbol, cursor, 1000, { until: chunkEnd })
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
  externalTradeId: `BYBIT-SPOT-${t.id}`,
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
  exchange:        'Bybit Spot',
  raw:             t.info,
}))

// ─── FUTURES (Linear Perpetual / USDT-M) ──────────────────────────────────────
// Bybit Futures:
//   - Query bisa mundur sampai 2 tahun (tergantung tier akun)
//   - startTime-endTime tetap MAX 7 HARI per request, sama kayak spot
//   - Kalau tidak ada range: dapat trade terbaru
const fetchFuturesTrades = async (apiKey, apiSecret, symbol, options = {}) => {
  const MS_2_YEARS = 2 * 365 * 24 * 60 * 60 * 1000
  const MS_7_DAYS  = 7  * 24 * 60 * 60 * 1000
  const now        = Date.now()

  const client     = makeClient(apiKey, apiSecret, { futures: true })
  const ccxtSymbol = toCcxtSymbol(symbol)

  // Clamp startTime — jaga-jaga biar gak query lebih jauh dari yang didukung
  let startTime = options.startTime
  if (!startTime || (now - startTime) > MS_2_YEARS) {
    startTime = now - MS_2_YEARS
    console.warn(`[FUTURES] startTime di-clamp ke 2 tahun terakhir: ${new Date(startTime).toISOString()}`)
  }

  const rangeEnd  = options.endTime || now
  let cursor      = startTime
  const allTrades = []

  // Loop per 7 hari
  while (cursor < rangeEnd) {
    const chunkEnd = Math.min(cursor + MS_7_DAYS - 1, rangeEnd)
    try {
      const trades = await client.fetchMyTrades(ccxtSymbol, cursor, 1000, { until: chunkEnd })
      allTrades.push(...trades)
    } catch (err) {
      console.warn(`[FUTURES] chunk ${new Date(cursor).toISOString()} error: ${err.message}`)
    }
    cursor = chunkEnd + 1
  }

  return mapFuturesTrades(allTrades)
}

const mapFuturesTrades = (trades) => trades.map(t => ({
  externalTradeId: `BYBIT-FUT-${t.id}`,
  symbol:          fromCcxtSymbol(t.symbol),
  instrumentType:  'crypto_futures',
  tradeType:       t.side === 'buy' ? 'long' : 'short',
  entryPrice:      t.price,
  exitPrice:       null,
  quantity:        t.amount,
  realizedPnl:     parseFloat(t.info?.closedPnl || 0),
  commission:      t.fee?.cost || 0,
  tradeDate:       new Date(t.timestamp).toISOString(),
  positionSide:    t.info?.side, // Buy / Sell dari sisi eksekusi (bukan hedge mode field kayak Binance)
  exchange:        'Bybit Futures',
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

const detectTradedSymbols = async (apiKey, apiSecret) => {
  const client = makeClient(apiKey, apiSecret)
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
const detectFuturesSymbols = async (apiKey, apiSecret) => {
  const client = makeClient(apiKey, apiSecret, { futures: true })
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
const importAll = async (apiKey, apiSecret, options = {}) => {
  const { sinceDate, symbols, includeFutures = false } = options
  const startTime = sinceDate ? new Date(sinceDate).getTime() : undefined

  // Spot symbols
  let spotSymbols = symbols?.length > 0
    ? symbols
    : await detectTradedSymbols(apiKey, apiSecret)

  const result = { spot: [], futures: [], errors: [] }

  // ── SPOT ──
  for (const symbol of spotSymbols) {
    try {
      const spot = await fetchSpotTrades(apiKey, apiSecret, symbol, { startTime })
      result.spot.push(...spot)
    } catch (err) {
      result.errors.push({ symbol, type: 'spot', error: err.message })
    }
  }

  // ── FUTURES ──
  if (includeFutures) {
    let futSymbols = symbols?.length > 0
      ? symbols
      : await detectFuturesSymbols(apiKey, apiSecret)

    for (const symbol of futSymbols) {
      try {
        const futures = await fetchFuturesTrades(apiKey, apiSecret, symbol, { startTime })
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