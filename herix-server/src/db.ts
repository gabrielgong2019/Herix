import { Pool, types } from 'pg';

// NUMERIC(OID 1700)：node-postgres 默认返回字符串防精度丢失；本项目 JS 侧一直按 number
// 运算（列原为 double precision）。金额列迁 NUMERIC 后精确性收益在 DB 存储与聚合层
// （SUM/比较无浮点误差），JS 层 float64 对 15 位内金额精度足够，保持 number 行为不变
types.setTypeParser(1700, parseFloat);

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
      role TEXT NOT NULL DEFAULT 'HERALD' CHECK(role IN ('BRAND','HERALD','ADMIN','PLATFORM')),
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
      bank_account TEXT,
      tier_snapshot TEXT,
      social_platforms_updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(mode IN ('STANDARD','PERFORMANCE')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirements TEXT,
      budget NUMERIC(15,2) NOT NULL DEFAULT 0,
      commission NUMERIC(15,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'JPY',
      max_heralds INTEGER NOT NULL DEFAULT 1,
      deadline TEXT,
      promo_code TEXT,
      cover_image TEXT,
      brand_logo TEXT,
      difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
      category TEXT,
      content_type TEXT DEFAULT 'photo' CHECK(content_type IN ('photo','video','referral')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_REVIEW','OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
      published_at TEXT,
      completed_at TEXT,
      escrow_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
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

    -- 单次上传上限 2000 条是应用层限制（routes/tasks.ts MAX_CUSTOM_CODES_PER_UPLOAD），
    -- 表结构本身不限数量，schema 层看不出这条业务规则，故在此注明（2026-07-29）
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
      unique_code TEXT NOT NULL UNIQUE REFERENCES task_promo_codes(code),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','suspended')),
      joined_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      completed_at TEXT DEFAULT NULL,
      UNIQUE(task_id, herald_id)
    );

    -- referrals 旧表已删除（2026-07-17，明细模式改用 referral_records；迁移区有 DROP 兜底老库）

    -- payouts 表已废弃（2026-06-11），结算统一走 transactions + withdrawal_requests

    CREATE TABLE IF NOT EXISTS task_applications (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','EXPIRED')),
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
      task_amount NUMERIC(15,2) NOT NULL DEFAULT 0,   -- 任务总金额快照
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,        -- 赫使实得/品牌支出
      platform_fee NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 平台服务费
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
      available_balance NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 可用余额
      frozen_balance NUMERIC(15,2) NOT NULL DEFAULT 0,     -- 冻结余额（任务锁定/提现中）
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      UNIQUE(user_id, wallet_type, currency)
    );

    -- wallet_entries: 钱包流水，append-only，绝不修改（PayPal 核心原则）
    CREATE TABLE IF NOT EXISTS wallet_entries (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,              -- 幂等键防重复（PayPal 早期没有这个吃了大亏）
      wallet_id TEXT NOT NULL REFERENCES wallets(id),
      amount NUMERIC(15,2) NOT NULL,                  -- 正=入账 负=出账
      currency TEXT NOT NULL DEFAULT 'JPY',
      available_after NUMERIC(15,2) NOT NULL,         -- 操作后可用余额快照（微信/支付宝做法）
      frozen_after NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 操作后冻结余额快照
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
      amount NUMERIC(15,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'JPY',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
      note TEXT,
      confirmed_by TEXT REFERENCES users(id),
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      herald_id TEXT NOT NULL REFERENCES users(id),
      amount NUMERIC(15,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'JPY',
      method TEXT NOT NULL,
      account_details TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','failed')),
      payout_reference TEXT,
      processed_by TEXT REFERENCES users(id),
      processed_at TEXT,
      note TEXT,
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

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    );

    -- pricing_promotions: 促销费率（全局/商家维度）。促销只降不升：
    -- 有效费率 = min(基础费率, 生效促销)，基础 = 商家协议价 ?? 全局默认。
    -- 任务【发布】时快照进 tasks.commission_rate，促销影响促销期内新发布的任务。
    -- 软删除：cancelled_at 非空 = 已终止（不物理删，保留审计）
    CREATE TABLE IF NOT EXISTS pricing_promotions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('global','brand')),
      brand_id TEXT REFERENCES users(id),
      rate NUMERIC(18,8) NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      cancelled_at TEXT
    );

    -- i18n_entries: UI 词条（中日英）。key 由代码 seed 创建（scripts/seed-i18n.ts），
    -- 运营在 admin「本地化」矩阵里只改译文不建 key；规范式存储，加语言=加行不动表结构
    CREATE TABLE IF NOT EXISTS i18n_entries (
      key TEXT NOT NULL,
      locale TEXT NOT NULL CHECK(locale IN ('zh','ja','en','vi','ko')),
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      updated_by TEXT,
      PRIMARY KEY (key, locale)
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
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_task_submissions_unique ON task_submissions(task_id, herald_id)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }

  // 迁移：为已有表添加新列
  const migrations = [
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform_requirements TEXT`,
    `ALTER TABLE herald_profiles ADD COLUMN IF NOT EXISTS tier_snapshot TEXT`,
    `ALTER TABLE herald_profiles ADD COLUMN IF NOT EXISTS social_platforms_updated_at TEXT`,
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(15,2)`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lock_txn_id TEXT`,
    `ALTER TABLE ambassador_tasks ADD COLUMN IF NOT EXISTS registered_count INTEGER DEFAULT 0`,
    `ALTER TABLE ambassador_tasks ADD COLUMN IF NOT EXISTS used_count INTEGER DEFAULT 0`,
    `ALTER TABLE ambassador_tasks ADD COLUMN IF NOT EXISTS paid_conversions INTEGER DEFAULT 0`,
    `DROP TABLE IF EXISTS payouts`,
    // 移除多币种设计（2026-07-08）
    `ALTER TABLE users DROP COLUMN IF EXISTS linked_account_id`,
    `ALTER TABLE herald_profiles DROP COLUMN IF EXISTS display_currency`,
    `DROP TABLE IF EXISTS exchange_rates`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY'`,
    `ALTER TABLE topup_requests ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY'`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JPY'`,
    // source_entity + tax_withheld：追踪付款法人实体和代扣税（2026-07-08）
    `ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS source_entity TEXT NOT NULL DEFAULT 'JP'`,
    `ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS tax_withheld NUMERIC(15,2) NOT NULL DEFAULT 0`,
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
    // 服务协议签署记录（2026-07-09）
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS agreed_at TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS agreed_ip TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS agreed_version TEXT`,
    // 定向发布（2026-07-09）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PUBLIC'`,
    // 品牌专属上传链接 token（2026-07-09）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS upload_token TEXT`,
    // 回填：早于 token 功能发布的 PERFORMANCE 任务补 token，否则任务详情不展示上传链接、upload.html 鉴权失败（2026-07-16，幂等）
    `UPDATE tasks SET upload_token = md5(random()::text || clock_timestamp()::text)
      WHERE mode = 'PERFORMANCE' AND status <> 'DRAFT' AND upload_token IS NULL`,
    // role 检查约束扩到 PLATFORM（DROP+ADD 成对幂等；老库约束不含 PLATFORM）（2026-07-16）
    `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
    `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('BRAND','HERALD','ADMIN','PLATFORM'))`,
    // 平台内部用户：creditPlatformFee 的手续费钱包挂在该用户下，缺行会触发 wallets FK 崩溃（2026-07-16，幂等；password_hash='!' 不可登录）
    `INSERT INTO users (id, password_hash, nickname, role, created_at, updated_at)
      VALUES ('HERIX_PLATFORM', '!', 'Herix Platform', 'PLATFORM', now()::text, now()::text)
      ON CONFLICT (id) DO NOTHING`,
    // 打款费率规则（2026-07-17 定稿）：同国=阶梯固定费；跨国=阶梯费+汇率加点。
    // 汇率申请时锁定（对称波动期望不亏，规模大后上远期对冲——Remitly 同款路径）；
    // 转出国 V1 恒 'JP'（钱包混池，按商家实体分仓留待多国实体阶段）
    `CREATE TABLE IF NOT EXISTS payout_fee_rules (
      id TEXT PRIMARY KEY,
      from_country TEXT NOT NULL,
      to_country TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'JPY',
      tiers TEXT NOT NULL,
      fx_markup_bps INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT,
      UNIQUE(from_country, to_country, currency)
    )`,
    // 种子（2026-07-18 用户拍板）：JP→JP 统一¥200；JP→CN ≤1万¥500/≤5万¥800/以上¥1200 + 150bps
    `INSERT INTO payout_fee_rules (id, from_country, to_country, currency, tiers, fx_markup_bps, updated_by, updated_at) VALUES
      ('rule_jp_jp_jpy', 'JP', 'JP', 'JPY', '[{"upTo":50000,"fee":200},{"upTo":null,"fee":200}]', 0, 'seed', now()::text),
      ('rule_jp_cn_jpy', 'JP', 'CN', 'JPY', '[{"upTo":10000,"fee":500},{"upTo":50000,"fee":800},{"upTo":null,"fee":1200}]', 150, 'seed', now()::text)
     ON CONFLICT (from_country, to_country, currency) DO NOTHING`,
    // 汇率中间价（申请时锁定用；接行情 API 前由运营在设置里维护）
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('fx_mid_JPY_CNY', '0.0490', 'JPY→CNY 中间价（fx-sync 每6小时自动同步 ECB；此值仅为首启种子）'),
      ('ops_alert_email', 'gabrielgong2019@outlook.com', '运营告警收件邮箱（汇率过期等系统告警）'),
      ('operator_entity', 'AfterWork株式会社', '平台运营主体（法定登记名称，服务协议等法律文本引用；admin 定价页可改）')
     ON CONFLICT (key) DO NOTHING`,
    // 商家归属国（转出实体，V1 默认日本）
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'JP'`,
    // 提现申请的跨境快照（锁定的汇率/加点/目标币金额，审计与打款执行依据）
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS to_country TEXT`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fx_mid_rate NUMERIC(18,8)`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fx_markup_bps INTEGER`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS target_currency TEXT`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS target_amount NUMERIC(15,2)`,
    // 小程序 URL Link 缓存（30天有效，过期重新生成）（2026-07-17）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS weapp_link TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS weapp_link_expires TEXT`,
    // 资格要求满足模式：ALL=required项全须满足(默认，现行为)；ANY_N=列出项满足任意 req_min_count 项即可（2026-07-17）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS req_mode TEXT NOT NULL DEFAULT 'ALL'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS req_min_count INTEGER`,
    // 数据回传模式：AGGREGATE=每码累计计数(水位线防重)；DETAIL=逐用户明细(身份去重+行级结算)。发布后锁定（2026-07-17）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS data_mode TEXT NOT NULL DEFAULT 'AGGREGATE'`,
    // 旧 referrals 死表（事件流设想的遗留，从未有写入方，各环境确认 0 行）→ 让位给明细模式新表
    `DROP TABLE IF EXISTS referrals`,
    // 明细模式记录表：一行=一个「用户×码」。user_hash=SHA256(归一化标识+盐)，原文不落库；
    // 幂等键 UNIQUE(task_id, code, user_hash)：同码内同用户只算一次；
    // 同一用户用多个码 → 各码分别计费（2026-07-17 定稿：赫使推广真实发生就该有回报，
    // 一人多码是品牌系统的选择与成本，条款写明；平台不做跨码仲裁，改判机制已拆除）
    `CREATE TABLE IF NOT EXISTS referral_records (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      code TEXT NOT NULL,
      herald_id TEXT NOT NULL REFERENCES users(id),
      user_hash TEXT NOT NULL,
      user_masked TEXT,
      registered_at TEXT NOT NULL,
      converted_at TEXT,
      settled_txn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, code, user_hash)
    )`,
    // 旧约束/旧列迁移（同日内的设计修订，幂等）
    `ALTER TABLE referral_records DROP CONSTRAINT IF EXISTS referral_records_task_id_user_hash_key`,
    `ALTER TABLE referral_records DROP COLUMN IF EXISTS reassign_note`,
    `ALTER TABLE referral_records DROP COLUMN IF EXISTS reassigned_at`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_refrec_task_code_user ON referral_records(task_id, code, user_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_refrec_task_code ON referral_records(task_id, code)`,
    `CREATE INDEX IF NOT EXISTS idx_refrec_herald ON referral_records(herald_id)`,
    // 邮箱验证码（2026-07-17）：注册验证等用途。6位码/30分钟有效/5次尝试上限/60秒限频+小时配额（逻辑在 auth.ts）
    `CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_vcodes_email ON verification_codes(email, purpose, created_at)`,
    // 品牌上传页（upload.html，非平台用户）进入前的数据条款同意记录：时间+IP+UA 作为电子证据（2026-07-17）
    `CREATE TABLE IF NOT EXISTS upload_consents (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      agreed_version TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      agreed_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_upload_consents_task ON upload_consents(task_id)`,
    // 代理任务的品牌方关联（2026-07-17，当日两次修订后定稿）：
    //   多账号绑定（品牌可能多个员工账号）→ 独立关联表；绑定=凭上传链接注册/登录自助；代理可逐个解绑；
    //   生命周期：任务进行中 + 关闭后 30 天缓冲期（缓冲内仍可上传/查看，到期惰性失效，无需定时任务）
    `CREATE TABLE IF NOT EXISTS task_brand_parties (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      bound_at TEXT NOT NULL,
      UNIQUE(task_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tbp_user ON task_brand_parties(user_id)`,
    // 存量单列 brand_party_id → 关联表迁移后删列（条件执行，删列后此块自然跳过）
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'brand_party_id') THEN
        INSERT INTO task_brand_parties (id, task_id, user_id, bound_at)
          SELECT md5(random()::text || id), id, brand_party_id, now()::text
          FROM tasks WHERE brand_party_id IS NOT NULL
          ON CONFLICT (task_id, user_id) DO NOTHING;
        ALTER TABLE tasks DROP COLUMN brand_party_id;
      END IF;
    END $$`,
    // 邀请链接机制已拆除（2026-07-17 当日修订：绑定改为凭上传链接自助+代理可解绑），列 DROP 兜底
    `ALTER TABLE tasks DROP COLUMN IF EXISTS brand_invite_token`,
    // 定价模块（2026-07-09）
    `CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      note TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    )`,
    // platform_settings 初始默认值（ON CONFLICT DO NOTHING 保证幂等）
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('commission_rate',          '0.20',         '平台抽佣比例（2026-07-16 定稿默认 20%）'),
      ('withdrawal_fee_type',      'FLAT',          '提现手续费类型'),
      ('withdrawal_fee_flat',      '500',           '每笔提现固定手续费（JPY）'),
      ('withdrawal_schedule_mode', 'FIXED_DATES',   '打款模式：FIXED_DATES=月中/月末，ON_DEMAND=即时'),
      ('withdrawal_monthly_limit', '2',             '每月提现次数上限（ON_DEMAND 模式生效）'),
      ('withdrawal_min_amount',    '1000',          '最低提现申请金额（JPY）'),
      ('topup_cc_rate',            '0.03',          '信用卡充值手续费率（pass-through）')
     ON CONFLICT (key) DO NOTHING`,
    // i18n_entries 语义背景（key级元数据，seed 维护，给运营/机翻提供语境）
    `ALTER TABLE i18n_entries ADD COLUMN IF NOT EXISTS context TEXT`,
    // 语言扩展迁移：vi=仅客户端(2026-07-19)，ko=仅商户端(2026-07-19)——幂等重建约束
    `ALTER TABLE i18n_entries DROP CONSTRAINT IF EXISTS i18n_entries_locale_check`,
    `ALTER TABLE i18n_entries ADD CONSTRAINT i18n_entries_locale_check CHECK(locale IN ('zh','ja','en','vi','ko'))`,
    // withdrawal_requests 新增字段：手续费快照 + 预计打款日
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fee NUMERIC(15,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2)`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS payout_date TEXT`,
    // task_transactions 费率快照
    `ALTER TABLE task_transactions ADD COLUMN IF NOT EXISTS platform_fee_rate NUMERIC(18,8)`,
    // brand_profiles 账户协议费率
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override NUMERIC(18,8)`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_note TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_by TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_at TEXT`,
    // 商户信用额度 + 充值状态（2026-07-10）
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS has_topped_up BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS first_publish_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS credit_limit_override NUMERIC(15,2)`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS is_agency BOOLEAN NOT NULL DEFAULT FALSE`,
    // 任务极速打款标签 + 信用托管标记
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fast_payout BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS credit_funded BOOLEAN NOT NULL DEFAULT FALSE`,
    // 站内信通知表
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_promotions_active ON pricing_promotions(scope, starts_at, ends_at)`,
    // platform_settings：信用系统参数
    // merchant_initial_credit（人人 5000 的通用信用池）已于 2026-07-18 退役，
    // 由 merchant_trial_credit（首单体验额度，盖戳在任务行上）取代；旧行留在库里无害
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('merchant_trial_credit',   '3000', '新商家首单体验额度（JPY）：首个任务发布时按 min(此值, 任务总成本) 盖戳发放，admin 审核中心-商家认证可改'),
      ('fast_payout_threshold',   '100000', '极速打款余额门槛（JPY，发布时余额达到此值则标记极速打款）')
     ON CONFLICT (key) DO NOTHING`,
    // 两阶段交付状态机（2026-07-26，P0a）：草稿前置 opt-in + 多链接 + 审计留痕
    `ALTER TABLE task_content_specs ADD COLUMN IF NOT EXISTS require_draft_review INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'FINAL'`,
    // content_urls 为权威(JSON数组)；content_url 保留为首链接镜像——旧版 weapp 只认单链接，
    // 待客户端车队更新后随 requirements 列一起退役（同一批遗留兼容清单）
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS content_urls TEXT`,
    // 提交/审核全事件留痕(append-only)：改稿次数从本表派生(无计数列，单一来源)，仲裁证据链。
    // 修复既有缺陷：重提复用行 UPDATE 会覆盖历史版本(与 kyb_submissions 同一审计模式)
    `CREATE TABLE IF NOT EXISTS submission_revisions (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      herald_id TEXT NOT NULL REFERENCES users(id),
      stage TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('SUBMIT','REVIEW')),
      action TEXT NOT NULL,
      content_urls TEXT,
      description TEXT,
      screenshot_urls TEXT,
      note TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subrev_task_herald ON submission_revisions(task_id, herald_id, created_at)`,
    // 并发防重加固：一个赫使对一个任务只有一行提交(此前仅应用层查询防重)。
    // 先清可能的存量重复(保留最新一行)再建唯一索引，幂等
    `DELETE FROM task_submissions a USING task_submissions b
     WHERE a.task_id = b.task_id AND a.herald_id = b.herald_id
       AND a.submitted_at < b.submitted_at`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_task_herald ON task_submissions(task_id, herald_id)`,
    // P1 双向计时器 + 仲裁（2026-07-26）
    // reminder_sent：临期催审只发一次的标记，每次新提交时归零（提交路径负责重置）
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS reminder_sent INTEGER NOT NULL DEFAULT 0`,
    // resubmit_warn_sent：赫使侧临期预警只发一次的标记，被拒后重提时归零
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS resubmit_warn_sent INTEGER NOT NULL DEFAULT 0`,
    // preferred_lang：用户通知语言，由客户端登录/切语言时同步（heralds: zh/en/ja/vi；brands: zh/en/ja/ko）
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_lang TEXT NOT NULL DEFAULT 'zh'`,
    // 仲裁开案：改稿额度用尽后商家/赫使任一方开案，一个提交终身只能开一案（UNIQUE）。
    // 开案期间该提交冻结超时计时（timers 跳过 OPEN 案对应的行）
    `CREATE TABLE IF NOT EXISTS arbitrations (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      herald_id TEXT NOT NULL REFERENCES users(id),
      opened_by TEXT NOT NULL,
      opened_by_role TEXT NOT NULL,
      stage TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
      resolution TEXT,
      resolve_note TEXT,
      resolved_by TEXT,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      resolved_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_arbitrations_status ON arbitrations(status, created_at)`,
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('review_timeout_days',   '7', '商家审核时限（天）：待审超时自动通过（终稿=自动结算打款），临期24h先发催审通知'),
      ('resubmit_timeout_days', '7', '赫使重提时限（天）：被拒后超时未重新提交，自动释放任务名额')
     ON CONFLICT (key) DO NOTHING`,
    // 发布并发闸四级阶梯（2026-07-26）：注册3/KYB10/累计充值达标20/订阅不限。
    // 资金闸（批准报名占额度）不动，这里只限"同时进行中任务数"防空任务刷屏
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('max_open_tasks_base',     '3',       '同时进行中任务数上限：注册商家默认'),
      ('max_open_tasks_kyb',      '10',      '同时进行中任务数上限：KYB 认证商家'),
      ('max_open_tasks_funded',   '20',      '同时进行中任务数上限：累计充值达标商家'),
      ('funded_topup_threshold',  '300000', '注资档门槛：累计充值金额（JPY）。2026-07-26 由100万调至30万——30万≈2-4个任务自然累计，活跃奖励而非付费墙')
     ON CONFLICT (key) DO NOTHING`,
    // 单户 override（销售特批，复用 credit_limit_override 模式）
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS max_open_tasks_override INTEGER`,
    // ── 营销顾问订阅（2026-07-26 P1 正式化，未上线直接终态）────────────────────
    // 订阅状态唯一来源 = merchant_subscriptions（P0 曾在 brand_profiles 放两列快照，删除）
    `ALTER TABLE brand_profiles DROP COLUMN IF EXISTS subscription_plan`,
    `ALTER TABLE brand_profiles DROP COLUMN IF EXISTS subscription_expires_at`,
    // 档位定义（admin 可改价/权益；custom 无标价，合同签订后 admin 在订阅上录实价）
    `CREATE TABLE IF NOT EXISTS subscription_plans (
      code TEXT PRIMARY KEY,
      monthly_price NUMERIC(15,2),
      benefits TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    )`,
    `INSERT INTO subscription_plans (code, monthly_price, benefits, sort) VALUES
      ('basic',   200000, '{"guaranteedTasks":8,"commissionDiscount":0.02}', 1),
      ('premium', 600000, '{"guaranteedTasks":30,"commissionDiscount":0.05}', 2),
      ('custom',  NULL,   '{}', 3)
     ON CONFLICT (code) DO NOTHING`,
    // 订阅主表（状态机：PENDING_PAYMENT→ACTIVE→PAST_DUE(7天宽限)→EXPIRED / CANCELED）。
    // 订阅费从商家钱包余额扣（复用请求书充值链路，不接支付网关），激活/续期由 sweep 驱动。
    // commission_backup: 激活时套用佣金折扣前备份原 override，到期/取消忠实还原
    `CREATE TABLE IF NOT EXISTS merchant_subscriptions (
      id TEXT PRIMARY KEY,
      brand_user_id TEXT NOT NULL REFERENCES users(id),
      plan_code TEXT NOT NULL REFERENCES subscription_plans(code),
      billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('MONTHLY','QUARTERLY','ANNUAL')),
      price_snapshot NUMERIC(15,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
        CHECK(status IN ('PENDING_PAYMENT','ACTIVE','PAST_DUE','EXPIRED','CANCELED')),
      current_period_start TEXT,
      current_period_end TEXT,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      advisor_note TEXT,
      renewal_reminded_at TEXT,
      commission_backup TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_msub_brand ON merchant_subscriptions(brand_user_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_msub_status ON merchant_subscriptions(status, current_period_end)`,
    // 请求书/扣款审计（append-only）：每期一张，PAID 后关联钱包账目构成铁证链
    `CREATE TABLE IF NOT EXISTS subscription_invoices (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL REFERENCES merchant_subscriptions(id),
      invoice_no TEXT NOT NULL UNIQUE,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','VOID')),
      wallet_entry_id TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subinv_sub ON subscription_invoices(subscription_id, status)`,
    // 钱包流水类型扩订阅两类（幂等重建 CHECK，模式同 applications status）
    `ALTER TABLE wallet_entries DROP CONSTRAINT IF EXISTS wallet_entries_type_check`,
    `ALTER TABLE wallet_entries ADD CONSTRAINT wallet_entries_type_check
     CHECK(type IN ('TOPUP','TASK_FREEZE','TASK_UNFREEZE','TASK_SETTLE','TASK_CREDIT','PLATFORM_FEE',
                    'WITHDRAWAL_FREEZE','WITHDRAWAL_DEBIT','WITHDRAWAL_UNFREEZE',
                    'SUBSCRIPTION_FEE','SUBSCRIPTION_INCOME','ADJUSTMENT'))`,
    // 定制版洽谈线索（2026-07-26）：商户提交营销需求表单，admin 订阅页跟进。
    // 公司/联系人信息平台已有（brand_profiles），此表只存需求本身
    `CREATE TABLE IF NOT EXISTS subscription_inquiries (
      id TEXT PRIMARY KEY,
      brand_user_id TEXT NOT NULL REFERENCES users(id),
      goals TEXT NOT NULL,
      budget_range TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONTACTED','CLOSED')),
      handled_by TEXT,
      handled_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subinq_status ON subscription_inquiries(status, created_at)`,
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('sub_discount_quarterly', '0.95', '订阅季付折扣（月价×3×此系数）'),
      ('sub_discount_annual',    '0.88', '订阅年付折扣（月价×12×此系数）'),
      ('sub_grace_days',         '7',    '订阅到期扣款失败宽限天数（PAST_DUE 每日重试）'),
      ('sub_remind_days',        '10',   '订阅到期前提醒天数（邮件+站内信，只发一次）')
     ON CONFLICT (key) DO NOTHING`,
    // 报名状态新增 EXPIRED（名额释放：被拒超时未重提 / 仲裁判商家胜）——幂等重建约束
    `ALTER TABLE task_applications DROP CONSTRAINT IF EXISTS task_applications_status_check`,
    `ALTER TABLE task_applications ADD CONSTRAINT task_applications_status_check
     CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','EXPIRED'))`,
    // 首单体验额度（2026-07-18）：戳在任务行上 write-once，生命周期随任务状态派生
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trial_credit_amount NUMERIC(15,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS trial_task_id TEXT`,
    `ALTER TABLE task_applications ADD COLUMN IF NOT EXISTS review_note TEXT`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_role TEXT`,
    // 任务报酬字段语义重构（commission 废弃，拆分为三个明确字段）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payout_per_herald NUMERIC(15,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cost_per_herald   DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS commission_rate   DOUBLE PRECISION NOT NULL DEFAULT 0`,
    // 数据迁移：旧 commission = cost_per_herald，payout 按各商家实际费率反推
    `UPDATE tasks t SET
       cost_per_herald   = t.commission,
       commission_rate   = COALESCE(
         (SELECT bp.commission_rate_override FROM brand_profiles bp WHERE bp.user_id = t.creator_id),
         0.15
       ),
       payout_per_herald = ROUND(
         t.commission * (1 - COALESCE(
           (SELECT bp.commission_rate_override FROM brand_profiles bp WHERE bp.user_id = t.creator_id),
           0.15
         ))
       )
     WHERE t.commission > 0 AND t.cost_per_herald = 0`,
    // 分类种子数据（ON CONFLICT DO NOTHING 保证幂等）
    `INSERT INTO categories (id, label, icon, sort_order) VALUES
      ('experience', '体验', '🎪', 1),
      ('beauty',     '美妆', '💄', 2),
      ('travel',     '旅行', '✈️',  3),
      ('fashion',    '穿搭', '👗', 4),
      ('food',       '美食', '🍱', 5),
      ('lifestyle',  '生活', '🌿', 6),
      ('referral',   '推荐', '🔗', 7),
      ('baby',       '母婴', '🍼', 8)
     ON CONFLICT (id) DO NOTHING`,
    `ALTER TABLE task_ratings ADD COLUMN IF NOT EXISTS brand_id TEXT`,
    `CREATE TABLE IF NOT EXISTS fx_rate_history (
      id        TEXT PRIMARY KEY,
      pair      TEXT NOT NULL,
      rate      DOUBLE PRECISION NOT NULL,
      source    TEXT NOT NULL DEFAULT 'manual',
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_fx_rate_history_pair ON fx_rate_history(pair, synced_at DESC)`,
    // 行业字段 id 化（2026-07-18）：历史数据存的是中文标签，归一成稳定 id，
    // 显示层从此走 i18n 词条（merchant.industry.*）。幂等：已是 id 的行不受影响
    `UPDATE brand_profiles SET industry = CASE industry
       WHEN '金融服务' THEN 'finance' WHEN '美妆' THEN 'beauty' WHEN '时尚' THEN 'fashion'
       WHEN '食品饮料' THEN 'food' WHEN '旅游' THEN 'travel' WHEN '母婴' THEN 'baby'
       WHEN '电商' THEN 'ecommerce' WHEN '其他' THEN 'other' ELSE industry END
     WHERE industry IN ('金融服务','美妆','时尚','食品饮料','旅游','母婴','电商','其他')`,
    // 在留资格同样 id 化（2026-07-18）：herald_profiles 和 declarations 两处，幂等
    `UPDATE herald_profiles SET visa_type = CASE visa_type
       WHEN '永住者' THEN 'permanent' WHEN '就労' THEN 'work'
       WHEN '留学' THEN 'student' WHEN '其他' THEN 'other' ELSE visa_type END
     WHERE visa_type IN ('永住者','就労','留学','其他')`,
    `UPDATE declarations SET visa_type = CASE visa_type
       WHEN '永住者' THEN 'permanent' WHEN '就労' THEN 'work'
       WHEN '留学' THEN 'student' WHEN '其他' THEN 'other' ELSE visa_type END
     WHERE visa_type IN ('永住者','就労','留学','其他')`,
    // 首任务审核门 + 商家 KYB（2026-07-18，PRD §29）：未验证商家发布的任务须平台审核后才公开可见
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform_review TEXT NOT NULL DEFAULT 'approved'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform_review_note TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS kyb_status TEXT NOT NULL DEFAULT 'none'`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS kyb_doc_url TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS kyb_note TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS kyb_submitted_at TEXT`,
    // KYB 审计留痕（2026-07-19）：brand_profiles.kyb_* 是当前状态快照（单行覆盖），
    // 商家被拒重传后旧拒绝原因/旧证件/旧时间全部丢失——本表按提交事件写一行，永久保留。
    // 同时把 is_enterprise_verified 合并进 kyb_status：两者是同一事实的重复字段，
    // 原子写入所以当前无分歧，但架构上就该只有一个来源——直接删列，
    // 网关判断/gate 改读 kyb_status='approved'（见 tasks.ts/auth.ts 改动）
    `ALTER TABLE brand_profiles DROP COLUMN IF EXISTS is_enterprise_verified`,
    `CREATE TABLE IF NOT EXISTS kyb_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      doc_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_kyb_submissions_user ON kyb_submissions(user_id, submitted_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_brand_profiles_kyb_status ON brand_profiles(kyb_status)`,
    // 社群定向（2026-07-20）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_communities TEXT[] DEFAULT '{}'`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_communities ON tasks USING GIN(target_communities)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_active_time ON tasks(status, created_at DESC)`,
    `ALTER TABLE herald_profiles ADD COLUMN IF NOT EXISTS community TEXT DEFAULT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_herald_profiles_community ON herald_profiles(community)`,
    // 站点归属（2026-07-20）：任务归属站点，赫使按站点过滤任务；默认 jp 兼容存量数据
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS site_id TEXT NOT NULL DEFAULT 'jp'`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_site ON tasks(site_id)`,
    // 赫使专长标签（2026-07-22）
    `CREATE TABLE IF NOT EXISTS specialty_tags (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 99,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    )`,
    `CREATE TABLE IF NOT EXISTS herald_specialty_tags (
      herald_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES specialty_tags(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')),
      PRIMARY KEY (herald_id, tag_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_herald_specialty_tags_tag ON herald_specialty_tags(tag_id)`,
    `INSERT INTO specialty_tags (id, sort_order) VALUES
      ('baby-mom', 1), ('food-explorer', 2), ('beauty', 3), ('student-abroad', 4),
      ('working-adult', 5), ('travel', 6), ('finance', 7), ('lifestyle', 8),
      ('fitness', 9), ('tech', 10), ('fashion', 11), ('pet', 12)
     ON CONFLICT (id) DO NOTHING`,
    // 任务发布标准化（2026-07-22）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS min_images INTEGER`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS min_video_seconds INTEGER`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_revisions INTEGER NOT NULL DEFAULT 2`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS require_proposal INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submit_deadline TEXT`,
    `ALTER TABLE task_applications ADD COLUMN IF NOT EXISTS proposal_text TEXT`,
    `ALTER TABLE task_applications ADD COLUMN IF NOT EXISTS proposal_links TEXT`,
    // 任务类型分表（2026-07-24）：原 tasks 表中 mode 专属字段迁移到独立 spec 表，
    // 未来加第三种模式只需新增一张表，不改 tasks schema。
    // 保留 tasks 表原有列（向后兼容 + 双写），spec 表查询时 COALESCE 优先。
    `CREATE TABLE IF NOT EXISTS task_content_specs (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL DEFAULT 'photo' CHECK(content_type IN ('photo','video','both')),
      min_images INTEGER,
      min_video_seconds INTEGER,
      max_revisions INTEGER NOT NULL DEFAULT 2,
      require_proposal INTEGER NOT NULL DEFAULT 0,
      submit_deadline TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS task_referral_specs (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      code_mode TEXT NOT NULL DEFAULT 'auto' CHECK(code_mode IN ('auto','custom')),
      data_mode TEXT NOT NULL DEFAULT 'AGGREGATE' CHECK(data_mode IN ('AGGREGATE','DETAIL'))
    )`,
    // 存量数据迁移（幂等）：主表旧列 → spec 表。用 DO 块守卫列存在性——
    // 下面紧接着 DROP 旧列，二次启动时旧列已不在，裸 INSERT..SELECT 会直接报错
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='content_type') THEN
         INSERT INTO task_content_specs (task_id, content_type, min_images, min_video_seconds, max_revisions, require_proposal, submit_deadline)
         SELECT id,
                CASE WHEN content_type IN ('photo','video','both') THEN content_type ELSE 'photo' END,
                min_images, min_video_seconds,
                COALESCE(max_revisions, 2),
                COALESCE(require_proposal, 0),
                submit_deadline
         FROM tasks WHERE mode = 'STANDARD'
         ON CONFLICT DO NOTHING;
         INSERT INTO task_referral_specs (task_id, code_mode, data_mode)
         SELECT id, COALESCE(code_mode, 'auto'), COALESCE(data_mode, 'AGGREGATE')
         FROM tasks WHERE mode = 'PERFORMANCE'
         ON CONFLICT DO NOTHING;
       END IF;
     END $$`,
    // 终态（2026-07-25 用户决策：CTI 未上线不留过渡态）：回填完成后主表旧列直接 DROP，
    // spec 表成为类型专属字段唯一来源。API 响应 JSON 键不变，由服务端组装层保证兼容
    `ALTER TABLE tasks DROP COLUMN IF EXISTS content_type`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS min_images`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS min_video_seconds`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS max_revisions`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS require_proposal`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS submit_deadline`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS code_mode`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS data_mode`,
    // 任务状态机补 PENDING_REVIEW 真状态（2026-07-26，contracts.ts TASK_STATUSES DB-CHECK）：
    // 此前用 OPEN+platform_review 正交列表达"待审核"，报名闸只看 status 导致未过审任务可被报名。
    // 幂等重建 CHECK + 存量数据迁移（platform_review 列保留做审计记录）
    // ── DB 评审修复（2026-07-29，用户确认不考虑存量）────────────────────
    // 码池设计（v?）之前的老测试数据：码未入池的 ambassador_tasks 直接删（不回填）
    `DELETE FROM ambassador_tasks WHERE NOT EXISTS (
       SELECT 1 FROM task_promo_codes pc WHERE pc.code = ambassador_tasks.unique_code)`,
    // 码的单一事实源：unique_code 必须存在于码池，消除两表字符串对齐漂移（幂等重建，模式同 CHECK）
    `ALTER TABLE ambassador_tasks DROP CONSTRAINT IF EXISTS ambassador_tasks_unique_code_fkey`,
    `ALTER TABLE ambassador_tasks ADD CONSTRAINT ambassador_tasks_unique_code_fkey
     FOREIGN KEY (unique_code) REFERENCES task_promo_codes(code)`,
    // 码池按任务查询（分配/计数）此前全表扫描：PG 的 FK 不自动建索引
    `CREATE INDEX IF NOT EXISTS idx_promo_codes_task ON task_promo_codes(task_id)`,
    // 金额 DOUBLE PRECISION → NUMERIC：金额(15,2)/比率汇率(18,8)。信息模式守卫幂等，
    // 已收敛的列跳过（裸 ALTER TYPE 每次启动都会全表重写+排他锁）。列清单与 CREATE 终态定义对齐
    `DO $$
     DECLARE r RECORD;
     BEGIN
       FOR r IN
         SELECT c.table_name AS tbl, c.column_name AS col,
                CASE WHEN c.column_name IN ('commission_rate_override','rate','commission_rate','platform_fee_rate','fx_mid_rate')
                     THEN 'numeric(18,8)' ELSE 'numeric(15,2)' END AS newtype
         FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.data_type = 'double precision'
           AND c.column_name IN (
             'credit_limit_override','price_snapshot','amount','monthly_price','commission_amount',
             'platform_fee','task_amount','budget','commission','cost_per_herald','escrow_amount',
             'payout_per_herald','trial_credit_amount','available_after','frozen_after','tax_withheld',
             'available_balance','frozen_balance','fee','net_amount','target_amount',
             'commission_rate_override','rate','commission_rate','platform_fee_rate','fx_mid_rate')
       LOOP
         EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s USING %I::%s',
                        r.tbl, r.col, r.newtype, r.col, r.newtype);
       END LOOP;
     END $$`,
    // KYB 流程化（2026-07-29）：结构化提交字段 + 自动核验结果留痕
    `ALTER TABLE kyb_submissions ADD COLUMN IF NOT EXISTS company_name TEXT`,
    `ALTER TABLE kyb_submissions ADD COLUMN IF NOT EXISTS country TEXT`,
    `ALTER TABLE kyb_submissions ADD COLUMN IF NOT EXISTS corporate_number TEXT`,
    `ALTER TABLE kyb_submissions ADD COLUMN IF NOT EXISTS auto_checks TEXT`,
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('kyb_auto_approve', '0', 'KYB全自动通过开关：1=法人番号校验+国税厅名称比对全过即自动通过（需配置HOUJIN_API_ID），0=机器核验结果仅辅助人工')
     ON CONFLICT (key) DO NOTHING`,
    `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check`,
    `ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
     CHECK(status IN ('DRAFT','PENDING_REVIEW','OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))`,
    `UPDATE tasks SET status = 'PENDING_REVIEW' WHERE status = 'OPEN' AND platform_review = 'pending'`,
    // 任务短链（2026-07-29）：一个任务一个永久短码，/t/:code 重定向到 H5 落地页
    `CREATE TABLE IF NOT EXISTS short_links (
       code VARCHAR(8) PRIMARY KEY,
       task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
       created_at TEXT NOT NULL DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_short_links_task ON short_links(task_id)`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS translation_status TEXT DEFAULT NULL`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS translation_attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS default_lang TEXT NOT NULL DEFAULT 'zh'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_lang TEXT NOT NULL DEFAULT 'zh'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS translation_source_hash TEXT DEFAULT NULL`,
    `CREATE TABLE IF NOT EXISTS task_translations (
       task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
       locale TEXT NOT NULL,
       title TEXT,
       description TEXT,
       translated_at TIMESTAMPTZ DEFAULT NOW(),
       PRIMARY KEY (task_id, locale)
     )`,
  ];
  for (const m of migrations) {
    await pool.query(m);
  }
}

