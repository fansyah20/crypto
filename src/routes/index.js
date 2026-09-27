const router = require('express').Router()

router.use('/auth',        require('./auth.routes'))
router.use('/membership',  require('./membership.routes'))
router.use('/journals',    require('./journal.routes'))
router.use('/trades',      require('./trade.routes'))
router.use('/social',      require('./social.routes'))
router.use('/watchlists',  require('./watchlist.routes'))
router.use('/analytics',   require('./analytics.routes'))
router.use('/advanced',    require('./advanced.routes'))
router.use('/instruments', require('./instrument.routes'))
router.use('/exchanges',   require('./exchange.routes'))
router.use('/market',      require('./price.routes'))
router.use('/news', require('./news.routes'))
router.use('/calculator',  require('./riskCalculator.routes'))
router.use('/calendar',    require('./calendar.routes'))
router.use('/positions', require('./position.routes'))
router.use('/mt', require('./mt.routes'))
router.use('/attestation', require('./attestation.routes'))

router.get('/health', (req, res) => res.json({
  success:   true,
  message:   'TradingJournal API ✅',
  version:   'v2.2',
  features:  ['journal-calendar', 'multi-instrument', 'exchange-integration', 'realtime-prices', 'ai-analysis', 'risk-calculator'],
  timestamp: new Date().toISOString(),
}))

module.exports = router
