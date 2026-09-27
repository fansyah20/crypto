const prisma = require('../utils/prisma')

//  CRON JOB SERVICE
//  Semua pekerjaan terjadwal yang jalan otomatis di background
//  Pakai node-cron — format: detik menit jam hari bulan hari-minggu

// JOB 1: Expire subscriptions yang sudah lewat end_date 
// Jalan setiap hari jam 00:05
const expireSubscriptions = async () => {
  console.log('[CRON] Checking expired subscriptions...')
  try {
    const expired = await prisma.userSubscription.findMany({
      where: {
        status:  'active',
        endDate: { lt: new Date() },
      },
      include: { user: true, plan: true },
    })

    if (expired.length === 0) {
      console.log('[CRON] No expired subscriptions found.')
      return
    }

    for (const sub of expired) {
      await prisma.$transaction([
        // Update status subscription jadi expired
        prisma.userSubscription.update({
          where: { id: sub.id },
          data:  { status: 'expired' },
        }),
        // Downgrade role user ke free
        prisma.user.update({
          where: { id: sub.userId },
          data:  { role: 'free' },
        }),
        // Kirim notifikasi ke user
        prisma.notification.create({
          data: {
            userId:  sub.userId,
            type:    'subscription_expired',
            title:   'Membership kamu telah berakhir 😢',
            message: `Paket ${sub.plan.name} kamu sudah expired. Perpanjang sekarang untuk tetap akses fitur premium.`,
            data:    { planName: sub.plan.name, planSlug: sub.plan.slug, expiredAt: sub.endDate },
          },
        }),
      ])
      console.log(`[CRON] Expired: user ${sub.userId} (plan: ${sub.plan.name})`)
    }

    console.log(`[CRON] ✅ ${expired.length} subscriptions expired.`)
  } catch (err) {
    console.error('[CRON] ❌ expireSubscriptions error:', err.message)
  }
}

// JOB 2: Reminder 3 hari sebelum membership habis
// Jalan setiap hari jam 09:00
const sendRenewalReminders = async () => {
  console.log('[CRON] Sending renewal reminders...')
  try {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const tomorrow         = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const expiringSoon = await prisma.userSubscription.findMany({
      where: {
        status:  'active',
        endDate: { gte: tomorrow, lte: threeDaysFromNow },
        autoRenew: false,
      },
      include: { user: true, plan: true },
    })

    for (const sub of expiringSoon) {
      // Cek apakah notif reminder sudah pernah dikirim hari ini
      const alreadySent = await prisma.notification.findFirst({
        where: {
          userId:    sub.userId,
          type:      'renewal_reminder',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      })
      if (alreadySent) continue

      const daysLeft = Math.ceil((sub.endDate - new Date()) / (1000 * 60 * 60 * 24))

      await prisma.notification.create({
        data: {
          userId:  sub.userId,
          type:    'renewal_reminder',
          title:   `⏰ Membership kamu berakhir dalam ${daysLeft} hari`,
          message: `Paket ${sub.plan.name} kamu akan berakhir pada ${sub.endDate.toLocaleDateString('id-ID')}. Perpanjang sekarang!`,
          data:    { planName: sub.plan.name, endDate: sub.endDate, daysLeft },
        },
      })
      console.log(`[CRON] Reminder sent: user ${sub.userId}, ${daysLeft} days left`)
    }

    console.log(`[CRON] ✅ ${expiringSoon.length} reminders sent.`)
  } catch (err) {
    console.error('[CRON] ❌ sendRenewalReminders error:', err.message)
  }
}

// JOB 3: Cleanup refresh tokens yang sudah expired
// Jalan setiap minggu Minggu jam 02:00
const cleanupExpiredTokens = async () => {
  console.log('[CRON] Cleaning up expired refresh tokens...')
  try {
    const { count } = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    console.log(`[CRON] ✅ Deleted ${count} expired refresh tokens.`)
  } catch (err) {
    console.error('[CRON] ❌ cleanupExpiredTokens error:', err.message)
  }
}

// JOB 4: Cleanup notifikasi lama (> 30 hari)
// Jalan setiap hari jam 03:00
const cleanupOldNotifications = async () => {
  console.log('[CRON] Cleaning up old notifications...')
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { count } = await prisma.notification.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
        isRead:    true,
      },
    })
    console.log(`[CRON] ✅ Deleted ${count} old read notifications.`)
  } catch (err) {
    console.error('[CRON] ❌ cleanupOldNotifications error:', err.message)
  }
}

