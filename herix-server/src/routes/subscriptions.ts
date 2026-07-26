/**
 * 营销顾问订阅（2026-07-26 P1）——商户端自助订阅 + admin 订阅队列。
 * 支付走钱包余额（请求书充值→到账→sweep 自动扣款激活），不接支付网关。
 * 状态机与扣款收口在 utils/subscriptions.ts，路由只做参数校验与权限。
 */
import { Router, Request, Response } from 'express';
import { findOne, findMany, insert } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { getSetting } from '../utils/settings';
import { getBalance } from '../utils/wallet';
import {
  cycleAmount, getActiveSubscription, ensureInvoice, addMonths,
  activateOrRenew, type MerchantSubscription, type SubscriptionPlan,
} from '../utils/subscriptions';
import pool from '../db';

export const subscriptionsRouter = Router();

/** GET /api/subscriptions/plans — 档位与三周期报价（登录即可看，定价页用） */
subscriptionsRouter.get('/plans', requireAuth, async (_req: Request, res: Response) => {
  const [plans, dq, da] = await Promise.all([
    findMany<SubscriptionPlan>('SELECT * FROM subscription_plans WHERE active = 1 ORDER BY sort'),
    getSetting('sub_discount_quarterly'),
    getSetting('sub_discount_annual'),
  ]);
  const rows = await Promise.all(plans.map(async (p) => {
    let benefits: Record<string, unknown> = {};
    try { benefits = JSON.parse(p.benefits || '{}'); } catch { /* 配置损坏当空权益 */ }
    const monthly = p.monthly_price === null ? null : Number(p.monthly_price);
    return {
      code: p.code,
      monthlyPrice: monthly,
      benefits,
      pricing: monthly === null ? null : {
        MONTHLY: await cycleAmount(monthly, 'MONTHLY'),
        QUARTERLY: await cycleAmount(monthly, 'QUARTERLY'),
        ANNUAL: await cycleAmount(monthly, 'ANNUAL'),
      },
    };
  }));
  res.json({ plans: rows, discounts: { quarterly: Number(dq), annual: Number(da) } });
});

/** GET /api/subscriptions/mine — 我的订阅（当前 + 全部发票） */
subscriptionsRouter.get('/mine', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const sub = await findOne<MerchantSubscription>(
    `SELECT * FROM merchant_subscriptions WHERE brand_user_id = ?
     ORDER BY created_at DESC LIMIT 1`, [req.user!.userId]);
  if (!sub) return res.json({ subscription: null, invoices: [] });
  const invoices = await findMany<any>(
    `SELECT * FROM subscription_invoices WHERE subscription_id = ? ORDER BY created_at DESC`, [sub.id]);
  const bal = await getBalance(req.user!.userId, 'brand');
  res.json({ subscription: sub, invoices, walletAvailable: bal.available });
});

/** POST /api/subscriptions — 下单（生成 PENDING_PAYMENT + 首期请求书）。
 *  custom 档不可自助下单（合同单签，admin 录入）。 */
subscriptionsRouter.post('/', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  try {
    const { planCode, billingCycle } = req.body || {};
    if (!['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(String(billingCycle))) {
      return res.status(400).json({ error: 'billingCycle 须为 MONTHLY / QUARTERLY / ANNUAL' });
    }
    const plan = await findOne<SubscriptionPlan>(
      'SELECT * FROM subscription_plans WHERE code = ? AND active = 1', [planCode]);
    if (!plan) return res.status(404).json({ error: '档位不存在' });
    if (plan.monthly_price === null) {
      return res.status(400).json({ error: '定制版请联系平台，由专属顾问签订合同后开通', code: 'CUSTOM_PLAN_CONTACT' });
    }

    // 生效中订阅不允许重复下单（升降档 P2 做，先到期后换）；
    // 未付款的旧单则自动作废换新（行业惯例：未支付订单可被新订单覆盖，商户换档不卡壳）
    const existing = await findOne<MerchantSubscription>(
      `SELECT * FROM merchant_subscriptions WHERE brand_user_id = ?
       AND status IN ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE')`, [req.user!.userId]);
    if (existing && existing.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: '已有进行中的订阅，如需变更档位请先取消或等本期结束', code: 'SUBSCRIPTION_EXISTS' });
    }
    if (existing) {
      const now0 = new Date().toISOString();
      await pool.query(
        `UPDATE merchant_subscriptions SET status = 'CANCELED', updated_at = $1 WHERE id = $2 AND status = 'PENDING_PAYMENT'`,
        [now0, existing.id]);
      await pool.query(
        `UPDATE subscription_invoices SET status = 'VOID' WHERE subscription_id = $1 AND status = 'PENDING'`, [existing.id]);
    }

    const amount = await cycleAmount(Number(plan.monthly_price), String(billingCycle));
    const now = new Date().toISOString();
    const subId = await insert('merchant_subscriptions', {
      brand_user_id: req.user!.userId, plan_code: plan.code,
      billing_cycle: billingCycle, price_snapshot: amount,
      status: 'PENDING_PAYMENT', auto_renew: 1, created_at: now,
    });
    // 首期发票即刻开出（周期从激活时刻起算，发票 period 先按下单时点占位，激活时以实际为准展示）
    const invoice = await ensureInvoice(subId, now, addMonths(now, { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 }[String(billingCycle)] || 1), amount);

    // 余额已够则立即激活（不用等下一轮 sweep）——充值在先的商户零等待
    const sub = await findOne<MerchantSubscription>('SELECT * FROM merchant_subscriptions WHERE id = ?', [subId]);
    const r = await activateOrRenew(sub!);
    const updated = await findOne<MerchantSubscription>('SELECT * FROM merchant_subscriptions WHERE id = ?', [subId]);
    const bal = await getBalance(req.user!.userId, 'brand');
    res.status(201).json({
      subscription: updated,
      invoice: await findOne('SELECT * FROM subscription_invoices WHERE id = ?', [invoice.id]),
      activated: r.ok,
      walletAvailable: bal.available,
      shortfall: r.ok ? 0 : Math.max(0, amount - bal.available),
    });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: '下单失败' });
  }
});

