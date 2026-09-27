-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NULL,
    `avatar_url` VARCHAR(191) NULL,
    `role` ENUM('free', 'member', 'admin') NOT NULL DEFAULT 'free',
    `is_verified` BOOLEAN NOT NULL DEFAULT false,
    `verify_token` VARCHAR(255) NULL,
    `reset_token` VARCHAR(191) NULL,
    `reset_token_exp` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `verify_token_expire` DATETIME(3) NULL,
    `provider` VARCHAR(191) NULL DEFAULT 'local',
    `provider_id` VARCHAR(191) NULL,
    `wallet_address` VARCHAR(191) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_wallet_address_key`(`wallet_address`),
    UNIQUE INDEX `user_provider_unique`(`provider`, `provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_nonces` (
    `id` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `nonce` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallet_nonces_nonce_key`(`nonce`),
    INDEX `wallet_nonces_address_idx`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_key`(`token`),
    INDEX `refresh_tokens_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_plans` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `price_monthly` DECIMAL(12, 2) NOT NULL,
    `price_yearly` DECIMAL(12, 2) NOT NULL,
    `features` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `membership_plans_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `status` ENUM('trial', 'active', 'expired', 'cancelled') NOT NULL DEFAULT 'trial',
    `billing_cycle` ENUM('monthly', 'yearly') NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `trial_ends_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `auto_renew` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_subscriptions_plan_id_fkey`(`plan_id`),
    INDEX `user_subscriptions_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NULL,
    `invoice_number` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'IDR',
    `status` ENUM('pending', 'paid', 'failed', 'refunded', 'expired') NOT NULL DEFAULT 'pending',
    `payment_method` VARCHAR(191) NULL,
    `xendit_invoice_id` VARCHAR(191) NULL,
    `xendit_payment_url` VARCHAR(1000) NULL,
    `xendit_response` JSON NULL,
    `paid_at` DATETIME(3) NULL,
    `expired_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_invoice_number_key`(`invoice_number`),
    INDEX `payments_subscription_id_fkey`(`subscription_id`),
    INDEX `payments_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `instruments` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('crypto', 'forex', 'commodity', 'index', 'stock', 'crypto_futures') NOT NULL,
    `base_currency` VARCHAR(191) NOT NULL,
    `quote_currency` VARCHAR(191) NOT NULL,
    `pip_size` DECIMAL(18, 8) NULL,
    `lot_size` DECIMAL(20, 8) NULL,
    `contract_size` DECIMAL(20, 8) NULL,
    `margin_required` DECIMAL(10, 4) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `exchange` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `instruments_symbol_key`(`symbol`),
    INDEX `instruments_type_idx`(`type`),
    INDEX `instruments_symbol_idx`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exchange_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `platform` ENUM('manual', 'mt4', 'mt5', 'binance', 'indodax', 'tokocrypto', 'triv', 'pintu', 'bybit', 'okx', 'floq', 'mifx', 'csv_import') NOT NULL,
    `account_name` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NULL,
    `api_key` VARCHAR(500) NULL,
    `api_secret` VARCHAR(500) NULL,
    `api_passphrase` VARCHAR(500) NULL,
    `server_name` VARCHAR(191) NULL,
    `login_number` VARCHAR(191) NULL,
    `is_read_only` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('active', 'inactive', 'error', 'pending') NOT NULL DEFAULT 'pending',
    `last_sync_at` DATETIME(3) NULL,
    `last_sync_status` VARCHAR(191) NULL,
    `auto_sync` BOOLEAN NOT NULL DEFAULT false,
    `sync_interval` INTEGER NOT NULL DEFAULT 60,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exchange_accounts_user_id_idx`(`user_id`),
    INDEX `exchange_accounts_platform_idx`(`platform`),
    UNIQUE INDEX `exchange_accounts_user_id_platform_account_id_key`(`user_id`, `platform`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journals` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `visibility` ENUM('private', 'public', 'members_only') NOT NULL DEFAULT 'private',
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `tags` JSON NOT NULL,
    `instrument_type` ENUM('crypto', 'forex', 'commodity', 'index', 'stock', 'crypto_futures') NULL,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `journals_user_id_idx`(`user_id`),
    INDEX `journals_visibility_idx`(`visibility`),
    INDEX `journals_instrument_type_idx`(`instrument_type`),
    INDEX `journals_created_at_idx`(`created_at`),
    FULLTEXT INDEX `journals_title_content_idx`(`title`, `content`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_trades` (
    `id` VARCHAR(191) NOT NULL,
    `journal_id` VARCHAR(191) NOT NULL,
    `instrument_id` VARCHAR(191) NULL,
    `exchange_account_id` VARCHAR(191) NULL,
    `external_trade_id` VARCHAR(191) NULL,
    `instrument_type` ENUM('crypto', 'forex', 'commodity', 'index', 'stock', 'crypto_futures') NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `symbol_name` VARCHAR(191) NOT NULL,
    `base_currency` VARCHAR(191) NOT NULL,
    `quote_currency` VARCHAR(191) NOT NULL,
    `exchange` VARCHAR(191) NULL,
    `trade_type` ENUM('long', 'short', 'buy', 'sell') NOT NULL,
    `entry_price` DECIMAL(20, 8) NOT NULL,
    `exit_price` DECIMAL(20, 8) NULL,
    `quantity` DECIMAL(20, 8) NOT NULL,
    `lot_size` DECIMAL(20, 8) NULL,
    `leverage` INTEGER NULL,
    `pip_value` DECIMAL(20, 8) NULL,
    `pip_count` DECIMAL(10, 2) NULL,
    `spread` DECIMAL(10, 2) NULL,
    `commission` DECIMAL(20, 8) NULL,
    `swap` DECIMAL(20, 8) NULL,
    `stop_loss` DECIMAL(20, 8) NULL,
    `take_profit` DECIMAL(20, 8) NULL,
    `risk_amount` DECIMAL(20, 8) NULL,
    `risk_percent` DECIMAL(10, 4) NULL,
    `pnl_amount` DECIMAL(20, 8) NULL,
    `pnl_amount_idr` DECIMAL(20, 2) NULL,
    `pnl_percent` DECIMAL(10, 4) NULL,
    `pnl_pips` DECIMAL(10, 2) NULL,
    `status` ENUM('open', 'closed', 'cancelled') NOT NULL DEFAULT 'open',
    `platform` ENUM('manual', 'mt4', 'mt5', 'binance', 'indodax', 'tokocrypto', 'triv', 'pintu', 'bybit', 'okx', 'floq', 'mifx', 'csv_import') NOT NULL DEFAULT 'manual',
    `trade_date` DATETIME(3) NOT NULL,
    `close_date` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `screenshot_url` VARCHAR(1000) NULL,
    `tags` JSON NOT NULL,
    `raw_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `journal_trades_journal_id_idx`(`journal_id`),
    INDEX `journal_trades_instrument_type_idx`(`instrument_type`),
    INDEX `journal_trades_symbol_idx`(`symbol`),
    INDEX `journal_trades_status_idx`(`status`),
    INDEX `journal_trades_trade_date_idx`(`trade_date`),
    INDEX `journal_trades_platform_idx`(`platform`),
    INDEX `journal_trades_exchange_account_id_idx`(`exchange_account_id`),
    INDEX `journal_trades_instrument_id_fkey`(`instrument_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ib_referrals` (
    `id` VARCHAR(191) NOT NULL,
    `ib_user_id` VARCHAR(191) NOT NULL,
    `referred_user_id` VARCHAR(191) NOT NULL,
    `referral_code` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL DEFAULT 'mifx',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `client_account` VARCHAR(191) NULL,
    `total_volume` DECIMAL(20, 8) NOT NULL DEFAULT 0.00000000,
    `total_commission` DECIMAL(20, 8) NOT NULL DEFAULT 0.00000000,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ib_referrals_ib_user_id_idx`(`ib_user_id`),
    INDEX `ib_referrals_referral_code_idx`(`referral_code`),
    UNIQUE INDEX `ib_referrals_ib_user_id_referred_user_id_platform_key`(`ib_user_id`, `referred_user_id`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_comments` (
    `id` VARCHAR(191) NOT NULL,
    `journal_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `journal_comments_journal_id_fkey`(`journal_id`),
    INDEX `journal_comments_parent_id_fkey`(`parent_id`),
    INDEX `journal_comments_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_likes` (
    `id` VARCHAR(191) NOT NULL,
    `journal_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `journal_likes_user_id_fkey`(`user_id`),
    UNIQUE INDEX `journal_likes_journal_id_user_id_key`(`journal_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `watchlists` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `watchlists_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `watchlist_items` (
    `id` VARCHAR(191) NOT NULL,
    `watchlist_id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `symbol_name` VARCHAR(191) NOT NULL,
    `instrument_type` ENUM('crypto', 'forex', 'commodity', 'index', 'stock', 'crypto_futures') NOT NULL DEFAULT 'crypto',
    `alert_price_high` DECIMAL(20, 8) NULL,
    `alert_price_low` DECIMAL(20, 8) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `watchlist_items_watchlist_id_symbol_key`(`watchlist_id`, `symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `data` JSON NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_subscriptions` ADD CONSTRAINT `user_subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `membership_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_subscriptions` ADD CONSTRAINT `user_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `user_subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_accounts` ADD CONSTRAINT `exchange_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journals` ADD CONSTRAINT `journals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_trades` ADD CONSTRAINT `journal_trades_exchange_account_id_fkey` FOREIGN KEY (`exchange_account_id`) REFERENCES `exchange_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_trades` ADD CONSTRAINT `journal_trades_instrument_id_fkey` FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_trades` ADD CONSTRAINT `journal_trades_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ib_referrals` ADD CONSTRAINT `ib_referrals_ib_user_id_fkey` FOREIGN KEY (`ib_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_comments` ADD CONSTRAINT `journal_comments_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_comments` ADD CONSTRAINT `journal_comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `journal_comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_comments` ADD CONSTRAINT `journal_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_likes` ADD CONSTRAINT `journal_likes_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_likes` ADD CONSTRAINT `journal_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watchlists` ADD CONSTRAINT `watchlists_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watchlist_items` ADD CONSTRAINT `watchlist_items_watchlist_id_fkey` FOREIGN KEY (`watchlist_id`) REFERENCES `watchlists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
