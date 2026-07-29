import { Router, Request, Response } from 'express';
import { findMany, findOne, update, insert } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { sendMail } from '../utils/mailer';
import { payoutProvider } from '../services/payout';
import { topupBrand, debitWithdrawal, creditPlatformFee, PLATFORM_USER_ID } from '../utils/wallet';
import pool from '../db';
import { getSetting, setSetting, getEffectiveCommissionRate } from '../utils/settings';
import { activateOrRenew, ensureInvoice, addMonths } from '../utils/subscriptions';
import { BILLING_CYCLES, CYCLE_MONTHS, type BillingCycle } from '../shared/contracts';
import { imageUpload } from '../middleware/upload';
import { processLogo, processPromo } from '../utils/image';
import { saveBrandAsset } from '../utils/uploads';
import { i18nAdminRouter } from './i18n';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

// 本地化词条矩阵（鉴权继承上面的 ADMIN 检查）
adminRouter.use('/i18n', i18nAdminRouter);

// 定价管理（全局费率/商家协议价/促销），鉴权同上
import { pricingAdminRouter } from './pricing';
adminRouter.use('/pricing', pricingAdminRouter);

/* ── 首任务审核 + 商家 KYB（2026-07-18，PRD §29 合规控制）── */
import { createNotification } from './notifications';

/** GET /api/admin/task-reviews — 待审核任务（未KYB商家发布的） */
adminRouter.get('/task-reviews', async (_req: Request, res: Response) => {
  const rows = await findMany<any>(
    `SELECT t.id, t.title, t.description, t.mode, t.payout_per_herald, t.max_heralds, t.published_at,
            u.nickname as creator_name, u.email as creator_email, bp.company_name, bp.is_agency
     FROM tasks t JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     WHERE t.status = 'PENDING_REVIEW' ORDER BY t.published_at ASC`
  );
  res.json(rows);
});

/** POST /api/admin/task-reviews/:id/approve — 任务审核通过（进公开列表） */
adminRouter.post('/task-reviews/:id/approve', async (req: Request, res: Response) => {
  const task = await findOne<any>("SELECT id, title, creator_id FROM tasks WHERE id = ? AND status = 'PENDING_REVIEW'", [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在或不在审核中' });
  // published_at 语义 = 进入公开时间：审核通过时刷新（发布时写的是提交送审时间，队列排序用）
  await update('tasks', { status: 'OPEN', published_at: new Date().toISOString(), platform_review: 'approved', platform_review_note: null }, 'id = ?', [task.id]);
  await createNotification({
    userId: task.creator_id, type: 'TASK_REVIEW_APPROVED', targetRole: 'BRAND',
    title: '任务审核通过',
    body: `你的任务《${task.title}》已通过平台审核，现已对赫使公开可见。`,
    metadata: { taskId: task.id, taskTitle: task.title },
  });
  res.json({ success: true });
});

/** POST /api/admin/task-reviews/:id/reject — 任务审核拒绝（退回草稿，可改后重新发布） */
adminRouter.post('/task-reviews/:id/reject', async (req: Request, res: Response) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: '请填写拒绝原因（会展示给商家）' });
  const task = await findOne<any>("SELECT id, title, creator_id FROM tasks WHERE id = ? AND status = 'PENDING_REVIEW'", [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在或不在审核中' });
  // 退回草稿零资金副作用：额度占用从状态动态计算，无发布时点的硬锁
  await update('tasks', { platform_review: 'rejected', platform_review_note: reason, status: 'DRAFT' }, 'id = ?', [task.id]);
  await createNotification({
    userId: task.creator_id, type: 'TASK_REVIEW_REJECTED', targetRole: 'BRAND',
    title: '任务审核未通过',
    body: `你的任务《${task.title}》未通过平台审核：${reason}。任务已退回草稿，修改后可重新发布。`,
    metadata: { taskId: task.id, taskTitle: task.title, note: reason },
  });
  res.json({ success: true });
});

/** GET/PATCH /api/admin/kyb/trial-credit — 新商家首单体验额度（发放规则见 utils/settings.ts getBrandCreditInfo） */
adminRouter.get('/kyb/trial-credit', async (_req: Request, res: Response) => {
  const { getSetting } = await import('../utils/settings');
  res.json({ amount: Number(await getSetting('merchant_trial_credit')) || 0 });
});
adminRouter.patch('/kyb/trial-credit', async (req: Request, res: Response) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
    return res.status(400).json({ error: '金额须为 0 ~ 1,000,000 之间的数字' });
  }
  const { setSetting } = await import('../utils/settings');
  await setSetting('merchant_trial_credit', String(Math.round(amount)));
  res.json({ success: true, amount: Math.round(amount) });
});

/** GET /api/admin/kyb-reviews — 待审核的商家认证申请（含历史提交次数，供 admin 判断"这是第几次提交"） */
adminRouter.get('/kyb-reviews', async (_req: Request, res: Response) => {
  const rows = await findMany<any>(
    `SELECT bp.user_id, bp.company_name, bp.industry, bp.website, bp.country, bp.is_agency,
            bp.kyb_doc_url, bp.kyb_submitted_at, u.nickname, u.email,
            (SELECT COUNT(*) FROM kyb_submissions ks WHERE ks.user_id = bp.user_id) AS submission_count,
            (SELECT ks2.corporate_number FROM kyb_submissions ks2 WHERE ks2.user_id = bp.user_id ORDER BY ks2.submitted_at DESC LIMIT 1) AS corporate_number,
            (SELECT ks2.country FROM kyb_submissions ks2 WHERE ks2.user_id = bp.user_id ORDER BY ks2.submitted_at DESC LIMIT 1) AS kyb_country,
            (SELECT ks2.auto_checks FROM kyb_submissions ks2 WHERE ks2.user_id = bp.user_id ORDER BY ks2.submitted_at DESC LIMIT 1) AS auto_checks
     FROM brand_profiles bp JOIN users u ON u.id = bp.user_id
     WHERE bp.kyb_status = 'pending' ORDER BY bp.kyb_submitted_at ASC`
  );
  res.json(rows);
});

