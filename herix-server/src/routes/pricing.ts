/**
 * 定价管理（admin）——挂载于 adminRouter '/pricing'，鉴权继承 requireRole('ADMIN')。
 *
 * 费率决策链见 utils/settings.ts getEffectiveCommissionRate：
 *   有效 = min( 商家协议价 ?? 全局默认0.20, 生效促销(全局/商家取低) )
 * 促销软删除（cancelled_at），不物理删，保留审计。
 */
import { Router, Request, Response } from 'express';
import pool from '../db';
import { genId } from '../utils/db';
import { getSetting, setSetting } from '../utils/settings';

export const pricingAdminRouter = Router();

const now = () => new Date().toISOString();
const isValidRate = (r: any) => typeof r === 'number' && isFinite(r) && r >= 0 && r < 1;

/** GET /api/admin/pricing — 全局费率 + 商家协议价列表 + 促销列表 */
pricingAdminRouter.get('/', async (_req: Request, res: Response) => {
  const globalRate = Number(await getSetting('commission_rate')) || 0.20;

  const overrides = await pool.query(
    `SELECT bp.user_id, bp.commission_rate_override AS rate, bp.commission_rate_override_note AS note,
            u.nickname, u.email, bp.company_name
     FROM brand_profiles bp JOIN users u ON u.id = bp.user_id
     WHERE bp.commission_rate_override IS NOT NULL
     ORDER BY u.nickname`
  );

  const promotions = await pool.query(
    `SELECT p.*, u.nickname AS brand_nickname
     FROM pricing_promotions p LEFT JOIN users u ON u.id = p.brand_id
     ORDER BY p.created_at DESC LIMIT 100`
  );

  // 商家清单（供下拉选择设置协议价/商家促销）。users.roles 是 TEXT（多角色串），LIKE 匹配
  const brands = await pool.query(
    `SELECT u.id, u.nickname, u.email, bp.company_name, bp.commission_rate_override
     FROM users u LEFT JOIN brand_profiles bp ON bp.user_id = u.id
     WHERE u.role = 'BRAND' OR COALESCE(u.roles, '') LIKE '%BRAND%'
     ORDER BY u.created_at DESC LIMIT 200`
  );

  res.json({ globalRate, overrides: overrides.rows, promotions: promotions.rows, brands: brands.rows });
});

/** PATCH /api/admin/pricing — 更新全局默认费率 */
pricingAdminRouter.patch('/', async (req: Request, res: Response) => {
  const { commissionRate } = req.body;
  if (!isValidRate(commissionRate)) {
    return res.status(400).json({ error: '费率须为 0~1 之间的小数（如 0.20 = 20%）', code: 'INVALID_RATE' });
  }
  await setSetting('commission_rate', String(commissionRate));
  res.json({ commissionRate });
});

/** PATCH /api/admin/pricing/brand/:userId — 设置/清除商家协议费率（rate=null 清除） */
pricingAdminRouter.patch('/brand/:userId', async (req: Request, res: Response) => {
  const { rate, note } = req.body;
  if (rate !== null && !isValidRate(rate)) {
    return res.status(400).json({ error: '费率须为 0~1 之间的小数，或 null 清除协议价', code: 'INVALID_RATE' });
  }
  const exists = await pool.query('SELECT user_id FROM brand_profiles WHERE user_id = $1', [req.params.userId]);
  if (!exists.rows[0]) {
    return res.status(404).json({ error: '商家档案不存在', code: 'BRAND_NOT_FOUND' });
  }
  await pool.query(
    `UPDATE brand_profiles SET commission_rate_override = $1, commission_rate_override_note = $2,
            commission_rate_override_by = $3 WHERE user_id = $4`,
    [rate, note || null, (req as any).user?.userId || 'admin', req.params.userId]
  );
  res.json({ userId: req.params.userId, rate, note: note || null });
});

