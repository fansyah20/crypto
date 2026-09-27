const authService = require('../services/auth.service')
const { success, error } = require('../utils/response')
const { sendVerificationEmail, sendResetPasswordEmail } = require('../utils/mailer')

// REGISTER - Pendaftaran User Baru
const register = async (req, res) => {
  try {
    const { user } = await authService.register(req.body)
    // BETA MODE: langsung bisa login tanpa verifikasi email
    return success(res, { user }, 'Registrasi berhasil! Silakan login.', 201)
  } catch (err) {
    return error(res, err.message, err.status || 500)
  }
}

// LOGIN
const login = async (req, res) => {
  try {
    const result = await authService.login({
      ...req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    })
    return success(res, result, 'Login berhasil.')
  } catch (err) {
    return error(res, err.message, err.status || 500)
  }
}

const googleLogin = async (req, res) => {
  try {
    const result = await authService.loginWithGoogle(req.body)
    return success(res, result, 'Login Google berhasil.')
  } catch (err) { return error(res, err.message, err.status || 500) }
}

const githubLogin = async (req, res) => {
  try {
    const result = await authService.loginWithGithub(req.body)
    return success(res, result, 'Login GitHub berhasil.')
  } catch (err) { return error(res, err.message, err.status || 500) }
}

const walletNonce = async (req, res) => {
  try {
    const { address } = req.query
    if (!address) return error(res, 'Wallet address dibutuhkan.', 400)
    const nonce = await authService.getWalletNonce(address)
    return success(res, { nonce }, 'Nonce dibuat.')
  } catch (err) { return error(res, err.message, err.status || 500) }
}

const walletLogin = async (req, res) => {
  try {
    const result = await authService.loginWithWallet(req.body)
    return success(res, result, 'Login wallet berhasil.')
  } catch (err) { return error(res, err.message, err.status || 401) }
}


// REFRESH TOKEN
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) return error(res, 'Refresh token dibutuhkan.', 400)
    const tokens = await authService.refreshTokens(refreshToken)
    return success(res, tokens, 'Token berhasil diperbarui.')
  } catch (err) {
    return error(res, err.message, err.status || 500)
  }
}

// LOGOUT
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body
    await authService.logout(refreshToken)
    return success(res, null, 'Logout berhasil.')
  } catch (err) {
    return error(res, 'Logout gagal.', 500)
  }
}

// LOGOUT ALL DEVICES
const logoutAll = async (req, res) => {
  try {
    await authService.logoutAll(req.user.id)
    return success(res, null, 'Logout dari semua perangkat berhasil.')
  } catch (err) {
    return error(res, 'Gagal logout semua perangkat.', 500)
  }
}

// VERIFY EMAIL - Validasi Token dari Klik Email User
const verifyEmail = async (req, res) => {
  try {
    await authService.verifyEmail(req.params.token)
    // Langsung alihkan browser user ke halaman login frontend Vercel lu setelah sukses verifikasi
    return res.redirect('https://crpt-journaling-build.vercel.app/login')
  } catch (err) {
    // Jika eror atau token kedaluwarsa, arahkan ke halaman login dengan query parameter eror agar frontend bisa baca
    return res.redirect('https://crpt-journaling-build.vercel.app/login?error=token_invalid')
  }
}
// RESEND VERIFICATION - Kirim Ulang Email Verifikasi jika Expired
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return error(res, 'Email dibutuhkan.', 400)

    const result = await authService.resendVerification(email)
    if (!result) return success(res, null, 'Jika email terdaftar dan belum diverifikasi, email verifikasi sudah dikirim ulang.')

    // Kirim ulang via Nodemailer (Gmail SMTP)
    await sendVerificationEmail({
      to:       result.user.email,
      username: result.user.username,
      token:    result.verifyToken,
    })

    return success(res, null, 'Email verifikasi berhasil dikirim ulang. Cek inbox kamu.')
  } catch (err) {
    return error(res, err.message, err.status || 500)
  }
}

// FORGOT PASSWORD - Request Link Reset Password
const forgotPassword = async (req, res) => {
  try {
    const result = await authService.forgotPassword(req.body.email)

    // Kirim email reset password via Nodemailer (Gmail SMTP)
    if (result) {
      await sendResetPasswordEmail({
        to:       result.user.email,
        username: result.user.username,
        token:    result.resetToken,
      })
    }

    // Selalu return success demi keamanan (mencegah user enumeration)
    return success(res, null, 'Jika email terdaftar, link reset password sudah dikirim.')
  } catch (err) {
    return error(res, 'Gagal memproses request.', 500)
  }
}

// RESET PASSWORD - Setup Password Baru
const resetPassword = async (req, res) => {
  try {
    await authService.resetPassword(req.params.token, req.body.password)
    return success(res, null, 'Password berhasil direset. Silakan login dengan password baru.')
  } catch (err) {
    return error(res, err.message, err.status || 400)
  }
}

// GET ME - Ambil Data User Berdasarkan Token yang Valid
const getMe = async (req, res) => {
  try {
    return success(res, { user: req.user }, 'Data user berhasil diambil.')
  } catch (err) {
    return error(res, 'Gagal mengambil data user.', 500)
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  getMe,googleLogin, githubLogin, walletNonce, walletLogin
}