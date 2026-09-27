const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const prisma = require('../utils/database')
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, REFRESH_EXP_MS } = require('../utils/jwt')
const { OAuth2Client } = require('google-auth-library')
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
const { SiweMessage, generateNonce } = require('siwe')
const SALT_ROUNDS = 12

// REGISTER
const register = async ({ email, username, password }) => {
  const [emailExists, usernameExists] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
  ])
  if (emailExists)    throw { status: 409, message: 'Email sudah terdaftar.' }
  if (usernameExists) throw { status: 409, message: 'Username sudah dipakai.' }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  // BETA MODE: langsung verified, skip email verifikasi
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        username,
        passwordHash,
        isVerified: true,  // langsung aktif tanpa verifikasi email
      },
      select: { id:true, email:true, username:true, role:true, createdAt:true },
    })

    await tx.watchlist.create({
      data: { userId: newUser.id, name: 'Watchlist Utama', isDefault: true },
    })

    await tx.notification.create({
      data: {
        userId:  newUser.id,
        type:    'welcome',
        title:   'Selamat datang di Corex Journal! 🎉',
        message: 'Akun kamu sudah berhasil dibuat. Selamat trading!',
        data:    { action: 'welcome' },
      },
    })

    return newUser
  })

  return { user }
}


// LOGIN
const login = async ({ email, password, userAgent, ip }) => {
  // Fetch user dengan semua field yang dibutuhkan
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id:true, email:true, username:true, passwordHash:true, role:true, isVerified:true, avatarUrl:true },
  })

  // Selalu jalankan bcrypt compare meski user tidak ada — cegah timing attack
  const dummyHash = '$2a$12$dummyhashtopreventtimingattacksonnonexistentaccounts'
  const isValid = await bcrypt.compare(password, user ? user.passwordHash : dummyHash)

  if (!user || !isValid) throw { status: 401, message: 'Email atau password salah.' }

  // Generate kedua token
  const accessToken  = generateAccessToken(user)
  const refreshToken = generateRefreshToken(user.id)

  // Simpan refresh token ke DB dengan TTL
  await prisma.refreshToken.create({
    data: {
      userId:    user.id,
      token:     refreshToken,
      expiresAt: new Date(Date.now() + REFRESH_EXP_MS),
    },
  })

  // Fetch subscription aktif untuk response
  const activeSubscription = await prisma.userSubscription.findFirst({
    where: { userId: user.id, status: 'active', endDate: { gt: new Date() } },
    include: { plan: { select: { name:true, slug:true } } },
  })

  const { passwordHash: _, verifyToken: __, ...safeUser } = user

  return {
    user: { ...safeUser, subscription: activeSubscription?.plan || null },
    accessToken,
    refreshToken,
  }
}

// Dipanggil dari frontend setelah dapat Google ID token (Google Identity Services)
const loginWithGoogle = async ({ idToken }) => {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload() // { sub, email, name, picture, email_verified }
  if (!payload?.email_verified) {
    throw { status: 401, message: 'Email Google belum terverifikasi.' }
  }

  let user = await prisma.user.findFirst({
    where: { OR: [{ provider: 'google', providerId: payload.sub }, { email: payload.email }] },
  })

  if (!user) {
    // Bikin username unik dari email
    const baseUsername = payload.email.split('@')[0]
    let username = baseUsername
    let i = 1
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${baseUsername}${i++}`
    }

    user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: payload.email,
          username,
          avatarUrl: payload.picture,
          isVerified: true,
          provider: 'google',
          providerId: payload.sub,
        },
      })
      await tx.watchlist.create({ data: { userId: newUser.id, name: 'Watchlist Utama', isDefault: true } })
      return newUser
    })
  } else if (user.provider !== 'google') {
    // Email sama tapi daftar dulu via cara lain — link akun Google ke akun itu
    user = await prisma.user.update({
      where: { id: user.id },
      data: { provider: user.provider ?? 'google', providerId: user.providerId ?? payload.sub },
    })
  }

  return issueTokens(user)
}

const loginWithGithub = async ({ code }) => {
  // 1. Tukar authorization code dengan access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw { status: 401, message: 'Gagal autentikasi dengan GitHub.' }

  // 2. Ambil profil user
  const profileRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const profile = await profileRes.json() // { id, login, avatar_url, email, name }

  // 3. GitHub kadang gak return email publik → fetch endpoint /user/emails
  let email = profile.email
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const emails = await emailRes.json()
    email = emails.find(e => e.primary && e.verified)?.email
  }
  if (!email) throw { status: 400, message: 'Akun GitHub tidak punya email publik/terverifikasi.' }

  let user = await prisma.user.findFirst({
    where: { OR: [{ provider: 'github', providerId: String(profile.id) }, { email }] },
  })

  if (!user) {
    let username = profile.login
    let i = 1
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${profile.login}${i++}`
    }
    user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          username,
          avatarUrl: profile.avatar_url,
          isVerified: true,
          provider: 'github',
          providerId: String(profile.id),
        },
      })
      await tx.watchlist.create({ data: { userId: newUser.id, name: 'Watchlist Utama', isDefault: true } })
      return newUser
    })
  } else if (user.provider !== 'github') {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { provider: user.provider ?? 'github', providerId: user.providerId ?? String(profile.id) },
    })
  }

  return issueTokens(user)
}

// STEP A — Frontend minta nonce sebelum bikin pesan SIWE
const getWalletNonce = async (address) => {
  const nonce = generateNonce()
  await prisma.walletNonce.create({
    data: {
      address: address.toLowerCase(),
      nonce,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 menit
    },
  })
  return nonce
}