/** GET /api/admin/kyb/:userId/history — 该商家全部历史提交记录（审计留痕：拒绝原因/证件/时间均不覆盖） */
adminRouter.get('/kyb/:userId/history', async (req: Request, res: Response) => {
  const rows = await findMany<any>(
    'SELECT id, doc_url, status, note, submitted_at, reviewed_at, reviewed_by FROM kyb_submissions WHERE user_id = ? ORDER BY submitted_at DESC',
    [req.params.userId]
  );
  res.json(rows);
});

/** POST /api/admin/kyb/:userId/approve — 商家认证通过（kyb_status='approved'，任务免审+可申请提额） */
adminRouter.post('/kyb/:userId/approve', async (req: Request, res: Response) => {
  const row = await findOne<any>("SELECT user_id, company_name FROM brand_profiles WHERE user_id = ? AND kyb_status = 'pending'", [req.params.userId]);
  if (!row) return res.status(404).json({ error: '无待审核的认证申请' });
  const reviewedAt = new Date().toISOString();
  await update('brand_profiles', { kyb_status: 'approved', kyb_note: null }, 'user_id = ?', [row.user_id]);
  // 审计表：更新本次提交对应的那一行（而非覆盖 brand_profiles 快照），历史提交永久可查
  await pool.query(
    `UPDATE kyb_submissions SET status = 'approved', reviewed_at = $1, reviewed_by = $2
     WHERE user_id = $3 AND status = 'pending'`,
    [reviewedAt, req.user!.userId, row.user_id]
  );
  await createNotification({
    userId: row.user_id, type: 'KYB_APPROVED', targetRole: 'BRAND',
    title: '企业认证通过',
    body: '你的企业认证已通过。此后发布的任务免平台审核直接上线，并可联系运营申请提升信用额度。',
  });
  res.json({ success: true });
});

/** POST /api/admin/kyb/:userId/reject — 商家认证拒绝 */
adminRouter.post('/kyb/:userId/reject', async (req: Request, res: Response) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: '请填写拒绝原因（会展示给商家）' });
  const row = await findOne<any>("SELECT user_id FROM brand_profiles WHERE user_id = ? AND kyb_status = 'pending'", [req.params.userId]);
  if (!row) return res.status(404).json({ error: '无待审核的认证申请' });
  const reviewedAt = new Date().toISOString();
  await update('brand_profiles', { kyb_status: 'rejected', kyb_note: reason }, 'user_id = ?', [row.user_id]);
  await pool.query(
    `UPDATE kyb_submissions SET status = 'rejected', note = $1, reviewed_at = $2, reviewed_by = $3
     WHERE user_id = $4 AND status = 'pending'`,
    [reason, reviewedAt, req.user!.userId, row.user_id]
  );
  await createNotification({
    userId: row.user_id, type: 'KYB_REJECTED', targetRole: 'BRAND',
    title: '企业认证未通过',
    body: `你的企业认证未通过：${reason}。可在账户设置中重新提交。`,
    metadata: { note: reason },
  });
  res.json({ success: true });
});

/* ── Stats & Dashboard ── */

adminRouter.get('/stats', async (_req: Request, res: Response) => {
  const heralds     = await findOne<any>('SELECT COUNT(*) as n FROM users WHERE role = ?', ['HERALD']);
  const brands      = await findOne<any>('SELECT COUNT(*) as n FROM users WHERE role = ?', ['BRAND']);
  const openTasks   = await findOne<any>("SELECT COUNT(*) as n FROM tasks WHERE status = 'OPEN'");
  const pendingDecl = await findOne<any>("SELECT COUNT(*) as n FROM declarations WHERE status = 'pending'");
  const pendingSubs = await findOne<any>("SELECT COUNT(*) as n FROM task_submissions WHERE status = 'PENDING_REVIEW'");
  const pendingApps = await findOne<any>("SELECT COUNT(*) as n FROM task_applications WHERE status = 'PENDING'");
  const thisMonth   = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0);
  const monthStr    = thisMonth.toISOString();
  const monthCompletions = await findOne<any>("SELECT COUNT(*) as n FROM task_submissions WHERE status = 'APPROVED' AND reviewed_at >= ?", [monthStr]);
  const pendingPayout    = await findOne<any>("SELECT COALESCE(SUM(amount),0) as n FROM wallet_entries WHERE type='WITHDRAWAL_FREEZE'");
  const monthPayout      = await findOne<any>("SELECT COALESCE(SUM(amount),0) as n FROM wallet_entries WHERE type='WITHDRAWAL_DEBIT' AND created_at >= ?", [monthStr]);

  // 近7日每日完成数
  const daily: any[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const cnt = await findOne<any>(
      "SELECT COUNT(*) as n FROM task_submissions WHERE status='APPROVED' AND reviewed_at >= ? AND reviewed_at < ?",
      [d.toISOString(), next.toISOString()]
    );
    daily.push({ date: d.toISOString().slice(0,10), count: cnt?.n || 0 });
  }

  res.json({
    heralds: heralds?.n || 0,
    brands: brands?.n || 0,
    openTasks: openTasks?.n || 0,
    pendingDeclarations: pendingDecl?.n || 0,
    pendingSubmissions: pendingSubs?.n || 0,
    pendingApplications: pendingApps?.n || 0,
    monthCompletions: monthCompletions?.n || 0,
    pendingPayout: pendingPayout?.n || 0,
    monthPayout: monthPayout?.n || 0,
    daily,
  });
});

/* ── Users ── */

