import pool from '../db';

const DEFAULTS: Record<string, string> = {
  commission_rate:          '0.15',
  withdrawal_fee_type:      'FLAT',
  withdrawal_fee_flat:      '500',
  withdrawal_schedule_mode: 'FIXED_DATES',
  withdrawal_monthly_limit: '2',
  withdrawal_min_amount:    '1000',
  topup_cc_rate:            '0.03',
  merchant_trial_credit:    '3000',
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

/** 转出国 V1 恒日本（2026-07-17 拍板：钱包混池，按商家实体分仓留待多国实体阶段） */
export const PAYOUT_FROM_COUNTRY = 'JP';

/** 国家 → 打款目标币种（跨境规则配到哪国就在这加映射） */
const COUNTRY_CURRENCY: Record<string, string> = { JP: 'JPY', CN: 'CNY' };

/** 收款国归一化：兼容 'japan'/'china'/'jp'/'CN' 等历史写法 */
export function normalizeCountry(raw?: string | null): string {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'JAPAN') return 'JP';
  if (s === 'CHINA') return 'CN';
  return s || 'JP';
}

function tierFee(tiersJson: string, amount: number): number {
  try {
    const tiers: Array<{ upTo: number | null; fee: number }> = JSON.parse(tiersJson);
    for (const t of tiers) {
      if (t.upTo === null || amount <= t.upTo) return Number(t.fee) || 0;
    }
  } catch { /* 配置损坏走兜底 */ }
  return NaN;
}

export interface WithdrawalFeeInfo {
  fee: number;
  netAmount: number;      // 扣费后 JPY
  payoutDate: string;
  toCountry: string;
  /** 跨境时存在：申请时锁定的汇率信息 */
  fxMidRate?: number;
  fxMarkupBps?: number;
  fxEffectiveRate?: number;
  targetCurrency?: string;
  targetAmount?: number;  // 赫使预计到手（目标币种）
}

/** 计算提现费用（2026-07-17 重写：payout_fee_rules 阶梯 + 跨境汇率加点，申请时锁价）。
 *  查无规则回退旧 flat 逻辑（兼容未配置的目的国）。 */
export async function calcWithdrawalFee(requestAmount: number, toCountryRaw?: string | null): Promise<WithdrawalFeeInfo> {
  const minAmt = Number(await getSetting('withdrawal_min_amount')) || 1000;
  const mode   = await getSetting('withdrawal_schedule_mode');
  if (requestAmount < minAmt) {
    throw Object.assign(new Error(`最低提现金额 ¥${minAmt}`), { code: 'MIN_AMOUNT' });
  }
  const payoutDate = mode === 'FIXED_DATES' ? nextPayoutDate() : 'immediate';
  const toCountry = normalizeCountry(toCountryRaw);

  const rule = await pool.query(
    `SELECT tiers, fx_markup_bps FROM payout_fee_rules WHERE from_country = $1 AND to_country = $2 AND currency = 'JPY'`,
    [PAYOUT_FROM_COUNTRY, toCountry]
  );

  let fee: number;
  if (rule.rows[0]) {
    fee = tierFee(rule.rows[0].tiers, requestAmount);
    if (!Number.isFinite(fee)) fee = Number(await getSetting('withdrawal_fee_flat')) || 500;
  } else {
    // 目的国未配置规则：回退全局 flat（老行为）
    const type = await getSetting('withdrawal_fee_type');
    fee = type === 'NONE' ? 0 : Number(await getSetting('withdrawal_fee_flat')) || 500;
  }
  if (requestAmount <= fee) {
    throw Object.assign(new Error(`提现金额须高于手续费 ¥${fee}`), { code: 'AMOUNT_TOO_LOW' });
  }
  const netAmount = requestAmount - fee;

  // 跨境：锁定申请时的中间价 ×（1 − 加点）
  if (rule.rows[0] && toCountry !== PAYOUT_FROM_COUNTRY) {
    const targetCurrency = COUNTRY_CURRENCY[toCountry];
    const mid = Number(await getSetting(`fx_mid_JPY_${targetCurrency}`));
    if (targetCurrency && mid > 0) {
      const bps = Number(rule.rows[0].fx_markup_bps) || 0;
      const eff = mid * (1 - bps / 10000);
      return {
        fee, netAmount, payoutDate, toCountry,
        fxMidRate: mid, fxMarkupBps: bps,
        fxEffectiveRate: Math.round(eff * 1e6) / 1e6,
        targetCurrency,
        targetAmount: Math.round(netAmount * eff * 100) / 100,
      };
    }
    // 汇率未配置：手续费照收，目标币金额不承诺（打款时人工处理）
  }

  return { fee, netAmount, payoutDate, toCountry };
}