/** POST /api/admin/pricing/promotions — 新建促销 */
pricingAdminRouter.post('/promotions', async (req: Request, res: Response) => {
  const { scope, brandId, rate, startsAt, endsAt, note } = req.body;
  if (!['global', 'brand'].includes(scope)) {
    return res.status(400).json({ error: 'scope 须为 global 或 brand', code: 'INVALID_SCOPE' });
  }
  if (scope === 'brand' && !brandId) {
    return res.status(400).json({ error: '商家促销必须指定 brandId', code: 'BRAND_REQUIRED' });
  }
  if (!isValidRate(rate)) {
    return res.status(400).json({ error: '促销费率须为 0~1 之间的小数', code: 'INVALID_RATE' });
  }
  const s = new Date(startsAt); const e = new Date(endsAt);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
    return res.status(400).json({ error: '起止时间无效（结束须晚于开始）', code: 'INVALID_PERIOD' });
  }
  const id = genId();
  await pool.query(
    `INSERT INTO pricing_promotions (id, scope, brand_id, rate, starts_at, ends_at, note, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, scope, scope === 'brand' ? brandId : null, rate, s.toISOString(), e.toISOString(),
     note || null, (req as any).user?.userId || 'admin', now()]
  );
  res.status(201).json({ id });
});

/** GET /api/admin/pricing/payout-rules — 打款费率规则 + 汇率中间价 */
pricingAdminRouter.get('/payout-rules', async (_req: Request, res: Response) => {
  const rules = await pool.query(`SELECT * FROM payout_fee_rules ORDER BY from_country, to_country`);
  const fx = await pool.query(`SELECT key, value, updated_at FROM platform_settings WHERE key LIKE 'fx_mid_%'`);
  res.json({ rules: rules.rows, fxRates: fx.rows });
});

/** PUT /api/admin/pricing/payout-rules — 新建/更新一条打款费率规则 */
pricingAdminRouter.put('/payout-rules', async (req: Request, res: Response) => {
  const { fromCountry, toCountry, currency, tiers, fxMarkupBps } = req.body;
  const from = String(fromCountry || '').trim().toUpperCase();
  const to = String(toCountry || '').trim().toUpperCase();
  const cur = String(currency || 'JPY').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(from) || !/^[A-Z]{2}$/.test(to)) {
    return res.status(400).json({ error: '国家须为两位代码（如 JP/CN）', code: 'INVALID_COUNTRY' });
  }
  if (!Array.isArray(tiers) || !tiers.length ||
      !tiers.every((t: any) => (t.upTo === null || Number(t.upTo) > 0) && Number(t.fee) >= 0) ||
      tiers[tiers.length - 1].upTo !== null) {
    return res.status(400).json({ error: '阶梯格式错误：[{upTo,fee}...]，最后一档 upTo 须为 null', code: 'INVALID_TIERS' });
  }
  const bps = Math.max(0, Math.min(2000, parseInt(String(fxMarkupBps ?? 0), 10) || 0));
  await pool.query(
    `INSERT INTO payout_fee_rules (id, from_country, to_country, currency, tiers, fx_markup_bps, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (from_country, to_country, currency)
     DO UPDATE SET tiers = EXCLUDED.tiers, fx_markup_bps = EXCLUDED.fx_markup_bps,
                   updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [genId(), from, to, cur, JSON.stringify(tiers), bps, (req as any).user?.userId || 'admin', now()]
  );
  res.json({ fromCountry: from, toCountry: to, currency: cur, tiers, fxMarkupBps: bps });
});

/** PATCH /api/admin/pricing/payout-fx — 更新汇率中间价（如 pair=JPY_CNY） */
pricingAdminRouter.patch('/payout-fx', async (req: Request, res: Response) => {
  const { pair, rate } = req.body;
  if (!/^[A-Z]{3}_[A-Z]{3}$/.test(String(pair || ''))) {
    return res.status(400).json({ error: 'pair 格式如 JPY_CNY', code: 'INVALID_PAIR' });
  }
  const r = Number(rate);
  if (!(r > 0)) return res.status(400).json({ error: '汇率须为正数', code: 'INVALID_RATE' });
  await setSetting(`fx_mid_${pair}`, String(r), (req as any).user?.userId || 'admin', '打款锁价中间价');
  await pool.query(
    `INSERT INTO fx_rate_history (id, pair, rate, source, synced_at) VALUES ($1, $2, $3, $4, NOW())`,
    [genId(), pair, r, 'manual']
  );
  res.json({ pair, rate: r });
});

/** PATCH /api/admin/pricing/operator-entity — 运营主体名称（服务协议等法律文本引用） */
pricingAdminRouter.patch('/operator-entity', async (req: Request, res: Response) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '运营主体名称不能为空' });
  await setSetting('operator_entity', name, (req as any).user?.userId || 'admin', '平台运营主体（法律文本引用）');
  res.json({ operatorEntity: name });
});

/** GET /api/admin/pricing/fx-history — 最近 30 条汇率变动记录 */
pricingAdminRouter.get('/fx-history', async (_req: Request, res: Response) => {
  const rows = await pool.query(
    `SELECT pair, rate, source, synced_at FROM fx_rate_history ORDER BY synced_at DESC LIMIT 30`
  );
  res.json(rows.rows);
});

/** PATCH /api/admin/pricing/promotions/:id/cancel — 提前终止（软删） */
pricingAdminRouter.patch('/promotions/:id/cancel', async (req: Request, res: Response) => {
  const r = await pool.query(
    'UPDATE pricing_promotions SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL',
    [now(), req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: '促销不存在或已终止', code: 'PROMO_NOT_FOUND' });
  res.json({ id: req.params.id, cancelled: true });
});