adminRouter.get('/users', async (req: Request, res: Response) => {
  const { role, page = '1', q } = req.query;
  const limit = 50, skip = (Number(page) - 1) * limit;
  let where = '1=1'; const params: any[] = [];
  if (role) { where += ' AND u.role = ?'; params.push(role); }
  if (q) { where += ' AND (u.nickname LIKE ? OR u.email LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }

  const rows = await findMany<any>(`
    SELECT u.id, u.nickname, u.email, u.role, u.is_verified, u.created_at,
           hp.residence, hp.kyc_status, hp.is_onboarded as herald_onboarded,
           bp.company_name, bp.is_onboarded as brand_onboarded,
           bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url, bp.billing_email as brand_billing_email
    FROM users u
    LEFT JOIN herald_profiles hp ON hp.user_id = u.id
    LEFT JOIN brand_profiles bp ON bp.user_id = u.id
    WHERE ${where} AND u.role != 'ADMIN'
    ORDER BY u.created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, skip]);
  const total = await findOne<any>(`SELECT COUNT(*) as n FROM users u WHERE ${where} AND u.role != 'ADMIN'`, params);
  res.json({ users: rows, total: total?.n || 0 });
});

adminRouter.post('/users/:id/suspend', async (req: Request, res: Response) => {
  const { suspend } = req.body;
  await update('users', { is_verified: suspend ? -1 : 0 }, 'id = ?', [req.params.id]);
  res.json({ success: true });
});


/** GET /api/admin/brands/:userId — 获取品牌资料（用于运营编辑） */
adminRouter.get('/brands/:userId', async (req: Request, res: Response) => {
  const profile = await findOne<any>(
    `SELECT bp.*, u.nickname, u.email FROM brand_profiles bp
     JOIN users u ON u.id = bp.user_id WHERE bp.user_id = ?`, [req.params.userId]
  );
  if (!profile) return res.status(404).json({ error: '品牌资料不存在' });
  res.json(profile);
});

/** PATCH /api/admin/brands/:userId — 运营编辑品牌资料（销售代办档签约信息：账单邮箱等） */
adminRouter.patch('/brands/:userId', async (req: Request, res: Response) => {
  const { companyName, industry, companyDesc, website, contactName, contactPhone, billingEmail } = req.body;
  const existing = await findOne<{ id: string }>('SELECT id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!existing) return res.status(404).json({ error: '品牌资料不存在' });

  const data: Record<string, any> = {};
  if (companyName !== undefined) data.company_name = companyName;
  if (industry !== undefined) data.industry = industry || null;
  if (companyDesc !== undefined) data.company_desc = companyDesc || null;
  if (website !== undefined) data.website = website || null;
  if (contactName !== undefined) data.contact_name = contactName;
  if (contactPhone !== undefined) data.contact_phone = contactPhone || null;
  if (billingEmail !== undefined) data.billing_email = billingEmail || null;

  await update('brand_profiles', data, 'user_id = ?', [req.params.userId]);
  res.json({ success: true });
});

/** POST /api/admin/brands/:userId/logo — 运营为品牌上传LOGO（销售代办档签约时收集） */
adminRouter.post('/brands/:userId/logo', imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  const existing = await findOne<{ id: string }>('SELECT id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!existing) return res.status(404).json({ error: '品牌资料不存在' });
  try {
    const processed = await processLogo(req.file.buffer);
    const url = saveBrandAsset(String(req.params.userId), 'logo', processed);
    await update('brand_profiles', { logo_url: url }, 'user_id = ?', [req.params.userId]);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/** POST /api/admin/brands/:userId/promo — 运营为品牌上传宣传图（销售代办档签约时收集） */
adminRouter.post('/brands/:userId/promo', imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  const existing = await findOne<{ id: string }>('SELECT id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!existing) return res.status(404).json({ error: '品牌资料不存在' });
  try {
    const processed = await processPromo(req.file.buffer);
    const url = saveBrandAsset(String(req.params.userId), 'promo', processed);
    await update('brand_profiles', { promo_image_url: url }, 'user_id = ?', [req.params.userId]);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Promo upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/* ── Tasks ── */

adminRouter.get('/tasks', async (req: Request, res: Response) => {
  const { status, page = '1' } = req.query;
  const limit = 50, skip = (Number(page) - 1) * limit;
  let where = '1=1'; const params: any[] = [];
  if (status) { where += ' AND t.status = ?'; params.push(status); }

  const rows = await findMany<any>(`
    SELECT t.*, u.nickname as creator_name,
           (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id = t.id) as application_count,
           (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id = t.id AND ta.status = 'APPROVED') as approved_count,
           (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id = t.id AND ts.status = 'APPROVED') as completed_count
    FROM tasks t JOIN users u ON u.id = t.creator_id
    WHERE ${where}
    ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, skip]);
  const total = await findOne<any>(`SELECT COUNT(*) as n FROM tasks t WHERE ${where}`, params);
  res.json({ tasks: rows, total: total?.n || 0 });
});

adminRouter.patch('/tasks/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  const allowed = ['OPEN','COMPLETED','CANCELLED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: '无效状态' });
  await update('tasks', { status, updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  res.json({ success: true });
});

/* ── Declarations ── */

adminRouter.get('/declarations', async (_req: Request, res: Response) => {
  res.json(await findMany<any>(`
    SELECT d.*, u.nickname, u.email
    FROM declarations d JOIN users u ON u.id = d.user_id
    WHERE d.status = 'pending' ORDER BY d.submitted_at ASC
  `));
});

