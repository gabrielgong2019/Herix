/**
 * 营销顾问订阅（2026-07-26 P1）：状态机/计价/扣款/生命周期 sweep 全部收口在此。
 *
 * 状态机（对齐 Stripe 语义砍到最简）:
 *   PENDING_PAYMENT ─余额足,sweep扣款─▶ ACTIVE ─到期,auto_renew+余额足─▶ ACTIVE(新周期)
 *        │商户取消                        │到期,余额不足或关闭续费
 *        ▼                               ▼
 *     CANCELED             auto_renew? PAST_DUE(宽限N天每日重试) : EXPIRED
 *                                        │宽限满
 *                                        ▼
 *                                     EXPIRED（发布并发回落阶梯，已发任务不受影响）
 *
 * 记账原则：钱包充值(TOPUP)与订阅扣费(SUBSCRIPTION_FEE)是两笔独立账目——
 * 充值只进余额，激活器确认"有待付订阅且余额足"后显式扣款（幂等键=发票号），
 * 平台侧记 SUBSCRIPTION_INCOME，发票 PAID 并关联钱包账目构成铁证链。
 * ACTIVE/PAST_DUE（宽限期内）都享有订阅权益（发布不限并发）。
 */
import { findOne, findMany, insert } from './db';
import { getBalance, chargeSubscription, creditSubIncome, PLATFORM_USER_ID } from './wallet';
import { getSetting } from './settings';
import { notify } from './notify';
import pool from '../db';

export interface SubscriptionPlan {
  code: string;
  monthly_price: number | null;
  benefits: string;            // JSON: {guaranteedTasks, commissionDiscount}
  active: number;
  sort: number;
}

export interface MerchantSubscription {
  id: string;
  brand_user_id: string;
  plan_code: string;
  billing_cycle: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  price_snapshot: number;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';
  current_period_start: string | null;
  current_period_end: string | null;
  auto_renew: number;
  advisor_note: string | null;
  renewal_reminded_at: string | null;
  commission_backup: string | null;
}

const CYCLE_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** 周期应付金额 = 月价 × 月数 × 周期折扣（季95折/年88折，settings 可调），四舍五入到整円 */
export async function cycleAmount(monthlyPrice: number, cycle: string): Promise<number> {
  const months = CYCLE_MONTHS[cycle] || 1;
  const discount = cycle === 'QUARTERLY'
    ? Number(await getSetting('sub_discount_quarterly')) || 1
    : cycle === 'ANNUAL'
      ? Number(await getSetting('sub_discount_annual')) || 1
      : 1;
  return Math.round(monthlyPrice * months * discount);
}

