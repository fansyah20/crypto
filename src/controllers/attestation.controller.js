// src/controllers/attestation.controller.js
const svc = require('../services/attestation.service')
const { success, error } = require('../utils/response')

const prepare = async (req, res) => {
  try {
    const result = await svc.prepareAttestation(req.user.id, req.body.walletAddress)
    return success(res, result, 'Data siap — silakan mint dari wallet kamu.')
  } catch (err) { return error(res, err.message, err.status || 500) }
}

const verify = async (req, res) => {
  try {
    const result = await svc.verifyAttestation(req.params.address)
    return success(res, result, 'Data terkini berhasil diambil.')
  } catch (err) { return error(res, err.message, err.status || 500) }
}

module.exports = { prepare, verify }