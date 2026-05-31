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
      is_onboarded INTEGER NOT NULL DEFAULT 0
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
      bank_account TEXT
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

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      period TEXT NOT NULL,
      qualified_count INTEGER NOT NULL DEFAULT 0,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
      paid_at TEXT DEFAULT NULL,
      payment_method TEXT DEFAULT NULL CHECK(payment_method IN ('jp_bank','wise','swift','BANK','PAYPAL','WECHAT','ALIPAY')),
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

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

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      from_user_id TEXT REFERENCES users(id),
      withdrawal_method_id TEXT,
      task_id TEXT REFERENCES tasks(id),
      type TEXT NOT NULL CHECK(type IN ('ESCROW_DEPOSIT','ESCROW_RELEASE','ESCROW_REFUND','PLATFORM_FEE','WITHDRAWAL')),
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      platform_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','FAILED')),
      note TEXT,
      reference_type TEXT,
      reference_id TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_ratings (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
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
    'CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_transactions_task ON transactions(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawal_methods_user ON withdrawal_methods(user_id)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }
}

