const jwt = require('jsonwebtoken')
const crypto = require('crypto')

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET

// Fail-fast: jangan pernah jalan pakai secret default yang gampang ditebak.
// Kalau env belum di-set (misal lupa waktu deploy), server harus langsung
// crash saat start, bukan diam-diam jalan dengan secret lemah.
if (!ACCESS_SECRET || ACCESS_SECRET.length < 32) {
  throw new Error('JWT_ACCESS_SECRET belum di-set atau kurang dari 32 karakter. Cek file .env.')
}
if (!REFRESH_SECRET || REFRESH_SECRET.length < 32) {
  throw new Error('JWT_REFRESH_SECRET belum di-set atau kurang dari 32 karakter. Cek file .env.')
}

const generateAccessToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, role: user.role }, ACCESS_SECRET, { expiresIn: '1d' })

const generateRefreshToken = (userId) =>
  jwt.sign({ sub: userId, jti: crypto.randomUUID() }, REFRESH_SECRET, { expiresIn: '7d' })

const verifyAccessToken  = (t) => jwt.verify(t, ACCESS_SECRET)
const verifyRefreshToken = (t) => jwt.verify(t, REFRESH_SECRET)

module.exports = { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken, REFRESH_EXP_MS: 7*24*60*60*1000 }
