const prisma = require('../utils/prisma')
const crypto = require('crypto')
const { computeStatsHash, signAttestation } = require('../utils/attestation')

const getTradeStats = async (userId) => {
  const trades = await prisma.journalTrade.findMany({
    where: { journal: { userId }, status: 'closed' },
    select: { pnlAmount: true },
  })
  const totalTrades = trades.length
  const winCount  = trades.filter(t => Number(t.pnlAmount) > 0).length
  const lossCount = trades.filter(t => Number(t.pnlAmount) <= 0).length
  const totalPnl  = trades.reduce((s, t) => s + Number(t.pnlAmount), 0)
  return { totalTrades, winCount, lossCount, totalPnl, periodEndTimestamp: Math.floor(Date.now() / 1000) }
}

const prepareAttestation = async (userId, walletAddress) => {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user.walletAddress || user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw { status: 403, message: 'Wallet belum terhubung ke akun ini.' }
  }

  const stats = await getTradeStats(userId)
  if (stats.totalTrades < 5) {
    throw { status: 400, message: 'Minimal 5 trade closed dibutuhkan untuk mint attestation.' }
  }

  const hash    = computeStatsHash(stats)
  const nonce   = crypto.randomBytes(4).readUInt32BE()
  const expiry  = Math.floor(Date.now() / 1000) + 15 * 60 // berlaku 15 menit

  const signature = await signAttestation({ walletAddress, hash, nonce, expiry })
  return { stats, hash, nonce, expiry, signature }
}

// Publik — siapa aja bisa cek data TERKINI dan bandingin sama hash on-chain di frontend
const verifyAttestation = async (walletAddress) => {
  const user = await prisma.user.findUnique({ where: { walletAddress: walletAddress.toLowerCase() } })
  if (!user) throw { status: 404, message: 'User dengan wallet ini tidak ditemukan.' }

  const stats = await getTradeStats(user.id)
  return { walletAddress, currentHash: computeStatsHash(stats), stats }
}

module.exports = { prepareAttestation, verifyAttestation }