export function addMonths(fromIso: string, months: number): string {
  const d = new Date(fromIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

/** 有效订阅（含宽限期）：发布并发闸/权益判定用这一个口径 */
export async function getActiveSubscription(brandUserId: string): Promise<MerchantSubscription | undefined> {
  return findOne<MerchantSubscription>(
    `SELECT * FROM merchant_subscriptions
     WHERE brand_user_id = ? AND status IN ('ACTIVE', 'PAST_DUE')
     ORDER BY created_at DESC LIMIT 1`, [brandUserId]);
}

/** 请求书号：HXS-YYYYMM-随机段（唯一索引兜底） */
function invoiceNo(): string {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `HXS-${ym}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** 开票（幂等语义：一个订阅同时只有一张待付发票）。
 *  已有 PENDING 且金额一致 → 复用（周期起点以扣款时刻为准，此处仅展示用）；
 *  金额不一致（admin 改价）→ 作废旧票换新。
 *  ⚠️ 不能按 period_start 做幂等键：下单与 sweep 各自取"当前时刻"，毫秒必不相同，
 *  曾导致同一订阅双开发票（2026-07-26 浏览器走查发现） */
export async function ensureInvoice(subId: string, periodStart: string, periodEnd: string, amount: number) {
  const pending = await findOne<any>(
    `SELECT * FROM subscription_invoices
     WHERE subscription_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`, [subId]);
  if (pending && Number(pending.amount) === amount) return pending;
  if (pending) {
    await pool.query(`UPDATE subscription_invoices SET status = 'VOID' WHERE id = $1`, [pending.id]);
  }
  const id = await insert('subscription_invoices', {
    subscription_id: subId, invoice_no: invoiceNo(),
    period_start: periodStart, period_end: periodEnd, amount,
    status: 'PENDING', created_at: new Date().toISOString(),
  });
  return findOne<any>('SELECT * FROM subscription_invoices WHERE id = ?', [id]);
}

/** 套用订阅佣金折扣：备份原 override 后写入更低费率（只降不升），到期/取消忠实还原 */
async function applyCommissionBenefit(sub: MerchantSubscription): Promise<void> {
  const plan = await findOne<SubscriptionPlan>('SELECT * FROM subscription_plans WHERE code = ?', [sub.plan_code]);
  let discount = 0;
  try { discount = Number(JSON.parse(plan?.benefits || '{}').commissionDiscount) || 0; } catch { /* 权益配置损坏则不套用 */ }
  if (discount <= 0) return;

  const bp = await pool.query('SELECT commission_rate_override FROM brand_profiles WHERE user_id = $1', [sub.brand_user_id]);
  const currentOverride = bp.rows[0]?.commission_rate_override;
  const globalRate = Number(await getSetting('commission_rate')) || 0.2;
  const baseRate = (currentOverride !== null && currentOverride !== undefined) ? Number(currentOverride) : globalRate;
  const newRate = Math.max(0, Math.round((baseRate - discount) * 1000) / 1000);
  if (newRate >= baseRate) return; // 已有更低协议价：不动（min 保护，不涨价）

  await pool.query(
    `UPDATE merchant_subscriptions SET commission_backup = $1, updated_at = $2 WHERE id = $3`,
    [JSON.stringify({ had: currentOverride !== null && currentOverride !== undefined, value: currentOverride }),
     new Date().toISOString(), sub.id]);
  await pool.query(
    `UPDATE brand_profiles SET commission_rate_override = $1,
            commission_rate_override_note = $2, commission_rate_override_at = $3
     WHERE user_id = $4`,
    [newRate, `订阅权益（${sub.plan_code}）自动套用 -${discount * 100}pt`, new Date().toISOString(), sub.brand_user_id]);
}

/** 还原佣金折扣（仅当折扣是订阅套用的：commission_backup 非空） */
async function restoreCommissionBenefit(sub: MerchantSubscription): Promise<void> {
  if (!sub.commission_backup) return;
  let backup: { had: boolean; value: number | null };
  try { backup = JSON.parse(sub.commission_backup); } catch { return; }
  await pool.query(
    `UPDATE brand_profiles SET commission_rate_override = $1,
            commission_rate_override_note = $2, commission_rate_override_at = $3
     WHERE user_id = $4`,
    [backup.had ? backup.value : null, '订阅结束，佣金折扣还原', new Date().toISOString(), sub.brand_user_id]);
  await pool.query(
    `UPDATE merchant_subscriptions SET commission_backup = NULL, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), sub.id]);
}

export type ChargeResult =
  | { ok: true }
  | { ok: false; code: 'INSUFFICIENT_BALANCE'; needed: number; available: number };

/**
 * 激活/续期核心：余额检查 → CAS 抢占 → 扣款（幂等键=发票id）→ 发票 PAID → 周期推进 → 权益 → 通知。
 * firstActivation=true 时周期从 now 起算；续期从 current_period_end 顺延（不吃亏不重叠）。
 */
