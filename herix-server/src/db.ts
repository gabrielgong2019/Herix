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
      budget DOUBLE PRECISION NOT NULL DEFAULT 0,
      commission DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'JPY',
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

    -- referrals 旧表已删除（2026-07-17，明细模式改用 referral_records；迁移区有 DROP 兜底老库）

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
      amount DOUBLE PRECISION NOT NULL,
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
      rate DOUBLE PRECISION NOT NULL,
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
      locale TEXT NOT NULL CHECK(locale IN ('zh','ja','en')),
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
    `ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS commission_amount DOUBLE PRECISION`,
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
    `ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS tax_withheld DOUBLE PRECISION NOT NULL DEFAULT 0`,
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
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fx_mid_rate DOUBLE PRECISION`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fx_markup_bps INTEGER`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS target_currency TEXT`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS target_amount DOUBLE PRECISION`,
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
    // withdrawal_requests 新增字段：手续费快照 + 预计打款日
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fee DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS net_amount DOUBLE PRECISION`,
    `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS payout_date TEXT`,
    // task_transactions 费率快照
    `ALTER TABLE task_transactions ADD COLUMN IF NOT EXISTS platform_fee_rate DOUBLE PRECISION`,
    // brand_profiles 账户协议费率
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override DOUBLE PRECISION`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_note TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_by TEXT`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_at TEXT`,
    // 商户信用额度 + 充值状态（2026-07-10）
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS has_topped_up BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS first_publish_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS credit_limit_override DOUBLE PRECISION`,
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
    `INSERT INTO platform_settings (key, value, note) VALUES
      ('merchant_initial_credit', '5000', '商户信用额度默认值（JPY，可被 credit_limit_override 覆盖）'),
      ('fast_payout_threshold',   '100000', '极速打款余额门槛（JPY，发布时余额达到此值则标记极速打款）')
     ON CONFLICT (key) DO NOTHING`,
    `ALTER TABLE task_applications ADD COLUMN IF NOT EXISTS review_note TEXT`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_role TEXT`,
    // 任务报酬字段语义重构（commission 废弃，拆分为三个明确字段）
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payout_per_herald DOUBLE PRECISION NOT NULL DEFAULT 0`,
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
  ];
  for (const m of migrations) {
    await pool.query(m);
  }
}