//  INIT SEMUA CRON JOBS — dipanggil dari index.js saat server start
// JOB 5: Auto-sync exchange accounts
// Jalan setiap jam untuk akun yang auto_sync = true
const autoSyncExchanges = async () => {
  console.log('[CRON] Auto-syncing exchange accounts...')
  try {
    const accounts = await prisma.exchangeAccount.findMany({
      where: { autoSync: true, status: 'active' },
    })

    for (const account of accounts) {
      // Cek apakah sudah waktunya sync berdasarkan syncInterval
      const lastSync  = account.lastSyncAt || new Date(0)
      const nextSync  = new Date(lastSync.getTime() + account.syncInterval * 60 * 1000)
      if (new Date() < nextSync) continue

      try {
        const { importTrades } = require('./exchange.service')
        const result = await importTrades(account.id, account.userId, {
          sinceDate: account.lastSyncAt,
        })
        console.log(`[CRON] Auto-sync ${account.platform} (${account.accountName}): ${result.imported} new trades`)
      } catch (err) {
        console.error(`[CRON] Auto-sync error for ${account.id}: ${err.message}`)
        await prisma.exchangeAccount.update({
          where: { id: account.id },
          data: { status: 'error', lastSyncStatus: err.message?.slice(0, 190) },
        })
      }
    }
  } catch (err) {
    console.error('[CRON] autoSyncExchanges error:', err.message)
  }
}

const initCronJobs = () => {
  // Cek apakah node-cron tersedia
  let cron
  try {
    cron = require('node-cron')
  } catch {
    console.warn('[CRON] node-cron tidak terinstall. Jalankan: npm install node-cron')
    console.warn('[CRON] Cron jobs tidak aktif.')
    return
  }
  
  // Job 1: Expire subscriptions — setiap hari jam 00:05
  cron.schedule('5 0 * * *', expireSubscriptions, {
    timezone: 'Asia/Jakarta',
  })

  // Job 2: Renewal reminders — setiap hari jam 09:00
  cron.schedule('0 9 * * *', sendRenewalReminders, {
    timezone: 'Asia/Jakarta',
  })
  
  // Job 3: Cleanup tokens — setiap Minggu jam 02:00
  cron.schedule('0 2 * * 0', cleanupExpiredTokens, {
    timezone: 'Asia/Jakarta',
  })
  
  // Job 4: Cleanup notifikasi — setiap hari jam 03:00
  cron.schedule('0 3 * * *', cleanupOldNotifications, {
    timezone: 'Asia/Jakarta',
  })
  

  console.log('⏰ Cron jobs initialized:')
  console.log('   • Expire subscriptions  — daily at 00:05 WIB')
  console.log('   • Renewal reminders     — daily at 09:00 WIB')
  console.log('   • Cleanup tokens        — every Sunday at 02:00 WIB')
  console.log('   • Cleanup notifications — daily at 03:00 WIB')
  console.log('   • Auto-sync exchanges     — every 30 minutes')
  
  // Job 5: Auto-sync exchange — setiap 30 menit
  cron.schedule('*/30 * * * *', autoSyncExchanges, { timezone: 'Asia/Jakarta' })
}

module.exports = {
  autoSyncExchanges,
  initCronJobs,
  expireSubscriptions,
  sendRenewalReminders,
  cleanupExpiredTokens,
  cleanupOldNotifications,
}

