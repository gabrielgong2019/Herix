import pool from '../db';

const DEFAULTS: Record<string, string> = {
  commission_rate:          '0.15',
  withdrawal_fee_type:      'FLAT',
  withdrawal_fee_flat:      '500',
  withdrawal_schedule_mode: 'FIXED_DATES',
  withdrawal_monthly_limit: '2',
  withdrawal_min_amount:    '1000',
  topup_cc_rate:            '0.03',
  merchant_initial_credit:  '5000',
  fast_payout_threshold:    '100000',
};

export async function getSetting(key: string): Promise<string> {
  const r = await pool.query('SELECT value FROM platform_settings WHERE key = $1', [key]);
  return r.rows[0]?.value ?? DEFAULTS[key] ?? '';
}

export async function setSetting(
  key: string,
  value: string,
  updatedBy?: string,
  note?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO platform_settings (key, value, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           note = COALESCE(EXCLUDED.note, platform_settings.note),
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
    [key, value, note ?? null, updatedBy ?? null, new Date().toISOString()],
  );
}

/** 计算下一个打款日（月中15日或月末最后一天） */
export function nextPayoutDate(): string {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = now.getMonth();
  const day  = now.getDate();
  const last = new Date(y, m + 1, 0).getDate();

  if (day < 15)    return `${y}-${String(m + 1).padStart(2, '0')}-15`;
  if (day < last)  return new Date(y, m, last).toISOString().split('T')[0];
  // 今天已是月末 → 下月15日
  return `${y}-${String(m + 2).padStart(2, '0')}-15`;
}

/** 计算提现手续费（从已保存的快照或当前设置） */
export async function calcWithdrawalFee(requestAmount: number): Promise<{
  fee: number;
  netAmount: number;
  payoutDate: string;
}> {
  const type    = await getSetting('withdrawal_fee_type');
  const flat    = Number(await getSetting('withdrawal_fee_flat')) || 500;
  const minAmt  = Number(await getSetting('withdrawal_min_amount')) || 1000;
  const mode    = await getSetting('withdrawal_schedule_mode');

  if (requestAmount < minAmt) {
    throw Object.assign(new Error(`最低提现金额 ¥${minAmt}`), { code: 'MIN_AMOUNT' });
  }

  const fee = type === 'NONE' ? 0 : flat;
  if (requestAmount <= fee) {
    throw Object.assign(new Error(`提现金额须高于手续费 ¥${fee}`), { code: 'AMOUNT_TOO_LOW' });
  }

  return {
    fee,
    netAmount:  requestAmount - fee,
    payoutDate: mode === 'FIXED_DATES' ? nextPayoutDate() : 'immediate',
  };
}

export interface BrandCreditInfo {
  availableBalance: number;
  initialCredit:    number;  // 信用额度上限
  creditUsed:       number;  // 已通过审核但尚未结算的应用金额之和
  creditRemaining:  number;  // max(0, initialCredit - creditUsed)
  totalCapacity:    number;  // max(0, initialCredit + availableBalance - creditUsed)
  hasToppedUp:      boolean;
}

/** 商户信用额度状态：可用余额 + 初始信用 */
export async function getBrandCreditInfo(brandUserId: string): Promise<BrandCreditInfo> {
  const bp = await pool.query(
    'SELECT has_topped_up, credit_limit_override FROM brand_profiles WHERE user_id = $1',
    [brandUserId],
  );
  const hasToppedUp: boolean = bp.rows[0]?.has_topped_up ?? false;
  const creditLimitOverride = bp.rows[0]?.credit_limit_override;

  const walletRow = await pool.query(
    `SELECT available_balance FROM wallets
     WHERE user_id = $1 AND wallet_type = 'brand' AND currency = 'JPY'`,
    [brandUserId],
  );
  const availableBalance = Number(walletRow.rows[0]?.available_balance) || 0;

  const globalDefault = Number(await getSetting('merchant_initial_credit')) || 5000;
  const initialCredit = (creditLimitOverride !== null && creditLimitOverride !== undefined)
    ? Number(creditLimitOverride)
    : globalDefault;

  // 信用占用 = 已审核通过的 STD 任务报名，排除已有通过提交（已结算）的
  const usedRow = await pool.query(
    `SELECT COALESCE(SUM(t.cost_per_herald), 0) AS total
     FROM task_applications ta
     JOIN tasks t ON t.id = ta.task_id
     WHERE t.creator_id = $1
       AND ta.status = 'APPROVED'
       AND t.status IN ('OPEN', 'IN_PROGRESS')
       AND t.mode = 'STD'
       AND NOT EXISTS (
         SELECT 1 FROM task_submissions ts
         WHERE ts.task_id = ta.task_id
           AND ts.herald_id = ta.herald_id
           AND ts.status = 'APPROVED'
       )`,
    [brandUserId],
  );
  const creditUsed      = Number(usedRow.rows[0]?.total) || 0;
  const creditRemaining = Math.max(0, initialCredit - creditUsed);
  // 总剩余可承诺额度 = 总预算 - 已承诺
  const totalCapacity   = Math.max(0, initialCredit + availableBalance - creditUsed);

  return {
    availableBalance,
    initialCredit,
    creditUsed,
    creditRemaining,
    totalCapacity,
    hasToppedUp,
  };
}

/** 有效抽佣比例。决策链（2026-07-16 定稿，含促销层）：
 *
 *   有效费率 = min( 基础费率, 生效促销费率 )
 *     基础费率 = 商家协议价(commission_rate_override) ?? 全局默认(commission_rate, 0.20)
 *     生效促销 = min( 生效中的全局促销, 生效中的该商家促销 )   // pricing_promotions
 *     min 保护 = 促销只降不升：协议价已低于促销价时按协议价
 *
 *   生效时点：任务【发布】时快照进 tasks.commission_rate（tasks.ts），
 *   促销影响促销期内新发布的任务，已发布任务不回溯。
 */
export async function getEffectiveCommissionRate(brandUserId: string): Promise<{
  rate: number;
  isOverride: boolean; // 兼容旧调用方
  source: 'default' | 'brand_override' | 'promo_global' | 'promo_brand';
  promoId?: string;
}> {
  // 基础费率
  const r = await pool.query(
    'SELECT commission_rate_override FROM brand_profiles WHERE user_id = $1',
    [brandUserId],
  );
  const override = r.rows[0]?.commission_rate_override;
  let rate: number;
  let source: 'default' | 'brand_override' | 'promo_global' | 'promo_brand';
  if (override !== null && override !== undefined) {
    rate = Number(override);
    source = 'brand_override';
  } else {
    rate = Number(await getSetting('commission_rate')) || 0.20;
    source = 'default';
  }

  // 生效促销（未取消 + 时间窗内；全局 + 该商家），取最低
  const now = new Date().toISOString();
  const promos = await pool.query(
    `SELECT id, scope, rate FROM pricing_promotions
     WHERE cancelled_at IS NULL AND starts_at <= $1 AND ends_at > $1
       AND (scope = 'global' OR (scope = 'brand' AND brand_id = $2))
     ORDER BY rate ASC LIMIT 1`,
    [now, brandUserId],
  );
  const best = promos.rows[0];
  if (best && Number(best.rate) < rate) {
    rate = Number(best.rate);
    source = best.scope === 'global' ? 'promo_global' : 'promo_brand';
    return { rate, isOverride: false, source, promoId: best.id }; // 促销生效时最终费率非协议价
  }

  return { rate, isOverride: source === 'brand_override', source };
}