export interface BrandCreditInfo {
  availableBalance: number;
  initialCredit:    number;  // KYB/admin 提额（credit_limit_override），未提额为 0
  creditUsed:       number;  // 全部进行中 STANDARD 任务的已承诺报酬（审核通过、未结算）
  creditRemaining:  number;  // max(0, initialCredit - 共享池占用)
  totalCapacity:    number;  // 共享池容量：发布新任务、无体验额度任务运行用这个口径
  hasToppedUp:      boolean;
  trialEligible:    boolean; // 首单体验额度资格：从未发放过 且 名下无已发布任务
  trialDefault:     number;  // 当前配置的体验额度（发放时以 min(配置, 任务总成本) 快照进任务行）
  trialRemainingForTask: number; // forTaskId 任务的体验额度剩余（未传参/无戳为 0）
  capacityForTask:  number;  // 针对 forTaskId 的可用容量 = totalCapacity + trialRemainingForTask
}

/** 商户额度状态。
 *
 *  体验额度架构（2026-07-18）：新商家的免费额度不是挂在商家身上的信用池，而是
 *  首单发布时盖在任务行上的一次性戳（tasks.trial_credit_amount，write-once），
 *  brand_profiles.trial_task_id 记录发放去向防止重复领取。每个任务的占用先吃
 *  自己的戳，吃不完才占共享池（钱包+KYB提额）——所以体验额度只对首单自身可见，
 *  发第二单时一分钱都漏不过去；首单关闭后戳随任务状态自动退出所有算式，
 *  没有"失效"动作，也就没有失效 bug。
 *
 *  @param forTaskId 针对某个具体任务做容量判断时传入（报名审批门槛），
 *                   返回值里的 capacityForTask 会叠加该任务自己的体验额度剩余 */
export async function getBrandCreditInfo(brandUserId: string, forTaskId?: string): Promise<BrandCreditInfo> {
  const bp = await pool.query(
    'SELECT has_topped_up, credit_limit_override, trial_task_id FROM brand_profiles WHERE user_id = $1',
    [brandUserId],
  );
  const hasToppedUp: boolean = bp.rows[0]?.has_topped_up ?? false;
  const creditLimitOverride = bp.rows[0]?.credit_limit_override;
  const trialTaskId: string | null = bp.rows[0]?.trial_task_id || null;

  const walletRow = await pool.query(
    `SELECT available_balance FROM wallets
     WHERE user_id = $1 AND wallet_type = 'brand' AND currency = 'JPY'`,
    [brandUserId],
  );
  const availableBalance = Number(walletRow.rows[0]?.available_balance) || 0;

  const initialCredit = (creditLimitOverride !== null && creditLimitOverride !== undefined)
    ? Number(creditLimitOverride) : 0;

  // 按任务分组统计占用（审核通过的报名，排除已结算的）+ 任务行上的体验额度戳。
  // ⚠️ mode 值是 'STANDARD'——此处曾写成 'STD' 匹配不到任何行，占用统计恒为 0（2026-07-18 修复）
  const rows = await pool.query(
    `SELECT t.id, COALESCE(t.trial_credit_amount, 0) AS trial,
            COALESCE(SUM(t.cost_per_herald) FILTER (WHERE ta.id IS NOT NULL), 0) AS committed
     FROM tasks t
     LEFT JOIN task_applications ta ON ta.task_id = t.id AND ta.status = 'APPROVED'
       AND NOT EXISTS (
         SELECT 1 FROM task_submissions ts
         WHERE ts.task_id = ta.task_id
           AND ts.herald_id = ta.herald_id
           AND ts.status = 'APPROVED'
       )
     WHERE t.creator_id = $1 AND t.status IN ('OPEN', 'IN_PROGRESS') AND t.mode = 'STANDARD'
     GROUP BY t.id, t.trial_credit_amount`,
    [brandUserId],
  );
  let creditUsed = 0;   // 总承诺（给 dashboard 催充值横幅等展示用）
  let sharedUsed = 0;   // 占用共享池的部分 = Σ max(0, 任务占用 - 任务的戳)
  let trialRemainingForTask = 0;
  for (const r of rows.rows) {
    const committed = Number(r.committed) || 0;
    const trial = Number(r.trial) || 0;
    creditUsed += committed;
    sharedUsed += Math.max(0, committed - trial);
    if (forTaskId && r.id === forTaskId) trialRemainingForTask = Math.max(0, trial - committed);
  }

  const creditRemaining = Math.max(0, initialCredit - sharedUsed);
  const totalCapacity   = Math.max(0, initialCredit + availableBalance - sharedUsed);

  const trialDefault = Number(await getSetting('merchant_trial_credit')) || 0;
  let trialEligible = false;
  if (!trialTaskId && trialDefault > 0) {
    const prev = await pool.query(
      `SELECT 1 FROM tasks WHERE creator_id = $1 AND status != 'DRAFT' LIMIT 1`,
      [brandUserId],
    );
    trialEligible = prev.rows.length === 0;
  }

  return {
    availableBalance,
    initialCredit,
    creditUsed,
    creditRemaining,
    totalCapacity,
    hasToppedUp,
    trialEligible,
    trialDefault,
    trialRemainingForTask,
    capacityForTask: totalCapacity + trialRemainingForTask,
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