export async function activateOrRenew(sub: MerchantSubscription, opts?: { actor?: string }): Promise<ChargeResult> {
  const now = new Date().toISOString();
  // 入口 reload：sweep 与 admin 手动激活可能并发，先确认还没被对方处理过
  //（处理中窗口内两方通过 ensureInvoice 拿到同一张 PENDING → 扣款幂等键相同，不会双扣）
  const fresh = await findOne<MerchantSubscription>('SELECT * FROM merchant_subscriptions WHERE id = ?', [sub.id]);
  if (!fresh) return { ok: true };
  const first = fresh.status === 'PENDING_PAYMENT';
  if (sub.status === 'PENDING_PAYMENT' && !first) return { ok: true };          // 已被激活
  if (!first && fresh.current_period_end && fresh.current_period_end > now) {
    return { ok: true };                                                        // 已被续期（周期已推进）
  }
  sub = fresh;
  const periodStart = first ? now : (sub.current_period_end || now);
  const periodEnd = addMonths(periodStart, CYCLE_MONTHS[sub.billing_cycle] || 1);
  const invoice = await ensureInvoice(sub.id, periodStart, periodEnd, sub.price_snapshot);

  const bal = await getBalance(sub.brand_user_id, 'brand');
  if (bal.available < invoice.amount) {
    return { ok: false, code: 'INSUFFICIENT_BALANCE', needed: invoice.amount, available: bal.available };
  }

  // 先扣款后置 ACTIVE（顺序不能反：先置态再扣款会在扣款异常时留下"已激活未付款"）。
  // 并发防双扣由幂等键兜底：sweep 与 admin 手动激活同时进来只会真扣一次，
  // 第二个调用者幂等命中拿到同一账目，后续 UPDATE 是相同值幂等无害
  const { entryId } = await chargeSubscription({
    userId: sub.brand_user_id, amount: invoice.amount,
    idempotencyKey: `SUBFEE:${invoice.id}`,
    referenceType: 'subscription_invoice', referenceId: invoice.id,
    note: `营销顾问订阅（${sub.plan_code}/${sub.billing_cycle}）${invoice.invoice_no}`,
  });
  await creditSubIncome({
    userId: PLATFORM_USER_ID, amount: invoice.amount,
    idempotencyKey: `SUBINC:${invoice.id}`,
    referenceType: 'subscription_invoice', referenceId: invoice.id,
    note: `订阅收入 ${invoice.invoice_no}`,
  });
  await pool.query(
    `UPDATE subscription_invoices SET status = 'PAID', wallet_entry_id = $1, paid_at = $2 WHERE id = $3`,
    [entryId, now, invoice.id]);
  await pool.query(
    `UPDATE merchant_subscriptions SET status = 'ACTIVE',
            current_period_start = $1, current_period_end = $2,
            renewal_reminded_at = NULL, updated_at = $3
     WHERE id = $4 AND status IN ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE')`,
    [periodStart, periodEnd, now, sub.id]);

  if (first) await applyCommissionBenefit({ ...sub, status: 'ACTIVE' });

  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [sub.brand_user_id]);
  await notify({
    userId: sub.brand_user_id, email: u?.email, targetRole: 'BRAND',
    type: first ? 'SUBSCRIPTION_ACTIVATED' : 'SUBSCRIPTION_RENEWED',
    title: first ? '营销顾问服务已生效' : '订阅已自动续期',
    body: `您的营销顾问订阅（${sub.plan_code}）已${first ? '生效' : '续期'}，本期至 ${periodEnd.slice(0, 10)}，已从余额扣除 ¥${invoice.amount.toLocaleString()}（${invoice.invoice_no}）。`,
    metadata: { subscriptionId: sub.id, invoiceNo: invoice.invoice_no, amount: invoice.amount, periodEnd },
  }).catch((e) => console.error('[sub] notify failed:', e));
  return { ok: true };
}

/** 订阅到期/宽限期满：回落阶梯 + 还原佣金 + 通知 */
async function expireSubscription(sub: MerchantSubscription): Promise<void> {
  const claim = await pool.query(
    `UPDATE merchant_subscriptions SET status = 'EXPIRED', updated_at = $1
     WHERE id = $2 AND status IN ('ACTIVE', 'PAST_DUE')`,
    [new Date().toISOString(), sub.id]);
  if (claim.rowCount === 0) return;
  await restoreCommissionBenefit(sub);
  const u = await findOne<any>('SELECT email FROM users WHERE id = ?', [sub.brand_user_id]);
  await notify({
    userId: sub.brand_user_id, email: u?.email, targetRole: 'BRAND',
    type: 'SUBSCRIPTION_EXPIRED',
    title: '营销顾问订阅已到期',
    body: '您的订阅已到期，发布数量回落至阶梯默认；进行中的任务不受影响。可随时重新订阅恢复权益。',
    metadata: { subscriptionId: sub.id },
  }).catch((e) => console.error('[sub] notify failed:', e));
}

