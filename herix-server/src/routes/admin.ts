import { Router, Request, Response } from 'express';
import { findMany, findOne, update, insert } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { sendMail } from '../utils/mailer';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

/* ── Stats & Dashboard ── */

adminRouter.get('/stats', (_req: Request, res: Response) => {
  const heralds     = findOne<any>('SELECT COUNT(*) as n FROM users WHERE role = ?', ['HERALD']);
  const brands      = findOne<any>('SELECT COUNT(*) as n FROM users WHERE role = ?', ['BRAND']);
  const openTasks   = findOne<any>("SELECT COUNT(*) as n FROM tasks WHERE status = 'OPEN'");
  const pendingDecl = findOne<any>("SELECT COUNT(*) as n FROM declarations WHERE status = 'pending'");
  const pendingSubs = findOne<any>("SELECT COUNT(*) as n FROM task_submissions WHERE status = 'PENDING_REVIEW'");
  const pendingApps = findOne<any>("SELECT COUNT(*) as n FROM task_applications WHERE status = 'PENDING'");
  const thisMonth   = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0);
  const monthStr    = thisMonth.toISOString();
  const monthCompletions = findOne<any>("SELECT COUNT(*) as n FROM task_submissions WHERE status = 'APPROVED' AND reviewed_at >= ?", [monthStr]);
  const pendingPayout    = findOne<any>("SELECT COALESCE(SUM(amount),0) as n FROM payouts WHERE status = 'pending'");
  const monthPayout      = findOne<any>("SELECT COALESCE(SUM(amount),0) as n FROM payouts WHERE status = 'paid' AND paid_at >= ?", [monthStr]);

  // 近7日每日完成数
  const daily: any[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const cnt = findOne<any>(
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

adminRouter.get('/users', (req: Request, res: Response) => {
  const { role, page = '1', q } = req.query;
  const limit = 50, skip = (Number(page) - 1) * limit;
  let where = '1=1'; const params: any[] = [];
  if (role) { where += ' AND u.role = ?'; params.push(role); }
  if (q) { where += ' AND (u.nickname LIKE ? OR u.email LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }

  const rows = findMany<any>(`
    SELECT u.id, u.nickname, u.email, u.role, u.is_verified, u.created_at,
           hp.residence, hp.kyc_status, hp.is_onboarded as herald_onboarded,
           bp.company_name, bp.is_onboarded as brand_onboarded
    FROM users u
    LEFT JOIN herald_profiles hp ON hp.user_id = u.id
    LEFT JOIN brand_profiles bp ON bp.user_id = u.id
    WHERE ${where} AND u.role != 'ADMIN'
    ORDER BY u.created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, skip]);
  const total = findOne<any>(`SELECT COUNT(*) as n FROM users u WHERE ${where} AND u.role != 'ADMIN'`, params);
  res.json({ users: rows, total: total?.n || 0 });
});

adminRouter.post('/users/:id/suspend', (req: Request, res: Response) => {
  const { suspend } = req.body;
  update('users', { is_verified: suspend ? -1 : 0 }, 'id = ?', [req.params.id]);
  res.json({ success: true });
});

/* ── Tasks ── */

adminRouter.get('/tasks', (req: Request, res: Response) => {
  const { status, page = '1' } = req.query;
  const limit = 50, skip = (Number(page) - 1) * limit;
  let where = '1=1'; const params: any[] = [];
  if (status) { where += ' AND t.status = ?'; params.push(status); }

  const rows = findMany<any>(`
    SELECT t.*, u.nickname as creator_name,
           (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id = t.id) as application_count,
           (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id = t.id AND ta.status = 'APPROVED') as approved_count,
           (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id = t.id AND ts.status = 'APPROVED') as completed_count
    FROM tasks t JOIN users u ON u.id = t.creator_id
    WHERE ${where}
    ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, skip]);
  const total = findOne<any>(`SELECT COUNT(*) as n FROM tasks t WHERE ${where}`, params);
  res.json({ tasks: rows, total: total?.n || 0 });
});

adminRouter.patch('/tasks/:id/status', (req: Request, res: Response) => {
  const { status } = req.body;
  const allowed = ['OPEN','COMPLETED','CANCELLED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: '无效状态' });
  update('tasks', { status, updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  res.json({ success: true });
});

/* ── Declarations ── */

adminRouter.get('/declarations', (_req: Request, res: Response) => {
  res.json(findMany<any>(`
    SELECT d.*, u.nickname, u.email
    FROM declarations d JOIN users u ON u.id = d.user_id
    WHERE d.status = 'pending' ORDER BY d.submitted_at ASC
  `));
});

adminRouter.post('/declarations/:id/approve', async (req: Request, res: Response) => {
  const d = findOne<any>('SELECT * FROM declarations WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: '不存在' });
  update('declarations', { status: 'approved', reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  update('herald_profiles', { declaration_status: 'approved', kyc_status: 'approved' }, 'user_id = ?', [d.user_id]);
  const u = findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [d.user_id]);
  if (u?.email) await sendMail(u.email, '【Herix】在留资格声明已通过审核', `${u.nickname}，您的在留资格声明已通过审核，现在可以接取任务了。`);
  res.json({ success: true });
});

adminRouter.post('/declarations/:id/reject', async (req: Request, res: Response) => {
  const { reason } = req.body;
  const d = findOne<any>('SELECT * FROM declarations WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: '不存在' });
  update('declarations', { status: 'rejected', reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  update('herald_profiles', { declaration_status: 'rejected' }, 'user_id = ?', [d.user_id]);
  const u = findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [d.user_id]);
  if (u?.email) await sendMail(u.email, '【Herix】在留资格声明审核结果', `${u.nickname}，您的声明暂未通过审核。${reason ? '原因：' + reason : ''}`);
  res.json({ success: true });
});

/* ── Submissions ── */

adminRouter.get('/applications', (_req: Request, res: Response) => {
  const apps = findMany<any>(
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
  const app = findOne<any>('SELECT * FROM task_applications WHERE id = ?', [req.params.id]);
  if (!app || app.status !== 'PENDING') return res.status(404).json({ error: '报名不存在或已处理' });
  update('task_applications', { status: 'APPROVED', updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  res.json({ message: '已通过' });
});

adminRouter.post('/applications/:id/reject', async (req: Request, res: Response) => {
  const app = findOne<any>('SELECT * FROM task_applications WHERE id = ?', [req.params.id]);
  if (!app || app.status !== 'PENDING') return res.status(404).json({ error: '报名不存在或已处理' });
  update('task_applications', { status: 'REJECTED', updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  res.json({ message: '已拒绝' });
});

adminRouter.get('/submissions', (_req: Request, res: Response) => {
  res.json(findMany<any>(`
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
  const s = findOne<any>('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: '不存在' });
  update('task_submissions', { status: 'APPROVED', reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const u = findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [s.herald_id]);
  const t = findOne<any>('SELECT title FROM tasks WHERE id = ?', [s.task_id]);
  if (u?.email) await sendMail(u.email, '【Herix】内容审核通过', `${u.nickname}，您提交的任务「${t?.title}」内容已审核通过，报酬将在月末结算。`);
  res.json({ success: true });
});

adminRouter.post('/submissions/:id/reject', async (req: Request, res: Response) => {
  const { reason } = req.body;
  const s = findOne<any>('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: '不存在' });
  update('task_submissions', { status: 'REJECTED', review_note: reason || null, reviewed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const u = findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [s.herald_id]);
  const t = findOne<any>('SELECT title FROM tasks WHERE id = ?', [s.task_id]);
  if (u?.email) await sendMail(u.email, '【Herix】内容审核未通过', `${u.nickname}，您提交的任务「${t?.title}」内容暂未通过审核。${reason ? '原因：' + reason : '请修改后重新提交。'}`);
  res.json({ success: true });
});

/* ── Payouts ── */

adminRouter.get('/payouts', (_req: Request, res: Response) => {
  // 计算每位赫使的应付金额（已审核通过但未入 payout 的）
  const earned = findMany<any>(`
    SELECT u.id, u.nickname, u.email,
           hp.bank_account, hp.residence,
           COUNT(ts.id) as completed_tasks,
           SUM(t.commission) as total_earned
    FROM task_submissions ts
    JOIN tasks t ON t.id = ts.task_id
    JOIN users u ON u.id = ts.herald_id
    JOIN herald_profiles hp ON hp.user_id = u.id
    WHERE ts.status = 'APPROVED'
    GROUP BY u.id
    ORDER BY total_earned DESC
  `);

  const payouts = findMany<any>(`
    SELECT p.*, u.nickname, u.email
    FROM payouts p JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 100
  `);

  res.json({ earned, payouts });
});

adminRouter.post('/payouts/generate', (req: Request, res: Response) => {
  const period = new Date().toISOString().slice(0, 7); // "2026-05"
  // 找出本月有通过内容的赫使
  const heralds = findMany<any>(`
    SELECT u.id, SUM(t.commission) as amount, COUNT(ts.id) as count
    FROM task_submissions ts
    JOIN tasks t ON t.id = ts.task_id
    JOIN users u ON u.id = ts.herald_id
    WHERE ts.status = 'APPROVED'
      AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.user_id = u.id AND p.period = ?)
    GROUP BY u.id HAVING amount > 0
  `, [period]);

  let created = 0;
  for (const h of heralds) {
    insert('payouts', { user_id: h.id, period, qualified_count: h.count, amount: h.amount, status: 'pending' });
    created++;
  }
  res.json({ created, period });
});

adminRouter.post('/payouts/:id/mark-paid', async (req: Request, res: Response) => {
  const { method } = req.body;
  const p = findOne<any>('SELECT * FROM payouts WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: '不存在' });
  update('payouts', { status: 'paid', paid_at: new Date().toISOString(), payment_method: method || 'wise' }, 'id = ?', [req.params.id]);
  const u = findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [p.user_id]);
  if (u?.email) await sendMail(u.email, '【Herix】报酬已打款', `${u.nickname}，${p.period} 期报酬 ¥${p.amount} 已通过 ${method||'银行'} 完成打款，请注意查收。`);
  res.json({ success: true });
});

/* ── Ambassadors ── */

adminRouter.get('/ambassadors', (_req: Request, res: Response) => {
  res.json(findMany<any>(`
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