// STEP B — Frontend kirim message (yang sudah ditandatangani) + signature
const loginWithWallet = async ({ message, signature }) => {
  const siweMessage = new SiweMessage(message)

  // Verifikasi tanda tangan cocok dengan address & domain di pesan
  const result = await siweMessage.verify({ signature, domain: process.env.SIWE_DOMAIN })
  if (!result.success) throw { status: 401, message: 'Signature wallet tidak valid.' }

  const address = siweMessage.address.toLowerCase()

  // Cek nonce yang dipakai memang yang kita terbitkan & belum expired
  const storedNonce = await prisma.walletNonce.findFirst({
    where: { address, nonce: siweMessage.nonce, expiresAt: { gt: new Date() } },
  })
  if (!storedNonce) throw { status: 401, message: 'Nonce tidak valid, sudah dipakai, atau kedaluwarsa.' }

  // Nonce cuma boleh dipakai sekali — hapus setelah dipakai (cegah replay attack)
  await prisma.walletNonce.delete({ where: { id: storedNonce.id } })

  let user = await prisma.user.findUnique({ where: { walletAddress: address } })

  if (!user) {
    const username = `wallet_${address.slice(2, 8)}`
    user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: `${address}@wallet.local`, // placeholder unik — bisa diminta user lengkapi nanti
          username,
          walletAddress: address,
          isVerified: true,
          provider: 'wallet',
        },
      })
      await tx.watchlist.create({ data: { userId: newUser.id, name: 'Watchlist Utama', isDefault: true } })
      return newUser
    })
  }

  return issueTokens(user)
}

// REFRESH TOKEN
const refreshTokens = async (token) => {
  let decoded
  try { decoded = verifyRefreshToken(token) }
  catch { throw { status: 401, message: 'Refresh token tidak valid atau sudah expired.' } }

  // Cek token ada di DB dan belum expired
  const stored = await prisma.refreshToken.findUnique({ where: { token } })
  if (!stored || stored.expiresAt < new Date()) {
    // Hapus kalau sudah invalid
    if (stored) await prisma.refreshToken.delete({ where: { token } })
    throw { status: 401, message: 'Refresh token tidak ditemukan atau sudah kadaluarsa.' }
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: { id:true, email:true, role:true },
  })
  if (!user) throw { status: 401, message: 'User tidak ditemukan.' }

  // Rotate: hapus token lama, buat token baru
  const newAccessToken  = generateAccessToken(user)
  const newRefreshToken = generateRefreshToken(user.id)

  await prisma.$transaction([
    prisma.refreshToken.delete({ where: { token } }),
    prisma.refreshToken.create({
      data: { userId: user.id, token: newRefreshToken, expiresAt: new Date(Date.now() + REFRESH_EXP_MS) },
    }),
  ])

  return { accessToken: newAccessToken, refreshToken: newRefreshToken }
}

// LOGOUT
const logout = async (token) => {
  // Hapus refresh token dari DB — access token expire sendiri
  await prisma.refreshToken.deleteMany({ where: { token } })
}

// LOGOUT ALL DEVICES
const logoutAll = async (userId) => {
  await prisma.refreshToken.deleteMany({ where: { userId } })
}

// VERIFY EMAIL
const verifyEmail = async (token) => {
  const user = await prisma.user.findFirst({
    where: { verifyToken: token },
  })

  if (!user) throw { status: 400, message: 'Token verifikasi tidak valid atau sudah dipakai.' }

  // Cek apakah token sudah expired
  if (user.verifyTokenExpire && user.verifyTokenExpire < new Date()) {
    throw { status: 400, message: 'Token verifikasi sudah kadaluarsa. Minta kirim ulang email verifikasi.' }
  }

  if (user.isVerified) throw { status: 400, message: 'Email sudah diverifikasi sebelumnya.' }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified:         true,
      verifyToken:        null,
      verifyTokenExpire:  null,  // ← hapus token setelah verify
    },
  })
}

// FORGOT PASSWORD
const forgotPassword = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } })
  // Jangan reveal apakah email terdaftar atau tidak
  if (!user) return null

  const resetToken    = crypto.randomBytes(32).toString('hex')
  const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000) // 1 jam

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetTokenExp },
  })

  return { user, resetToken }
}

// RESET PASSWORD 
const resetPassword = async (token, newPassword) => {
  const user = await prisma.user.findFirst({
    where: { resetToken: token, resetTokenExp: { gt: new Date() } },
  })
  if (!user) throw { status: 400, message: 'Token reset tidak valid atau sudah expired.' }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExp: null },
    }),
    // Logout semua device setelah reset password
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ])
}

// TAMBAH fungsi resendVerification
const resendVerification = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } })

  // Jangan reveal apakah email terdaftar atau tidak
  if (!user || user.isVerified) return null

  const verifyToken       = crypto.randomBytes(32).toString('hex')
  const verifyTokenExpire = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 jam

  await prisma.user.update({
    where: { id: user.id },
    data:  { verifyToken, verifyTokenExpire },
  })

  return { user, verifyToken }
}

const issueTokens = async (user) => {
  const accessToken  = generateAccessToken(user)
  const refreshToken = generateRefreshToken(user.id)
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + REFRESH_EXP_MS) },
  })
  const { passwordHash: _, verifyToken: __, ...safeUser } = user
  return { user: safeUser, accessToken, refreshToken }
}

module.exports = {
  register, login, refreshTokens, logout, logoutAll, verifyEmail,
  forgotPassword, resendVerification, resetPassword,
  loginWithGoogle, loginWithGithub, getWalletNonce, loginWithWallet, // ← baru
}