adminRouter.post('/declarations/:id/approve', async (req: Request, res: Response) => {
  const d = await findOne<any>('SELECT * FROM declarations WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: '不存在' });
  await update('declarations', { status: 'approved', reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  await update('herald_profiles', { declaration_status: 'approved', kyc_status: 'approved' }, 'user_id = ?', [d.user_id]);
  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [d.user_id]);
  if (u?.email) await sendMail(u.email, '【Herix】在留资格声明已通过审核', `${u.nickname}，您的在留资格声明已通过审核，现在可以接取任务了。`);
  res.json({ success: true });
});

adminRouter.post('/declarations/:id/reject', async (req: Request, res: Response) => {
  const { reason } = req.body;
  const d = await findOne<any>('SELECT * FROM declarations WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: '不存在' });
  await update('declarations', { status: 'rejected', reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  await update('herald_profiles', { declaration_status: 'rejected' }, 'user_id = ?', [d.user_id]);
  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [d.user_id]);
  if (u?.email) await sendMail(u.email, '【Herix】在留资格声明审核结果', `${u.nickname}，您的声明暂未通过审核。${reason ? '原因：' + reason : ''}`);
  res.json({ success: true });
});

/* ── Submissions ── */

adminRouter.get('/applications', async (_req: Request, res: Response) => {
  const apps = await findMany<any>(
    `SELECT ta.id, ta.task_id, ta.herald_id, ta.status, ta.created_at,
            u.nickname as herald_name, u.email,
            t.title as task_title, t.commission
     FROM task_applications ta
     JOIN users u ON u.id = ta.herald_id
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.status = 'PENDING'
     ORDER BY ta.created_at DESC`
  );
  res.json(apps);
});

adminRouter.post('/applications/:id/approve', async (req: Request, res: Response) => {
  const app = await findOne<any>('SELECT * FROM task_applications WHERE id = ?', [req.params.id]);
  if (!app || app.status !== 'PENDING') return res.status(404).json({ error: '报名不存在或已处理' });
  await update('task_applications', { status: 'APPROVED', updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  res.json({ message: '已通过' });
});

adminRouter.post('/applications/:id/reject', async (req: Request, res: Response) => {
  const app = await findOne<any>('SELECT * FROM task_applications WHERE id = ?', [req.params.id]);
  if (!app || app.status !== 'PENDING') return res.status(404).json({ error: '报名不存在或已处理' });
  await update('task_applications', { status: 'REJECTED', updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  res.json({ message: '已拒绝' });
});

adminRouter.get('/submissions', async (_req: Request, res: Response) => {
  res.json(await findMany<any>(`
    SELECT ts.*, u.nickname as herald_name, t.title as task_title, t.mode, t.category,
           bu.nickname as brand_name
    FROM task_submissions ts
    JOIN users u ON u.id = ts.herald_id
    JOIN tasks t ON t.id = ts.task_id
    JOIN users bu ON bu.id = t.creator_id
    WHERE ts.status = 'PENDING_REVIEW'
    ORDER BY ts.submitted_at ASC
  `));
});

adminRouter.post('/submissions/:id/approve', async (req: Request, res: Response) => {
  const s = await findOne<any>('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: '不存在' });
  await update('task_submissions', { status: 'APPROVED', reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [s.herald_id]);
  const t = await findOne<any>('SELECT title FROM tasks WHERE id = ?', [s.task_id]);
  if (u?.email) await sendMail(u.email, '【Herix】内容审核通过', `${u.nickname}，您提交的任务「${t?.title}」内容已审核通过，报酬将在月末结算。`);
  res.json({ success: true });
});

adminRouter.post('/submissions/:id/reject', async (req: Request, res: Response) => {
  const { reason } = req.body;
  const s = await findOne<any>('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: '不存在' });
  await update('task_submissions', { status: 'REJECTED', review_note: reason || null, reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [s.herald_id]);
  const t = await findOne<any>('SELECT title FROM tasks WHERE id = ?', [s.task_id]);
  if (u?.email) await sendMail(u.email, '【Herix】内容审核未通过', `${u.nickname}，您提交的任务「${t?.title}」内容暂未通过审核。${reason ? '原因：' + reason : '请修改后重新提交。'}`);
  res.json({ success: true });
});

/* ── Payouts ── */

// 赫使余额：统一从 transactions 表计算（STANDARD + PERFORMANCE 均走此逻辑）
adminRouter.get('/payouts', async (_req: Request, res: Response) => {
  // 每位赫使：已发放 - 已提现 = 净余额
  const earned = await findMany<any>(`
    SELECT u.id, u.nickname, u.email,
           hp.bank_account, hp.residence,
           COALESCE(SUM(CASE WHEN txn.type='ESCROW_RELEASE' THEN txn.amount ELSE 0 END), 0) as total_earned,
           COALESCE(SUM(CASE WHEN txn.type='WITHDRAWAL' AND txn.status='COMPLETED' THEN ABS(txn.amount) ELSE 0 END), 0) as total_withdrawn,
           COALESCE(SUM(CASE WHEN txn.type='ESCROW_RELEASE' THEN txn.amount ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN txn.type='WITHDRAWAL' THEN ABS(txn.amount) ELSE 0 END), 0) as net_balance,
           COUNT(DISTINCT CASE WHEN txn.type='ESCROW_RELEASE' THEN txn.task_id END) as tasks_paid
    FROM users u
    JOIN herald_profiles hp ON hp.user_id = u.id
    LEFT JOIN transactions txn ON txn.user_id = u.id
    WHERE 'HERALD' = ANY(string_to_array(COALESCE(u.roles,'["HERALD"]')::text, '"')::text[])
       OR u.role = 'HERALD'
    GROUP BY u.id, u.nickname, u.email, hp.bank_account, hp.residence
    HAVING COALESCE(SUM(CASE WHEN txn.type='ESCROW_RELEASE' THEN txn.amount ELSE 0 END), 0) > 0
    ORDER BY net_balance DESC
  `);

  // 历史提现记录（withdrawal_requests 表）
  const withdrawals = await findMany<any>(`
    SELECT wr.*, u.nickname, u.email
    FROM withdrawal_requests wr JOIN users u ON u.id = wr.herald_id
    ORDER BY wr.created_at DESC LIMIT 50
  `);

  res.json({ earned, withdrawals });
});

// payouts 表已废弃，提现打款统一走 /admin/withdrawal-requests/:id/process

/* ── Ambassadors ── */

adminRouter.get('/ambassadors', async (_req: Request, res: Response) => {
  res.json(await findMany<any>(`
    SELECT u.id, u.nickname, u.email, u.created_at,
           hp.residence, hp.kyc_status, hp.declaration_status, hp.is_onboarded, hp.visa_type, hp.bank_account,
           (SELECT COUNT(*) FROM task_applications ta WHERE ta.herald_id = u.id AND ta.status = 'APPROVED') as active_tasks,
           (SELECT COUNT(*) FROM task_submissions ts WHERE ts.herald_id = u.id AND ts.status = 'APPROVED') as completed
    FROM users u
    JOIN herald_profiles hp ON hp.user_id = u.id
    WHERE u.role = 'HERALD'
    ORDER BY u.created_at DESC
  `));
});

/* ── Topup Requests ── */

adminRouter.get('/topup-requests', async (_req: Request, res: Response) => {
  const rows = await findMany<any>(`
    SELECT tr.*, u.nickname, u.email
    FROM topup_requests tr
    JOIN users u ON u.id = tr.brand_id
    ORDER BY tr.created_at DESC
  `);
  res.json(rows);
});

adminRouter.post('/topup-requests/:id/confirm', async (req: Request, res: Response) => {
  const row = await findOne<any>('SELECT * FROM topup_requests WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '申请不存在' });
  if (row.status !== 'pending') return res.status(400).json({ error: '已处理' });

  await update('topup_requests', {
    status: 'confirmed',
    confirmed_by: req.user!.userId,
    confirmed_at: new Date().toISOString(),
  }, 'id = ?', [req.params.id]);

  await topupBrand({
    userId: row.brand_id,
    amount: row.amount,
    idempotencyKey: `TOPUP:${row.id}`,
    referenceType: 'topup_request',
    referenceId: row.id,
    note: `充值确认 ¥${row.amount}`,
    createdBy: req.user!.userId,
  });

  // 标记商户已充值；如充值后余额达到极速打款门槛，为进行中任务补打标签
  await pool.query(
    `UPDATE brand_profiles SET has_topped_up = TRUE WHERE user_id = $1`,
    [row.brand_id],
  );
  const balRow = await pool.query(
    `SELECT available_balance FROM wallets WHERE user_id = $1 AND wallet_type = 'brand' AND currency = 'JPY'`,
    [row.brand_id],
  );
  const newBal    = Number(balRow.rows[0]?.available_balance) || 0;
  const fpSetting = await (await import('../utils/settings')).getSetting('fast_payout_threshold');
  const fpThresh  = Number(fpSetting) || 100000;
  if (newBal >= fpThresh) {
    await pool.query(
      `UPDATE tasks SET fast_payout = TRUE WHERE creator_id = $1 AND status IN ('PENDING_REVIEW','OPEN','IN_PROGRESS')`,
      [row.brand_id],
    );
  }

  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [row.brand_id]);
  if (u?.email) await sendMail(u.email, '【HERIX】充值到账', `${u.nickname}，您的充值 ${row.currency} ${row.amount} 已确认到账，可用于发布任务。您的任务现已获得「极速打款」标签，赫使可优先选择您的任务。`);

  res.json({ success: true });
});

adminRouter.post('/topup-requests/:id/reject', async (req: Request, res: Response) => {
  const row = await findOne<any>('SELECT * FROM topup_requests WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '申请不存在' });
  if (row.status !== 'pending') return res.status(400).json({ error: '已处理' });

  await update('topup_requests', {
    status: 'rejected',
    confirmed_by: req.user!.userId,
    confirmed_at: new Date().toISOString(),
    note: req.body.reason || null,
  }, 'id = ?', [req.params.id]);

  res.json({ success: true });
});

/* ── Withdrawal Requests ── */

adminRouter.get('/withdrawal-requests', async (_req: Request, res: Response) => {
  const rows = await findMany<any>(`
    SELECT wr.*, u.nickname, u.email,
           hp.residence, hp.bank_account
    FROM withdrawal_requests wr
    JOIN users u ON u.id = wr.herald_id
    LEFT JOIN herald_profiles hp ON hp.user_id = wr.herald_id
    ORDER BY wr.created_at DESC
  `);
  res.json(rows);
});

adminRouter.post('/withdrawal-requests/:id/process', async (req: Request, res: Response) => {
  const wr = await findOne<any>('SELECT * FROM withdrawal_requests WHERE id = ?', [req.params.id]);
  if (!wr) return res.status(404).json({ error: '申请不存在' });
  if (wr.status !== 'pending') return res.status(400).json({ error: '已处理' });

  await update('withdrawal_requests', { status: 'processing' }, 'id = ?', [req.params.id]);

  let payoutRef = 'MANUAL';
  try {
    const result = await payoutProvider.send({
      withdrawalId: wr.id,
      heraldId: wr.herald_id,
      amount: wr.amount,
      currency: wr.currency,
      method: wr.method,
      accountDetails: JSON.parse(wr.account_details || '{}'),
    });
    if (!result.success) throw new Error(result.error || 'payout failed');
    payoutRef = result.referenceId || 'MANUAL';
  } catch (err: any) {
    // 自动打款失败时仍可手动处理，记录错误但不阻断流程
    if (payoutProvider.name !== 'manual') {
      await update('withdrawal_requests', {
        status: 'failed',
        note: err.message,
      }, 'id = ?', [req.params.id]);
      return res.status(502).json({ error: '自动打款失败: ' + err.message });
    }
  }

  await update('withdrawal_requests', {
    status: 'paid',
    payout_reference: payoutRef,
    processed_by: req.user!.userId,
    processed_at: new Date().toISOString(),
  }, 'id = ?', [req.params.id]);

  const fee       = Number(wr.fee) || 0;
  const netAmount = Number(wr.net_amount) ?? (wr.amount - fee);

  await debitWithdrawal({
    userId:         wr.herald_id,
    amount:         wr.amount,
    idempotencyKey: `WITHDRAWAL_DEBIT:${wr.id}`,
    referenceType:  'withdrawal_request',
    referenceId:    wr.id,
    note:           `提现打款 ¥${netAmount} 参考号 ${payoutRef}（手续费 ¥${fee}）`,
    createdBy:      req.user!.userId,
  });

  if (fee > 0) {
    await creditPlatformFee({
      userId:         PLATFORM_USER_ID,
      amount:         fee,
      idempotencyKey: `WITHDRAWAL_FEE:${wr.id}`,
      referenceType:  'withdrawal_request',
      referenceId:    wr.id,
      note:           `提现手续费`,
      createdBy:      req.user!.userId,
    });
  }

  const u = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [wr.herald_id]);
  if (u?.email) await sendMail(
    u.email,
    '【HERIX】提现已打款',
    `${u.nickname}，您申请的 ${wr.currency} ${wr.amount} 提现已完成打款（手续费 ¥${fee}，实际到账 ¥${netAmount}），参考号：${payoutRef}，请查收。`
  );

  res.json({ success: true, payoutReference: payoutRef, netAmount, fee, provider: payoutProvider.name });
});

// ── 定价管理 ──────────────────────────────────────────────────────────────────

// ⚠️ 曾命名 PRICING_KEYS 挂在 GET/PATCH /pricing——被顶部 use('/pricing', pricingAdminRouter)
// 遮蔽成不可达死代码（2026-07-26 发现：加进来的键从未能通过 API 调整）。
// 现挂 /platform-params；commission_rate 归 pricing.ts 专管（避免双写口径），此处移除
const PLATFORM_PARAM_KEYS = [
  'withdrawal_fee_type',
  'withdrawal_fee_flat',
  'withdrawal_schedule_mode',
  'withdrawal_monthly_limit',
  'withdrawal_min_amount',
  'topup_cc_rate',
  'review_timeout_days',
  'resubmit_timeout_days',
  'max_open_tasks_base',
  'max_open_tasks_kyb',
  'max_open_tasks_funded',
  'funded_topup_threshold',
  'sub_discount_quarterly',
  'sub_discount_annual',
] as const;

/** GET /api/admin/pricing — 读取全局定价配置 */
adminRouter.get('/platform-params', async (_req: Request, res: Response) => {
  const entries = await Promise.all(PLATFORM_PARAM_KEYS.map(k => getSetting(k).then(v => [k, v])));
  const cfg = Object.fromEntries(entries);
  res.json({
    withdrawalFeeType:       cfg.withdrawal_fee_type,
    withdrawalFeeFlat:       Number(cfg.withdrawal_fee_flat),
    withdrawalScheduleMode:  cfg.withdrawal_schedule_mode,
    withdrawalMonthlyLimit:  Number(cfg.withdrawal_monthly_limit),
    withdrawalMinAmount:     Number(cfg.withdrawal_min_amount),
    topupCcRate:             Number(cfg.topup_cc_rate),
    reviewTimeoutDays:       Number(cfg.review_timeout_days),
    resubmitTimeoutDays:     Number(cfg.resubmit_timeout_days),
    maxOpenTasksBase:        Number(cfg.max_open_tasks_base),
    maxOpenTasksKyb:         Number(cfg.max_open_tasks_kyb),
    maxOpenTasksFunded:      Number(cfg.max_open_tasks_funded),
    fundedTopupThreshold:    Number(cfg.funded_topup_threshold),
    subDiscountQuarterly:    Number(cfg.sub_discount_quarterly),
    subDiscountAnnual:       Number(cfg.sub_discount_annual),
  });
});

/** PATCH /api/admin/pricing — 更新全局定价配置 */
adminRouter.patch('/platform-params', async (req: Request, res: Response) => {
  const adminId = req.user!.userId;
  const { note, withdrawalFeeFlat, withdrawalScheduleMode,
          withdrawalMonthlyLimit, withdrawalMinAmount, topupCcRate,
          reviewTimeoutDays, resubmitTimeoutDays,
          maxOpenTasksBase, maxOpenTasksKyb, maxOpenTasksFunded, fundedTopupThreshold,
          subDiscountQuarterly, subDiscountAnnual } = req.body;

  const updates: [string, string][] = [];
  if (withdrawalFeeFlat     !== undefined) updates.push(['withdrawal_fee_flat',      String(withdrawalFeeFlat)]);
  if (withdrawalScheduleMode !== undefined) updates.push(['withdrawal_schedule_mode', String(withdrawalScheduleMode)]);
  if (withdrawalMonthlyLimit !== undefined) updates.push(['withdrawal_monthly_limit', String(withdrawalMonthlyLimit)]);
  if (withdrawalMinAmount   !== undefined) updates.push(['withdrawal_min_amount',    String(withdrawalMinAmount)]);
  if (topupCcRate           !== undefined) updates.push(['topup_cc_rate',            String(topupCcRate)]);
  if (reviewTimeoutDays     !== undefined) updates.push(['review_timeout_days',      String(reviewTimeoutDays)]);
  if (resubmitTimeoutDays   !== undefined) updates.push(['resubmit_timeout_days',    String(resubmitTimeoutDays)]);
  if (maxOpenTasksBase      !== undefined) updates.push(['max_open_tasks_base',      String(maxOpenTasksBase)]);
  if (maxOpenTasksKyb       !== undefined) updates.push(['max_open_tasks_kyb',       String(maxOpenTasksKyb)]);
  if (maxOpenTasksFunded    !== undefined) updates.push(['max_open_tasks_funded',    String(maxOpenTasksFunded)]);
  if (fundedTopupThreshold  !== undefined) updates.push(['funded_topup_threshold',   String(fundedTopupThreshold)]);
  if (subDiscountQuarterly  !== undefined) updates.push(['sub_discount_quarterly',    String(subDiscountQuarterly)]);
  if (subDiscountAnnual     !== undefined) updates.push(['sub_discount_annual',       String(subDiscountAnnual)]);

  if (!updates.length) return res.status(400).json({ error: '未提供任何更新字段' });

  await Promise.all(updates.map(([k, v]) => setSetting(k, v, adminId, note)));
  res.json({ updated: updates.map(([k]) => k), note });
});

/** PATCH /api/admin/brands/:userId/credit-limit — 账户信用额度上限 */
adminRouter.patch('/brands/:userId/credit-limit', async (req: Request, res: Response) => {
  const { creditLimit } = req.body;

  const profile = await findOne('SELECT user_id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!profile) return res.status(404).json({ error: '品牌账户不存在' });

  if (creditLimit === null || creditLimit === undefined) {
    await pool.query('UPDATE brand_profiles SET credit_limit_override = NULL WHERE user_id = $1', [req.params.userId]);
    res.json({ creditLimitOverride: null, note: '已恢复全局默认信用额度' });
  } else {
    const limit = Number(creditLimit);
    if (isNaN(limit) || limit < 0) {
      return res.status(400).json({ error: '信用额度须为非负数' });
    }
    await pool.query('UPDATE brand_profiles SET credit_limit_override = $1 WHERE user_id = $2', [limit, req.params.userId]);
    res.json({ userId: req.params.userId, creditLimitOverride: limit });
  }
});

/** PATCH /api/admin/brands/:userId/publish-limit — 单户发布并发数特批（null=恢复阶梯默认） */
adminRouter.patch('/brands/:userId/publish-limit', async (req: Request, res: Response) => {
  const { maxOpenTasks } = req.body;
  const profile = await findOne('SELECT user_id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!profile) return res.status(404).json({ error: '品牌账户不存在' });

  if (maxOpenTasks === null || maxOpenTasks === undefined) {
    await pool.query('UPDATE brand_profiles SET max_open_tasks_override = NULL WHERE user_id = $1', [req.params.userId]);
    return res.json({ maxOpenTasksOverride: null, note: '已恢复阶梯默认' });
  }
  const limit = Number(maxOpenTasks);
  if (!Number.isInteger(limit) || limit < 0) return res.status(400).json({ error: '并发数须为非负整数' });
  await pool.query('UPDATE brand_profiles SET max_open_tasks_override = $1 WHERE user_id = $2', [limit, req.params.userId]);
  res.json({ userId: req.params.userId, maxOpenTasksOverride: limit });
});

// ── 订阅管理（P1 正式化：merchant_subscriptions 为唯一来源，P0 的 brand_profiles 快照列已删）──

/** GET /api/admin/subscriptions — 订阅队列（?status= 可筛；PENDING_PAYMENT 即销售跟进名单） */
adminRouter.get('/subscriptions', async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await findMany<any>(
    `SELECT ms.*, u.nickname, u.email, bp.company_name, bp.contact_phone,
            (SELECT COALESCE(w.available_balance, 0) FROM wallets w
             WHERE w.user_id = ms.brand_user_id AND w.wallet_type = 'brand') AS wallet_available,
            (SELECT si.invoice_no FROM subscription_invoices si
             WHERE si.subscription_id = ms.id AND si.status = 'PENDING'
             ORDER BY si.created_at DESC LIMIT 1) AS pending_invoice_no,
            (SELECT si.amount FROM subscription_invoices si
             WHERE si.subscription_id = ms.id AND si.status = 'PENDING'
             ORDER BY si.created_at DESC LIMIT 1) AS pending_amount
     FROM merchant_subscriptions ms
     JOIN users u ON u.id = ms.brand_user_id
     LEFT JOIN brand_profiles bp ON bp.user_id = ms.brand_user_id
     ${status ? 'WHERE ms.status = ?' : ''}
     ORDER BY (ms.status = 'PENDING_PAYMENT') DESC, (ms.status = 'PAST_DUE') DESC, ms.created_at DESC`,
    status ? [status] : []);
  res.json(rows);
});

/** POST /api/admin/subscriptions — admin 代开订阅（定制版合同签订后录入实价） */
adminRouter.post('/subscriptions', async (req: Request, res: Response) => {
  const { brandUserId, planCode, billingCycle, price } = req.body || {};
  const user = await findOne('SELECT id FROM users WHERE id = ?', [brandUserId]);
  if (!user) return res.status(404).json({ error: '商家不存在' });
  if (!BILLING_CYCLES.includes(billingCycle)) {
    return res.status(400).json({ error: 'billingCycle 无效' });
  }
  const plan = await findOne<any>('SELECT * FROM subscription_plans WHERE code = ?', [planCode]);
  if (!plan) return res.status(404).json({ error: '档位不存在' });
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '请录入本期实价（正数）' });
  const existing = await findOne<any>(
    `SELECT id, status FROM merchant_subscriptions WHERE brand_user_id = ?
     AND status IN ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE')`, [brandUserId]);
  if (existing && existing.status !== 'PENDING_PAYMENT') {
    return res.status(409).json({ error: '该商家已有进行中的订阅' });
  }
  if (existing) { // 未付款旧单自动作废换新（与商户端下单同规则）
    await pool.query(`UPDATE merchant_subscriptions SET status = 'CANCELED', updated_at = $1 WHERE id = $2 AND status = 'PENDING_PAYMENT'`,
      [new Date().toISOString(), existing.id]);
    await pool.query(`UPDATE subscription_invoices SET status = 'VOID' WHERE subscription_id = $1 AND status = 'PENDING'`, [existing.id]);
  }
  const now = new Date().toISOString();
  const subId = await insert('merchant_subscriptions', {
    brand_user_id: brandUserId, plan_code: planCode, billing_cycle: billingCycle,
    price_snapshot: amount, status: 'PENDING_PAYMENT', auto_renew: 1,
    advisor_note: req.body.advisorNote || null, created_at: now,
  });
  const months = CYCLE_MONTHS[billingCycle as BillingCycle];
  await ensureInvoice(subId, now, addMonths(now, months), amount);
  res.status(201).json(await findOne('SELECT * FROM merchant_subscriptions WHERE id = ?', [subId]));
});

/** POST /api/admin/subscriptions/:id/activate — 手动触发扣款激活（余额不足会明确报错） */
adminRouter.post('/subscriptions/:id/activate', async (req: Request, res: Response) => {
  const sub = await findOne<any>('SELECT * FROM merchant_subscriptions WHERE id = ?', [req.params.id]);
  if (!sub) return res.status(404).json({ error: '订阅不存在' });
  if (!['PENDING_PAYMENT', 'PAST_DUE', 'ACTIVE'].includes(sub.status)) {
    return res.status(400).json({ error: `当前状态 ${sub.status} 不可激活` });
  }
  const r = await activateOrRenew(sub, { actor: req.user!.userId });
  if (!r.ok) {
    return res.status(402).json({
      error: `商家余额不足：需 ¥${r.needed.toLocaleString()}，当前 ¥${r.available.toLocaleString()}，请先跟进充值`,
      code: r.code, needed: r.needed, available: r.available,
    });
  }
  res.json(await findOne('SELECT * FROM merchant_subscriptions WHERE id = ?', [req.params.id]));
});

/** POST /api/admin/subscriptions/:id/cancel — admin 取消（待付→CANCELED；生效中→关自动续费） */
adminRouter.post('/subscriptions/:id/cancel', async (req: Request, res: Response) => {
  const sub = await findOne<any>('SELECT * FROM merchant_subscriptions WHERE id = ?', [req.params.id]);
  if (!sub) return res.status(404).json({ error: '订阅不存在' });
  const now = new Date().toISOString();
  if (sub.status === 'PENDING_PAYMENT') {
    await pool.query(`UPDATE merchant_subscriptions SET status = 'CANCELED', updated_at = $1 WHERE id = $2`, [now, sub.id]);
    await pool.query(`UPDATE subscription_invoices SET status = 'VOID' WHERE subscription_id = $1 AND status = 'PENDING'`, [sub.id]);
    return res.json({ ok: true, status: 'CANCELED' });
  }
  await pool.query(`UPDATE merchant_subscriptions SET auto_renew = 0, updated_at = $1 WHERE id = $2`, [now, sub.id]);
  res.json({ ok: true, autoRenew: false });
});

/** PATCH /api/admin/subscriptions/:id — 改价（下期生效）/顾问备注 */
adminRouter.patch('/subscriptions/:id', async (req: Request, res: Response) => {
  const { price, advisorNote } = req.body || {};
  const sub = await findOne<any>('SELECT * FROM merchant_subscriptions WHERE id = ?', [req.params.id]);
  if (!sub) return res.status(404).json({ error: '订阅不存在' });
  const sets: string[] = []; const vals: any[] = [];
  if (price !== undefined) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: '价格须为正数' });
    sets.push(`price_snapshot = $${vals.push(p)}`);
  }
  if (advisorNote !== undefined) sets.push(`advisor_note = $${vals.push(advisorNote || null)}`);
  if (!sets.length) return res.status(400).json({ error: '未提供更新字段' });
  sets.push(`updated_at = $${vals.push(new Date().toISOString())}`);
  vals.push(req.params.id);
  await pool.query(`UPDATE merchant_subscriptions SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  res.json(await findOne('SELECT * FROM merchant_subscriptions WHERE id = ?', [req.params.id]));
});

/** GET /api/admin/subscription-inquiries — 定制版洽谈线索队列（销售跟进名单） */
adminRouter.get('/subscription-inquiries', async (_req: Request, res: Response) => {
  const rows = await findMany<any>(
    `SELECT si.*, u.nickname, u.email, bp.company_name, bp.contact_name, bp.contact_phone
     FROM subscription_inquiries si
     JOIN users u ON u.id = si.brand_user_id
     LEFT JOIN brand_profiles bp ON bp.user_id = si.brand_user_id
     ORDER BY (si.status = 'NEW') DESC, si.created_at DESC`);
  res.json(rows);
});

/** PATCH /api/admin/subscription-inquiries/:id — 跟进状态流转（NEW→CONTACTED→CLOSED） */
adminRouter.patch('/subscription-inquiries/:id', async (req: Request, res: Response) => {
  const { status } = req.body || {};
  if (!['CONTACTED', 'CLOSED'].includes(String(status))) {
    return res.status(400).json({ error: 'status 须为 CONTACTED / CLOSED' });
  }
  const r = await pool.query(
    `UPDATE subscription_inquiries SET status = $1, handled_by = $2, handled_at = $3 WHERE id = $4`,
    [status, req.user!.userId, new Date().toISOString(), req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: '线索不存在' });
  res.json({ ok: true, status });
});

/** GET/PATCH /api/admin/subscription-plans — 档位定价/权益维护 */
adminRouter.get('/subscription-plans', async (_req: Request, res: Response) => {
  res.json(await findMany('SELECT * FROM subscription_plans ORDER BY sort'));
});
adminRouter.patch('/subscription-plans/:code', async (req: Request, res: Response) => {
  const { monthlyPrice, guaranteedTasks, commissionDiscount } = req.body || {};
  const plan = await findOne<any>('SELECT * FROM subscription_plans WHERE code = ?', [req.params.code]);
  if (!plan) return res.status(404).json({ error: '档位不存在' });
  let benefits: Record<string, unknown> = {};
  try { benefits = JSON.parse(plan.benefits || '{}'); } catch { benefits = {}; }
  if (guaranteedTasks !== undefined) benefits.guaranteedTasks = Number(guaranteedTasks) || 0;
  if (commissionDiscount !== undefined) benefits.commissionDiscount = Number(commissionDiscount) || 0;
  await pool.query(
    `UPDATE subscription_plans SET monthly_price = $1, benefits = $2, updated_at = $3 WHERE code = $4`,
    [monthlyPrice === undefined ? plan.monthly_price : (monthlyPrice === null ? null : Number(monthlyPrice)),
     JSON.stringify(benefits), new Date().toISOString(), req.params.code]);
  res.json(await findOne('SELECT * FROM subscription_plans WHERE code = ?', [req.params.code]));
});

/** PATCH /api/admin/brands/:userId/agency — 设置广告代理商标识 */
adminRouter.patch('/brands/:userId/agency', async (req: Request, res: Response) => {
  const { isAgency } = req.body;
  if (typeof isAgency !== 'boolean') return res.status(400).json({ error: 'isAgency 须为布尔值' });

  const profile = await findOne('SELECT user_id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!profile) return res.status(404).json({ error: '品牌账户不存在' });

  await pool.query('UPDATE brand_profiles SET is_agency = $1 WHERE user_id = $2', [isAgency, req.params.userId]);
  res.json({ userId: req.params.userId, isAgency });
});

/** PATCH /api/admin/brands/:userId/pricing — 账户协议抽佣费率 */
adminRouter.patch('/brands/:userId/pricing', async (req: Request, res: Response) => {
  const adminId = req.user!.userId;
  const { commissionRateOverride, note } = req.body;

  const profile = await findOne('SELECT user_id FROM brand_profiles WHERE user_id = ?', [req.params.userId]);
  if (!profile) return res.status(404).json({ error: '品牌账户不存在' });

  if (commissionRateOverride === null) {
    await update('brand_profiles', {
      commission_rate_override:      null,
      commission_rate_override_note: null,
      commission_rate_override_by:   adminId,
      commission_rate_override_at:   new Date().toISOString(),
    }, 'user_id = ?', [req.params.userId]);
    res.json({ commissionRateOverride: null, note: '已恢复全局默认费率' });
  } else {
    const rate = Number(commissionRateOverride);
    if (isNaN(rate) || rate < 0 || rate > 1) {
      return res.status(400).json({ error: '费率须为 0~1 之间的小数' });
    }
    await update('brand_profiles', {
      commission_rate_override:      rate,
      commission_rate_override_note: note || null,
      commission_rate_override_by:   adminId,
      commission_rate_override_at:   new Date().toISOString(),
    }, 'user_id = ?', [req.params.userId]);
    const { rate: effective } = await getEffectiveCommissionRate(String(req.params.userId));
    res.json({ commissionRateOverride: rate, effectiveRate: effective, note });
  }
});
