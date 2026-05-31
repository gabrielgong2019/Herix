import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth';
import { CreateTaskSchema } from '../types';
import { ZodError } from 'zod';
import crypto from 'crypto';

function genCode(): string {
  return 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateCodePool(taskId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    let code = genCode();
    while (findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code])) {
      code = genCode();
    }
    insert('task_promo_codes', { task_id: taskId, code });
  }
}

export const tasksRouter = Router();

/** GET /api/tasks — 获取任务列表（已登录用户可见自己所有状态，未登录只见 OPEN） */
tasksRouter.get('/', optionalAuth, (req: Request, res: Response) => {
  const { status, mode, creator, page = '1', limit = '20' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params: any[] = [];

  if (status) { where += ' AND t.status = ?'; params.push(status); }
  if (mode) { where += ' AND t.mode = ?'; params.push(mode); }
  if (creator) { where += ' AND t.creator_id = ?'; params.push(creator); }
  // 非创建者只看已发布（OPEN）任务
  const uid = req.user?.userId;
  if (!uid) {
    where += " AND t.status = 'OPEN'";
  } else if (!creator) {
    // 如果没传 creator 参数（即赫使浏览），也只显示 OPEN
    where += " AND (t.status = 'OPEN' OR t.creator_id = ?)";
    params.push(uid);
  }

  const total = (findOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM tasks t WHERE ${where}`, params
  )?.cnt) || 0;

  const tasks = findMany<any>(
    `SELECT t.*, u.nickname as creator_name,
            (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id = t.id) as application_count,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*) FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count
     FROM tasks t
     JOIN users u ON u.id = t.creator_id
     WHERE ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), skip]
  );

  res.json({
    tasks,
    pagination: {
      page: Number(page), limit: Number(limit), total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

/** GET /api/tasks/my/stats — 我的任务数据（已登录即可，creator 过滤保证只看自己的） */
tasksRouter.get('/my/stats', requireAuth, (req: Request, res: Response) => {
  const uid = req.user!.userId;

  const tasks = findMany<any>(`
    SELECT t.id, t.title, t.mode, t.status, t.commission, t.max_heralds, t.created_at,
      (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id=t.id) as app_total,
      (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id=t.id AND ta.status='APPROVED') as app_approved,
      (SELECT COUNT(*) FROM task_applications ta WHERE ta.task_id=t.id AND ta.status='PENDING') as app_pending,
      (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id=t.id) as sub_total,
      (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id=t.id AND ts.status='APPROVED') as sub_approved,
      (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id=t.id AND ts.status='PENDING_REVIEW') as sub_pending,
      (SELECT COUNT(*) FROM ambassador_tasks at WHERE at.task_id=t.id) as code_holders,
      (SELECT COUNT(*) FROM ambassador_tasks at JOIN referrals r ON r.ambassador_task_id=at.id WHERE at.task_id=t.id AND r.qualified=1) as qualified_referrals,
      (SELECT COUNT(*) FROM ambassador_tasks at JOIN referrals r ON r.ambassador_task_id=at.id WHERE at.task_id=t.id) as total_referrals
    FROM tasks t WHERE t.creator_id=? ORDER BY t.created_at DESC
  `, [uid]);

  const summary = {
    totalTasks: tasks.length,
    openTasks:  tasks.filter((t: any) => t.status === 'OPEN').length,
    draftTasks: tasks.filter((t: any) => t.status === 'DRAFT').length,
    totalApplicants: tasks.reduce((s: number, t: any) => s + (t.app_total || 0), 0),
    pendingApplicants: tasks.reduce((s: number, t: any) => s + (t.app_pending || 0), 0),
    pendingSubmissions: tasks.reduce((s: number, t: any) => s + (t.sub_pending || 0), 0),
    totalCompleted: tasks.reduce((s: number, t: any) => s + (t.sub_approved || 0), 0),
    totalSpend: tasks.reduce((s: number, t: any) => s + (t.sub_approved || 0) * t.commission, 0),
    pendingSpend: tasks.reduce((s: number, t: any) => s + (t.sub_pending || 0) * t.commission, 0),
    qualifiedReferrals: tasks.reduce((s: number, t: any) => s + (t.qualified_referrals || 0), 0),
  };

  res.json({ summary, tasks });
});

/** GET /api/tasks/:id — 任务详情 (公开) */
tasksRouter.get('/:id/codes', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const task = findOne<any>('SELECT creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });

  const all = findMany<any>(
    'SELECT code, herald_id, assigned_at FROM task_promo_codes WHERE task_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({
    total: all.length,
    assigned: all.filter((c: any) => c.herald_id).length,
    available: all.filter((c: any) => !c.herald_id).length,
    samples: all.slice(0, 5).map((c: any) => c.code),
  });
});

/** GET /api/tasks/:id/codes/export — 下载推广码 CSV（商家用） */
tasksRouter.get('/:id/codes/export', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const task = findOne<any>('SELECT id, title, creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }

  const codes = findMany<any>(`
    SELECT
      pc.code as unique_code,
      pc.assigned_at,
      CASE WHEN pc.herald_id IS NULL THEN 'available' ELSE 'assigned' END as status,
      u.nickname as herald_name,
      u.email as herald_email,
      hp.country, hp.residence,
      COALESCE((SELECT COUNT(*) FROM referrals r JOIN ambassador_tasks at ON at.id = r.ambassador_task_id WHERE at.unique_code = pc.code AND r.qualified = 1), 0) as qualified_count,
      COALESCE((SELECT COUNT(*) FROM referrals r JOIN ambassador_tasks at ON at.id = r.ambassador_task_id WHERE at.unique_code = pc.code), 0) as total_referrals
    FROM task_promo_codes pc
    LEFT JOIN users u ON u.id = pc.herald_id
    LEFT JOIN herald_profiles hp ON hp.user_id = pc.herald_id
    WHERE pc.task_id = ?
    ORDER BY pc.created_at ASC
  `, [req.params.id]);

  const header = 'promo_code,status,herald_name,herald_email,country,residence,assigned_at,total_referrals,qualified_count';
  const rows = codes.map((c: any) =>
    [c.unique_code, c.status, c.herald_name || '', c.herald_email || '',
     c.country || '', c.residence || '', c.assigned_at?.slice(0, 10) || '',
     c.total_referrals, c.qualified_count].join(',')
  );

  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="herix_codes_${req.params.id.slice(0,8)}.csv"`);
  res.send('﻿' + csv); // BOM for Excel compatibility
});

/** POST /api/tasks/:id/codes/upload — 商家上传自定义推广码 */
tasksRouter.post('/:id/codes/upload', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const task = findOne<any>('SELECT id, creator_id, mode, code_mode, max_heralds FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '仅成果报酬任务支持推广码' });

  const { codes } = req.body as { codes: string[] };
  if (!Array.isArray(codes) || codes.length === 0) return res.status(400).json({ error: 'codes 数组不能为空' });

  const cleaned = [...new Set(codes.map((c: string) => c.trim()).filter(Boolean))];
  if (cleaned.length > task.max_heralds) {
    return res.status(400).json({ error: `推广码数量（${cleaned.length}）超过任务名额（${task.max_heralds}）` });
  }

  let added = 0, skipped = 0;
  for (const code of cleaned) {
    const exists = findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code]);
    if (exists) { skipped++; continue; }
    insert('task_promo_codes', { task_id: task.id, code });
    added++;
  }

  res.json({ added, skipped, total: cleaned.length, maxHeralds: task.max_heralds });
});

/** POST /api/tasks/:id/csv — 上传推广码转化数据 (类型A) */
tasksRouter.post('/:id/csv', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const task = findOne<any>('SELECT id, creator_id, mode, commission FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '只有成果报酬任务支持数据上传' });

  const { records } = req.body as { records: Array<{ code: string; registered_count?: number; used_count?: number }> };
  if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ error: 'records 不能为空' });

  let processed = 0, skipped = 0;
  for (const row of records) {
    const ambassadorTask = findOne<any>(
      'SELECT id, herald_id FROM ambassador_tasks WHERE unique_code = ? AND task_id = ?', [row.code, task.id]
    );
    if (!ambassadorTask) { skipped++; continue; }

    const regCount = Math.max(0, parseInt(String(row.registered_count || '0'), 10));
    const usedCount = Math.max(0, parseInt(String(row.used_count || '0'), 10));
    const earnedAmount = usedCount * task.commission;

    update('ambassador_tasks', {
      registered_count: regCount,
      used_count: usedCount
    }, 'id = ?', [ambassadorTask.id]);

    processed++;
  }

  res.json({ processed, skipped, total: records.length, commissionPerUser: task.commission });
});

/** PATCH /api/tasks/:id/publish});

/** PATCH /api/tasks/:id/publish — 发布任务 */
tasksRouter.get('/:id', (req: Request, res: Response) => {
  const task = findOne<any>(
    `SELECT t.*, u.nickname as creator_name,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*) FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count
     FROM tasks t JOIN users u ON u.id = t.creator_id
     WHERE t.id = ?`, [req.params.id]
  );

  if (!task) return res.status(404).json({ error: '任务不存在' });

  const applications = findMany<any>(
    `SELECT ta.*, u.nickname, hp.display_name, hp.country, hp.social_platforms
     FROM task_applications ta
     JOIN users u ON u.id = ta.herald_id
     LEFT JOIN herald_profiles hp ON hp.user_id = ta.herald_id
     WHERE ta.task_id = ?`, [req.params.id]
  );

  const submissionCount = (findOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM task_submissions WHERE task_id = ?', [req.params.id]
  )?.cnt) || 0;

  res.json({ ...task, applications, _count: { applications: applications.length, submissions: submissionCount } });
});

/** POST /api/tasks — 创建任务 (品牌商家) */
tasksRouter.post('/', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  try {
    const data = CreateTaskSchema.parse(req.body);

    const taskId = insert('tasks', {
      creator_id: req.user!.userId,
      mode: data.mode,
      title: data.title,
      description: data.description,
      requirements: data.requirements || null,
      budget: data.budget,
      commission: data.commission,
      max_heralds: data.maxHeralds,
      deadline: data.deadline || null,
      category: data.category || null,
      content_type: data.mode === 'PERFORMANCE' ? null : data.contentType,
      difficulty: data.difficulty,
      cover_image: data.coverImage || null,
      code_mode: data.codeMode || 'auto',
      status: 'DRAFT',
    });

    // PERFORMANCE + 自动模式：创建时立即生成推广码池
    if (data.mode === 'PERFORMANCE' && data.codeMode === 'auto') {
      generateCodePool(taskId, data.maxHeralds);
    }

    const task = findOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error('Create task error:', err);
    res.status(500).json({ error: '创建任务失败' });
  }
});

/** PUT /api/tasks/:id — 编辑草稿任务 */
tasksRouter.put('/:id', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const task = findOne<any>('SELECT id, creator_id, status FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.status !== 'DRAFT') return res.status(400).json({ error: '只有草稿可以编辑' });

  const { title, description, requirements, commission, maxHeralds, deadline, category, contentType, difficulty, coverImage } = req.body;
  const data: Record<string, any> = {};
  if (title) data.title = title;
  if (description) data.description = description;
  if (requirements !== undefined) data.requirements = requirements;
  if (commission) data.commission = commission;
  if (maxHeralds) data.max_heralds = maxHeralds;
  if (deadline !== undefined) data.deadline = deadline || null;
  if (category !== undefined) data.category = category;
  if (contentType) data.content_type = contentType;
  if (difficulty) data.difficulty = difficulty;
  if (coverImage !== undefined) data.cover_image = coverImage || null;

  update('tasks', data, 'id = ?', [req.params.id]);
  res.json(findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]));
});

/** GET /api/tasks/:id/codes — 推广码池概览（商家用） */
tasksRouter.patch('/:id/publish', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const task = findOne<{ id: string; creator_id: string; status: string }>('SELECT id, creator_id, status FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '只有创建者可以发布' });
  }
  if (task.status !== 'DRAFT') {
    return res.status(400).json({ error: '只有草稿状态可以发布' });
  }

  update('tasks', { status: 'OPEN', published_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const updated = findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});

/** PATCH /api/tasks/:id/escrow — 托管资金 */
tasksRouter.patch('/:id/escrow', requireAuth, requireRole('BRAND'), (req: Request, res: Response) => {
  const task = findOne<{ id: string; creator_id: string; commission: number; max_heralds: number; title: string }>(
    'SELECT id, creator_id, commission, max_heralds, title FROM tasks WHERE id = ?', [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId) return res.status(403).json({ error: '只有创建者可以操作' });

  const escrowAmount = task.commission * task.max_heralds;

  update('tasks', { escrow_amount: escrowAmount, is_escrowed: 1 }, 'id = ?', [req.params.id]);
  insert('transactions', {
    user_id: req.user!.userId,
    task_id: task.id,
    type: 'ESCROW_DEPOSIT',
    amount: escrowAmount,
    status: 'COMPLETED',
    note: `任务 ${task.title} 资金托管`,
    completed_at: new Date().toISOString(),
  });

  const updated = findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});

/** PATCH /api/tasks/:id/complete — 完成任务 */
tasksRouter.patch('/:id/complete', requireAuth, requireRole('BRAND'), (req: Request, res: Response) => {
  const task = findOne<{ id: string; creator_id: string }>('SELECT id, creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId) return res.status(403).json({ error: '无权限' });

  update('tasks', { status: 'COMPLETED', completed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const updated = findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});
