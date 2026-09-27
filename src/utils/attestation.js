const { ethers } = require('ethers')

const CONTRACT_ADDRESS = process.env.POT_CONTRACT_ADDRESS
const attesterWallet   = new ethers.Wallet(process.env.ATTESTER_PRIVATE_KEY)

// Hash statistik trading — urutan & tipe data HARUS konsisten setiap dipanggil
// biar hasilnya reproducible saat verifikasi ulang nanti.
const computeStatsHash = (stats) =>
  ethers.solidityPackedKeccak256(
    ['uint256', 'uint256', 'uint256', 'int256', 'uint256'],
    [
      stats.totalTrades,
      stats.winCount,
      stats.lossCount,
      Math.round(stats.totalPnl * 100), // simpan 2 desimal sebagai integer
      stats.periodEndTimestamp,
    ]
  )

const signAttestation = async ({ walletAddress, hash, nonce, expiry }) => {
  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'bytes32', 'uint256', 'uint256', 'address'],
    [walletAddress, hash, nonce, expiry, CONTRACT_ADDRESS]
  )
  return attesterWallet.signMessage(ethers.getBytes(messageHash))
}

module.exports = { computeStatsHash, signAttestation, CONTRACT_ADDRESS }