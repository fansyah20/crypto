// src/routes/attestation.routes.js
const router = require('express').Router()
const ctrl = require('../controllers/attestation.controller')
const { authenticate } = require('../middleware/auth')

router.post('/prepare', authenticate, ctrl.prepare) // wajib login
router.get('/verify/:address', ctrl.verify)          // publik — siapa aja bisa verifikasi

module.exports = router