/** POST /api/subscriptions/inquiries — 定制版洽谈：只收营销需求（公司/联系人平台已有）。
 *  已有未处理线索则不重复建单，返回 existing 让前端提示"已在处理中" */
subscriptionsRouter.post('/inquiries', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const { goals, budgetRange, note } = req.body || {};
  if (!String(goals || '').trim()) {
    return res.status(400).json({ error: '请填写营销目标', code: 'GOALS_REQUIRED' });
  }
  const existing = await findOne<any>(
    `SELECT id FROM subscription_inquiries WHERE brand_user_id = ? AND status = 'NEW'`, [req.user!.userId]);
  if (existing) return res.json({ ok: true, existing: true });
  const id = await insert('subscription_inquiries', {
    brand_user_id: req.user!.userId,
    goals: String(goals).trim(),
    budget_range: budgetRange ? String(budgetRange) : null,
    note: note ? String(note).trim() : null,
    status: 'NEW', created_at: new Date().toISOString(),
  });
  res.status(201).json({ ok: true, id, existing: false });
});

/** GET /api/subscriptions/inquiries/mine — 我的洽谈状态（表单显隐用） */
subscriptionsRouter.get('/inquiries/mine', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const row = await findOne<any>(
    `SELECT id, status, created_at FROM subscription_inquiries
     WHERE brand_user_id = ? ORDER BY created_at DESC LIMIT 1`, [req.user!.userId]);
  res.json({ inquiry: row || null });
});

/** PATCH /api/subscriptions/:id/auto-renew — 自动续费开关（合规：商户可随时取消自动更新） */
subscriptionsRouter.patch('/:id/auto-renew', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const { autoRenew } = req.body || {};
  if (typeof autoRenew !== 'boolean') return res.status(400).json({ error: 'autoRenew 须为布尔值' });
  const r = await pool.query(
    `UPDATE merchant_subscriptions SET auto_renew = $1, updated_at = $2
     WHERE id = $3 AND brand_user_id = $4 AND status IN ('ACTIVE', 'PAST_DUE', 'PENDING_PAYMENT')`,
    [autoRenew ? 1 : 0, new Date().toISOString(), req.params.id, req.user!.userId]);
  if (r.rowCount === 0) return res.status(404).json({ error: '订阅不存在或已结束' });
  res.json({ ok: true, autoRenew });
});

/** POST /api/subscriptions/:id/cancel — 取消：待付→CANCELED；生效中→关自动续费（期末不续，费用不中途退） */
subscriptionsRouter.post('/:id/cancel', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const sub = await findOne<MerchantSubscription>(
    'SELECT * FROM merchant_subscriptions WHERE id = ? AND brand_user_id = ?',
    [req.params.id, req.user!.userId]);
  if (!sub) return res.status(404).json({ error: '订阅不存在' });
  const now = new Date().toISOString();
  if (sub.status === 'PENDING_PAYMENT') {
    await pool.query(
      `UPDATE merchant_subscriptions SET status = 'CANCELED', updated_at = $1 WHERE id = $2 AND status = 'PENDING_PAYMENT'`,
      [now, sub.id]);
    await pool.query(
      `UPDATE subscription_invoices SET status = 'VOID' WHERE subscription_id = $1 AND status = 'PENDING'`, [sub.id]);
    return res.json({ ok: true, status: 'CANCELED' });
  }
  if (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') {
    await pool.query(
      `UPDATE merchant_subscriptions SET auto_renew = 0, updated_at = $1 WHERE id = $2`, [now, sub.id]);
    return res.json({ ok: true, status: sub.status, autoRenew: false, note: '本期到期后不再续费' });
  }
  res.status(400).json({ error: '订阅已结束' });
});
