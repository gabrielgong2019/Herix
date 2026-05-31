import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// 数据库文件路径
const dbDir = path.resolve(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'herix.db');

// 确保目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;

/** 初始化数据库表结构 */
export function initDatabase() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'HERALD' CHECK(role IN ('BRAND','HERALD','ADMIN')),
      is_verified INTEGER NOT NULL DEFAULT 0,
      wechat_open_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brand_profiles (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL DEFAULT '',
      company_desc TEXT,
      website TEXT,
      industry TEXT,
      contact_name TEXT NOT NULL DEFAULT '',
      contact_phone TEXT,
      is_enterprise_verified INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS herald_profiles (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      bio TEXT,
      country TEXT,
      diaspora_group TEXT,
      social_platforms TEXT,
      specialties TEXT,
      is_onboarded INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      creator_id TEXT NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(mode IN ('STANDARD','PERFORMANCE')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirements TEXT,
      budget REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      max_heralds INTEGER NOT NULL DEFAULT 1,
      deadline TEXT,
      promo_code TEXT,
      cover_image TEXT,
      brand_logo TEXT,
      difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
      category TEXT,      content_type TEXT DEFAULT 'photo' CHECK(content_type IN ('photo','video','referral')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
      published_at TEXT,
      completed_at TEXT,
      escrow_amount REAL NOT NULL DEFAULT 0,
      is_escrowed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS declarations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      visa_type TEXT NOT NULL,
      has_work_permit INTEGER NOT NULL DEFAULT 0,
      work_permit_hours_per_week INTEGER DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS task_promo_codes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      herald_id TEXT REFERENCES users(id),
      assigned_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ambassador_tasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      herald_id TEXT NOT NULL REFERENCES users(id),
      unique_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','suspended')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      first_transfer_amount REAL DEFAULT NULL,
      qualified INTEGER NOT NULL DEFAULT 0,
      UNIQUE(ambassador_task_id, referred_token)
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      period TEXT NOT NULL,
      qualified_count INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
      paid_at TEXT DEFAULT NULL,
      payment_method TEXT DEFAULT NULL CHECK(payment_method IN ('jp_bank','wise','swift','BANK','PAYPAL','WECHAT','ALIPAY')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_applications (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, herald_id)
    );

    CREATE TABLE IF NOT EXISTS task_submissions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
      content_url TEXT,
      description TEXT,
      screenshot_urls TEXT,
      review_note TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      from_user_id TEXT REFERENCES users(id),
      withdrawal_method_id TEXT,
      task_id TEXT REFERENCES tasks(id),
      type TEXT NOT NULL CHECK(type IN ('ESCROW_DEPOSIT','ESCROW_RELEASE','ESCROW_REFUND','PLATFORM_FEE','WITHDRAWAL')),
      amount REAL NOT NULL DEFAULT 0,
      platform_fee REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','FAILED')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_ratings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS withdrawal_methods (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('BANK','PAYPAL','WECHAT','ALIPAY','CASH')),
      country TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      account_details TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

  `;

  // 先创建基础表
  db.exec(schema);

  // 增量迁移：添加大使入驻相关字段（SQLite 不支持 IF NOT EXISTS，用 try/catch）
  const migrations = [
    "ALTER TABLE brand_profiles ADD COLUMN is_onboarded INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tasks ADD COLUMN code_mode TEXT NOT NULL DEFAULT 'auto'",
    "ALTER TABLE users ADD COLUMN roles TEXT",
    "ALTER TABLE herald_profiles ADD COLUMN residence TEXT",
    "ALTER TABLE herald_profiles ADD COLUMN residence_country TEXT",
    "ALTER TABLE herald_profiles ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE herald_profiles ADD COLUMN declaration_status TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE herald_profiles ADD COLUMN declaration_submitted_at TEXT",
    "ALTER TABLE herald_profiles ADD COLUMN visa_type TEXT",
    "ALTER TABLE herald_profiles ADD COLUMN bank_account TEXT",
    "ALTER TABLE transactions ADD COLUMN withdrawal_method_id TEXT",
    "ALTER TABLE transactions ADD COLUMN reference_type TEXT",
    "ALTER TABLE transactions ADD COLUMN reference_id TEXT",
  ];
  for (const m of migrations) {
    try { db.exec(m); } catch { /* 列已存在，忽略 */ }
  }

  // 再创建索引 (separate exec to avoid issues with table dependencies)
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
    db.exec(idx);
  }
}

// 启动时自动初始化
initDatabase();