/** 订阅生命周期单轮扫描（导出供测试/运维直调） */
export async function sweepSubscriptionsOnce(): Promise<{ activated: number; renewed: number; reminded: number; pastDue: number; expired: number }> {
  const now = new Date().toISOString();
  const remindDays = Number(await getSetting('sub_remind_days')) || 10;
  const graceDays = Number(await getSetting('sub_grace_days')) || 7;
  const out = { activated: 0, renewed: 0, reminded: 0, pastDue: 0, expired: 0 };

  // 1. 待付订阅：余额足则扣款激活（商户请求书充值到账后自动生效的入口）。
  // 单条 try/catch：一个坏订阅不拖垮整轮 sweep（下同）
  const pending = await findMany<MerchantSubscription>(
    `SELECT * FROM merchant_subscriptions WHERE status = 'PENDING_PAYMENT'`);
  for (const sub of pending) {
    try {
      const r = await activateOrRenew(sub);
      if (r.ok) out.activated++;
    } catch (e) { console.error(`[subs] activate failed sub=${sub.id}:`, e); }
  }

  // 2. 到期前提醒（只发一次）：应备金额 = 续期费 + 在途任务占用，提醒余额同时覆盖两者
  const remindCutoff = addMonths(now, 0); // now
  const toRemind = await findMany<MerchantSubscription>(
    `SELECT * FROM merchant_subscriptions
     WHERE status = 'ACTIVE' AND auto_renew = 1 AND renewal_reminded_at IS NULL
       AND current_period_end <= ?`,
    [new Date(Date.now() + remindDays * 86400_000).toISOString()]);
  for (const sub of toRemind) {
    if (!sub.current_period_end || sub.current_period_end <= remindCutoff) continue; // 已到期的走续期分支
    const u = await findOne<any>('SELECT email FROM users WHERE id = ?', [sub.brand_user_id]);
    await notify({
      userId: sub.brand_user_id, email: u?.email, targetRole: 'BRAND',
      type: 'SUBSCRIPTION_RENEWAL_DUE',
      title: `订阅将于 ${sub.current_period_end.slice(0, 10)} 自动续期`,
      body: `您的营销顾问订阅将自动续期，应付 ¥${sub.price_snapshot.toLocaleString()}。请确保账户余额同时覆盖续期费与进行中任务的结算备付金；余额不足将进入 ${graceDays} 天宽限期。如需取消自动续费可在订阅页操作。`,
      metadata: { subscriptionId: sub.id, amount: sub.price_snapshot, periodEnd: sub.current_period_end },
    }).catch((e) => console.error('[sub] remind failed:', e));
    await pool.query('UPDATE merchant_subscriptions SET renewal_reminded_at = $1 WHERE id = $2', [now, sub.id]);
    out.reminded++;
  }

  // 3. 到期处理：关自动续费→直接到期；开→尝试扣款，失败进宽限
  const due = await findMany<MerchantSubscription>(
    `SELECT * FROM merchant_subscriptions WHERE status = 'ACTIVE' AND current_period_end <= ?`, [now]);
  for (const sub of due) {
    try {
    if (!sub.auto_renew) { await expireSubscription(sub); out.expired++; continue; }
    const r = await activateOrRenew(sub);
    if (r.ok) { out.renewed++; continue; }
    await pool.query(
      `UPDATE merchant_subscriptions SET status = 'PAST_DUE', updated_at = $1 WHERE id = $2 AND status = 'ACTIVE'`,
      [now, sub.id]);
    out.pastDue++;
    const u = await findOne<any>('SELECT email FROM users WHERE id = ?', [sub.brand_user_id]);
    await notify({
      userId: sub.brand_user_id, email: u?.email, targetRole: 'BRAND',
      type: 'SUBSCRIPTION_PAST_DUE',
      title: '订阅续期扣款失败 — 请充值',
      body: `续期需 ¥${r.code === 'INSUFFICIENT_BALANCE' ? r.needed.toLocaleString() : sub.price_snapshot.toLocaleString()}，当前余额不足。${graceDays} 天宽限期内充值到账即自动续期，逾期订阅将到期回落。`,
      metadata: { subscriptionId: sub.id },
    }).catch((e) => console.error('[sub] past-due notify failed:', e));
    } catch (e) { console.error(`[subs] renew failed sub=${sub.id}:`, e); }
  }

  // 4. 宽限期：每轮重试扣款；宽限满则到期
  const pastDue = await findMany<MerchantSubscription>(
    `SELECT * FROM merchant_subscriptions WHERE status = 'PAST_DUE'`);
  for (const sub of pastDue) {
    try {
      const graceEnd = new Date(new Date(sub.current_period_end || now).getTime() + graceDays * 86400_000).toISOString();
      if (graceEnd <= now) { await expireSubscription(sub); out.expired++; continue; }
      const r = await activateOrRenew(sub);
      if (r.ok) out.renewed++;
    } catch (e) { console.error(`[subs] grace retry failed sub=${sub.id}:`, e); }
  }

  return out;
}

/** 启动：45 秒后首跑（错开 submissionTimers），此后每小时一轮 */
export function startSubscriptionSweep(): void {
  const run = () =>
    sweepSubscriptionsOnce()
      .then((r) => {
        if (r.activated || r.renewed || r.reminded || r.pastDue || r.expired) {
          console.log(`[subs] activated=${r.activated} renewed=${r.renewed} reminded=${r.reminded} pastDue=${r.pastDue} expired=${r.expired}`);
        }
      })
      .catch((e) => console.error('[subs] sweep failed:', e));
  setTimeout(run, 45_000);
  setInterval(run, 3600_000);
}
