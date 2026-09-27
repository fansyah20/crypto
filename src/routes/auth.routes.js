const router = require('express').Router()
const ctrl   = require('../controllers/auth.controller')
const { registerRules, loginRules, forgotPasswordRules, resetPasswordRules } = require('../validators/auth.validator')
const { validate }     = require('../middleware/validate')
const { authenticate } = require('../middleware/auth')
const { authLimiter }  = require('../middleware/rateLimiter')

// Public routes
router.post('/google', authLimiter, ctrl.googleLogin)
router.post('/github', authLimiter, ctrl.githubLogin)
router.get('/wallet/nonce', authLimiter, ctrl.walletNonce)
router.post('/wallet/verify', authLimiter, ctrl.walletLogin)
router.post('/register',              authLimiter, registerRules, validate, ctrl.register)
router.post('/login',                 authLimiter, loginRules, validate, ctrl.login)
router.post('/refresh',               authLimiter, ctrl.refresh)
router.post('/logout',                ctrl.logout)
router.get('/verify/:token',          ctrl.verifyEmail)            // verifikasi email
router.post('/resend-verification',   authLimiter, ctrl.resendVerification)  // ← BARU: kirim ulang
router.post('/forgot-password',       authLimiter, forgotPasswordRules, validate, ctrl.forgotPassword)
router.post('/reset-password/:token', authLimiter, resetPasswordRules, validate, ctrl.resetPassword)

// Protected routes
router.get('/me',          authenticate, ctrl.getMe)
router.post('/logout-all', authenticate, ctrl.logoutAll)

module.exports = router