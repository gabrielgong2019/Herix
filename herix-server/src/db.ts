import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL 环境变量未设置。请先创建 PostgreSQL 数据库。');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export default pool;

/** 初始化数据库表结构 */
export async function initDatabase() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'HERALD' CHECK(role IN ('BRAND','HERALD','ADMIN')),
      is_verified INTEGER NOT NULL DEFAULT 0,
      wechat_open_id TEXT UNIQUE,
      roles TEXT,
      linked_account_id TEXT REFERENCES users(id),  -- 中日账号一键切换（临时方案，待合规要求时拆分）
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS brand_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL DEFAULT '',
      company_desc TEXT,
      website TEXT,
      industry TEXT,
      contact_name TEXT NOT NULL DEFAULT '',
      contact_phone TEXT,
      is_enterprise_verified INTEGER NOT NULL DEFAULT 0,
      is_onboarded INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY'))  -- 业务市场：CNY=中国业务 JPY=日本业务，入驻时选定后不可变
    );

    CREATE TABLE IF NOT EXISTS herald_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      bio TEXT,
      country TEXT,
      diaspora_group TEXT,
      social_platforms TEXT,
      specialties TEXT,
      is_onboarded INTEGER NOT NULL DEFAULT 0,
      residence TEXT,
      residence_country TEXT,
      kyc_status TEXT NOT NULL DEFAULT 'pending',
      declaration_status TEXT NOT NULL DEFAULT 'none',
      declaration_submitted_at TEXT,
      visa_type TEXT,
      bank_account TEXT,
      tier_snapshot TEXT,
      social_platforms_updated_at TEXT,
      display_currency TEXT CHECK(display_currency IN ('JPY','CNY'))  -- 赫使设置的默认展示币种，用于换算和钱包汇总
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(mode IN ('STANDARD','PERFORMANCE')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirements TEXT,
      budget DOUBLE PRECISION NOT NULL DEFAULT 0,
      commission DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY')),  -- 创建时快照自 brand_profiles.currency
      max_heralds INTEGER NOT NULL DEFAULT 1,
      deadline TEXT,
      promo_code TEXT,
      cover_image TEXT,
      brand_logo TEXT,
      difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
      category TEXT,
      content_type TEXT DEFAULT 'photo' CHECK(content_type IN ('photo','video','referral')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
      published_at TEXT,
      completed_at TEXT,
      escrow_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      is_escrowed INTEGER NOT NULL DEFAULT 0,
      code_mode TEXT NOT NULL DEFAULT 'auto',
      platform_requirements TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS declarations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      visa_type TEXT NOT NULL,
      has_work_permit INTEGER NOT NULL DEFAULT 0,
      work_permit_hours_per_week INTEGER DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      submitted_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      reviewed_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS task_promo_codes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      herald_id TEXT REFERENCES users(id),
      assigned_at TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS ambassador_tasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      herald_id TEXT NOT NULL REFERENCES users(id),
      unique_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','suspended')),
      joined_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      completed_at TEXT DEFAULT NULL,
      UNIQUE(task_id, herald_id)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      ambassador_task_id TEXT NOT NULL REFERENCES ambassador_tasks(id),
      referred_token TEXT NOT NULL,
      registered_at TEXT DEFAULT NULL,
      kyc_completed_at TEXT DEFAULT NULL,
      first_transfer_at TEXT DEFAULT NULL,
      first_transfer_amount DOUBLE PRECISION DEFAULT NULL,
      qualified INTEGER NOT NULL DEFAULT 0,
      UNIQUE(ambassador_task_id, referred_token)
    );

    -- payouts 表已废弃（2026-06-11），结算统一走 transactions + withdrawal_requests

    CREATE TABLE IF NOT EXISTS task_applications (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(task_id, herald_id)
    );

    CREATE TABLE IF NOT EXISTS task_submissions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
      content_url TEXT,
      description TEXT,
      screenshot_urls TEXT,
      review_note TEXT,
      submitted_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      reviewed_at TEXT
    );

    -- task_transactions: 任务业务事件（不含钱包充提）
    CREATE TABLE IF NOT EXISTS task_transactions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      type TEXT NOT NULL CHECK(type IN ('TASK_LOCK','TASK_RELEASE','PLATFORM_FEE','TASK_REFUND')),
      task_amount DOUBLE PRECISION NOT NULL DEFAULT 0,   -- 任务总金额快照
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,        -- 赫使实得/品牌支出
      platform_fee DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 平台服务费
      from_user_id TEXT REFERENCES users(id),            -- 品牌方
      to_user_id TEXT REFERENCES users(id),              -- 赫使（TASK_RELEASE 时有值）
      parent_txn_id TEXT REFERENCES task_transactions(id), -- 对冲链
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed')),
      note TEXT,
      reference_type TEXT,
      reference_id TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    -- wallets: 每个用户每种钱包一条记录，存余额快照（支付宝/微信做法）
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      wallet_type TEXT NOT NULL CHECK(wallet_type IN ('brand','herald','platform')),
      currency TEXT NOT NULL DEFAULT 'JPY',
      available_balance DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 可用余额
      frozen_balance DOUBLE PRECISION NOT NULL DEFAULT 0,     -- 冻结余额（任务锁定/提现中）
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(user_id, wallet_type, currency)
    );

    -- wallet_entries: 钱包流水，append-only，绝不修改（PayPal 核心原则）
    CREATE TABLE IF NOT EXISTS wallet_entries (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,              -- 幂等键防重复（PayPal 早期没有这个吃了大亏）
      wallet_id TEXT NOT NULL REFERENCES wallets(id),
      amount DOUBLE PRECISION NOT NULL,                  -- 正=入账 负=出账
      currency TEXT NOT NULL DEFAULT 'JPY',
      available_after DOUBLE PRECISION NOT NULL,         -- 操作后可用余额快照（微信/支付宝做法）
      frozen_after DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 操作后冻结余额快照
      type TEXT NOT NULL CHECK(type IN (
        'TOPUP',               -- 品牌充值入账
        'TASK_FREEZE',         -- 任务发布，可用→冻结
        'TASK_UNFREEZE',       -- 任务退款，冻结→可用
        'TASK_SETTLE',         -- 任务结算完成，冻结清零
        'TASK_CREDIT',         -- 赫使任务收入
        'PLATFORM_FEE',        -- 平台服务费
        'WITHDRAWAL_FREEZE',   -- 提现申请，可用→冻结
        'WITHDRAWAL_DEBIT',    -- 提现完成，冻结清零
        'WITHDRAWAL_UNFREEZE', -- 提现取消，冻结→可用
        'ADJUSTMENT'           -- 人工调整
      )),
      reference_type TEXT,     -- 'topup_request'|'task_transaction'|'withdrawal_request'
      reference_id TEXT,
      parent_entry_id TEXT REFERENCES wallet_entries(id),  -- 对冲记录
      note TEXT,
      created_by TEXT,         -- 'system' | user_id | admin_id
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS task_ratings (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS topup_requests (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES users(id),
      amount DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
      note TEXT,
      confirmed_by TEXT REFERENCES users(id),
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      herald_id TEXT NOT NULL REFERENCES users(id),
      amount DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY')),  -- 从哪个币种钱包提现
      method TEXT NOT NULL,
      account_details TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','failed')),
      payout_reference TEXT,
      processed_by TEXT REFERENCES users(id),
      processed_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    -- exchange_rates: 仅用于赫使端"换算展示"，不参与实际结算（结算永远是原币种）
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate DOUBLE PRECISION NOT NULL,  -- 1 base_currency = rate quote_currency
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(base_currency, quote_currency)
    );

    CREATE TABLE IF NOT EXISTS withdrawal_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('BANK','PAYPAL','WECHAT','ALIPAY','CASH')),
      country TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      account_details TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );
  `;

  await pool.query(schema);

  // 创建索引
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_applications_task ON task_applications(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_applications_herald ON task_applications(herald_id)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_task ON task_submissions(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_herald ON task_submissions(herald_id)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawal_methods_user ON withdrawal_methods(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_topup_requests_brand ON topup_requests(brand_id)',
    'CREATE INDEX IF NOT EXISTS idx_topup_requests_status ON topup_requests(status)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_herald ON withdrawal_requests(herald_id)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status)',
    'CREATE INDEX IF NOT EXISTS idx_task_ratings_herald ON task_ratings(herald_id)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_status ON task_submissions(status)',
    'CREATE INDEX IF NOT EXISTS idx_declarations_user ON declarations(user_id)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }

  // 迁移：为已有表添加新列
  const migrations = [
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform_requirements TEXT`,
    `ALTER TABLE herald_profiles ADD COLUMN IF NOT EXISTS tier_snapshot TEXT`,
    `ALTER TABLE herald_profiles ADD COLUMN IF NOT EXISTS social_platforms_updated_at TEXT`,
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS commission_amount DOUBLE PRECISION`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lock_txn_id TEXT`,
    `ALTER TABLE ambassador_tasks ADD COLUMN IF NOT EXISTS registered_count INTEGER DEFAULT 0`,
    `ALTER TABLE ambassador_tasks ADD COLUMN IF NOT EXISTS used_count INTEGER DEFAULT 0`,
    `ALTER TABLE ambassador_tasks ADD COLUMN IF NOT EXISTS paid_conversions INTEGER DEFAULT 0`,
    `DROP TABLE IF EXISTS payouts`,
    // 多币种支持（2026-06-12）
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_account_id TEXT REFERENCES users(id)`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY'))`,
    `ALTER TABLE herald_profiles ADD COLUMN IF NOT EXISTS display_currency TEXT CHECK(display_currency IN ('JPY','CNY'))`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY'))`,
    `ALTER TABLE topup_requests ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY'))`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('JPY','CNY'))`,
    // 初始汇率占位（updated_at 设为很早，首次读取时会触发 API 刷新）
    `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, updated_at) VALUES ('CNY_JPY','CNY','JPY',20.5,'1970-01-01 00:00:00') ON CONFLICT (id) DO NOTHING`,
    // wallet_entries 索引
    `CREATE INDEX IF NOT EXISTS idx_wallet_entries_wallet ON wallet_entries(wallet_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wallet_entries_type ON wallet_entries(type)`,
    `CREATE INDEX IF NOT EXISTS idx_wallet_entries_ref ON wallet_entries(reference_type, reference_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id, wallet_type)`,
    // task_transactions 索引
    `CREATE INDEX IF NOT EXISTS idx_task_txn_task ON task_transactions(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_task_txn_from ON task_transactions(from_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_task_txn_to ON task_transactions(to_user_id)`,
    // 旧 transactions 表迁移（如果存在则重命名，不存在则跳过）
    `DO $$ BEGIN IF EXISTS (SELECT FROM information_schema.tables WHERE table_name='transactions' AND table_schema='public') THEN ALTER TABLE transactions RENAME TO transactions_legacy; END IF; END $$`,
    // 品牌素材 + 账单邮箱（2026-06-14）
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS promo_image_url TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS billing_email TEXT`,
  ];
  for (const m of migrations) {
    await pool.query(m);
  }
}

