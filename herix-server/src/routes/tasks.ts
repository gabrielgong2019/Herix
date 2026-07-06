import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth';
import { CreateTaskSchema } from '../types';
import { ZodError } from 'zod';
import crypto from 'crypto';
import { freezeForTask, unfreezeTask, settleTask, creditHerald, creditPlatformFee, getBalance, PLATFORM_USER_ID } from '../utils/wallet';

function genCode(): string {
  return 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function generateCodePool(taskId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    let code = genCode();
    while (await findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code])) {
      code = genCode();
    }
    await insert('task_promo_codes', { task_id: taskId, code });
  }
}

export const tasksRouter = Router();

/** GET /api/tasks — 获取任务列表（已登录用户可见自己所有状态，未登录只见 OPEN） */
tasksRouter.get('/', optionalAuth, async (req: Request, res: Response) => {
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

  const totalRow = await findOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM tasks t WHERE ${where}`, params
  );

  const total = totalRow?.cnt || 0;

  const tasks = await findMany<any>(
    `SELECT t.*, u.nickname as creator_name,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url,
            (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id = t.id) as application_count,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*)::int FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count
     FROM tasks t
     JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
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
tasksRouter.get('/my/stats', requireAuth, async (req: Request, res: Response) => {
  const uid = req.user!.userId;

  const tasks = await findMany<any>(`
    SELECT t.id, t.title, t.mode, t.status, t.commission, t.max_heralds, t.created_at,
      (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id=t.id) as app_total,
      (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id=t.id AND ta.status='APPROVED') as app_approved,
      (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id=t.id AND ta.status='PENDING') as app_pending,
      (SELECT COUNT(*)::int FROM task_submissions ts WHERE ts.task_id=t.id) as sub_total,
      (SELECT COUNT(*)::int FROM task_submissions ts WHERE ts.task_id=t.id AND ts.status='APPROVED') as sub_approved,
      (SELECT COUNT(*)::int FROM task_submissions ts WHERE ts.task_id=t.id AND ts.status='PENDING_REVIEW') as sub_pending,
      (SELECT COUNT(*)::int FROM ambassador_tasks at WHERE at.task_id=t.id) as code_holders,
      (SELECT COUNT(*)::int FROM ambassador_tasks at JOIN referrals r ON r.ambassador_task_id=at.id WHERE at.task_id=t.id AND r.qualified=1) as qualified_referrals,
      (SELECT COUNT(*)::int FROM ambassador_tasks at JOIN referrals r ON r.ambassador_task_id=at.id WHERE at.task_id=t.id) as total_referrals
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
tasksRouter.get('/:id/codes', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });

  const all = await findMany<any>(
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
tasksRouter.get('/:id/codes/export', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, title, creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }

  const codes = await findMany<any>(`
    SELECT
      pc.code as unique_code,
      pc.assigned_at,
      CASE WHEN pc.herald_id IS NULL THEN 'available' ELSE 'assigned' END as status,
      u.nickname as herald_name,
      u.email as herald_email,
      hp.country, hp.residence,
      COALESCE((SELECT COUNT(*)::int FROM referrals r JOIN ambassador_tasks at ON at.id = r.ambassador_task_id WHERE at.unique_code = pc.code AND r.qualified = 1), 0) as qualified_count,
      COALESCE((SELECT COUNT(*)::int FROM referrals r JOIN ambassador_tasks at ON at.id = r.ambassador_task_id WHERE at.unique_code = pc.code), 0) as total_referrals
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
tasksRouter.post('/:id/codes/upload', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, mode, code_mode, max_heralds FROM tasks WHERE id = ?', [req.params.id]);
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
    const exists = await findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code]);
    if (exists) { skipped++; continue; }
    await insert('task_promo_codes', { task_id: task.id, code });
    added++;
  }

  res.json({ added, skipped, total: cleaned.length, maxHeralds: task.max_heralds });
});

/** POST /api/tasks/:id/csv — 上传推广码转化数据，每条新转化直接写 transactions */
tasksRouter.post('/:id/csv', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>(
    'SELECT id, creator_id, mode, commission, currency, title, lock_txn_id FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '只有成果报酬任务支持数据上传' });

  const { records } = req.body as { records: Array<{ code: string; registered_count?: number; used_count?: number }> };
  if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ error: 'records 不能为空' });

  const PLATFORM_FEE_RATE = 0.15;
  let processed = 0, skipped = 0, totalNewConversions = 0, totalPaid = 0;

  for (const row of records) {
    const at = await findOne<any>(
      'SELECT id, herald_id, paid_conversions FROM ambassador_tasks WHERE unique_code = ? AND task_id = ?',
      [row.code, task.id]
    );
    if (!at) { skipped++; continue; }

    const newUsedCount = Math.max(0, parseInt(String(row.used_count || '0'), 10));
    const newRegCount  = Math.max(0, parseInt(String(row.registered_count || '0'), 10));
    const alreadyPaid  = Number(at.paid_conversions || 0);
    const delta        = newUsedCount - alreadyPaid;  // 新增转化数

    // 更新原始数据（用于报表）
    await update('ambassador_tasks', {
      registered_count: newRegCount,
      used_count: newUsedCount,
    }, 'id = ?', [at.id]);

    if (delta <= 0) { processed++; continue; }  // 无新增转化，跳过打款

    // 每个新转化：写一笔 ESCROW_RELEASE
    const commissionPerConv = task.commission;
    const feePerConv        = Math.round(commissionPerConv * PLATFORM_FEE_RATE * 100) / 100;
    const payoutPerConv     = commissionPerConv - feePerConv;

    // task_transactions 记录业务事件
    const releaseTxnId = await insert('task_transactions', {
      task_id:       task.id,
      type:          'TASK_RELEASE',
      task_amount:   commissionPerConv * delta,
      amount:        payoutPerConv * delta,
      platform_fee:  feePerConv * delta,
      from_user_id:  task.creator_id,
      to_user_id:    at.herald_id,
      parent_txn_id: task.lock_txn_id || null,
      status:        'completed',
      note:          `推广码 ${row.code} 新增 ${delta} 次转化`,
    });

    // 品牌冻结清零，赫使+收入，平台+手续费（三笔钱包操作）
    const idKey = `CSV:${task.id}:${row.code}:${newUsedCount}`;
    await Promise.all([
      settleTask({
        userId: task.creator_id, amount: commissionPerConv * delta, currency: task.currency,
        idempotencyKey: `SETTLE:${releaseTxnId}`,
        referenceType: 'task_transaction', referenceId: releaseTxnId,
        note: `推广码 ${row.code} 结算 ${delta} 次`,
      }),
      creditHerald({
        userId: at.herald_id, amount: payoutPerConv * delta, currency: task.currency,
        idempotencyKey: `CREDIT:${releaseTxnId}`,
        referenceType: 'task_transaction', referenceId: releaseTxnId,
        note: `任务《${task.title}》推广收入`,
      }),
      creditPlatformFee({
        userId: PLATFORM_USER_ID, amount: feePerConv * delta, currency: task.currency,
        idempotencyKey: `FEE:${releaseTxnId}`,
        referenceType: 'task_transaction', referenceId: releaseTxnId,
        note: `平台服务费 15%`,
      }),
    ]);

    // 更新已付转化数，防止重复计费
    await update('ambassador_tasks', { paid_conversions: newUsedCount }, 'id = ?', [at.id]);

    totalNewConversions += delta;
    totalPaid           += payoutPerConv * delta;
    processed++;
  }

  res.json({
    processed,
    skipped,
    total: records.length,
    newConversions: totalNewConversions,
    totalPaid,
    commissionPerConversion: task.commission,
  });
});

/** PATCH /api/tasks/:id/publish});

/** PATCH /api/tasks/:id/publish — 发布任务 */
tasksRouter.get('/:id', async (req: Request, res: Response) => {
  const task = await findOne<any>(
    `SELECT t.*, u.nickname as creator_name,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*)::int FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count
     FROM tasks t JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     WHERE t.id = ?`, [req.params.id]
  );

  if (!task) return res.status(404).json({ error: '任务不存在' });

  const applications = await findMany<any>(
    `SELECT ta.*, u.nickname, hp.display_name, hp.country, hp.social_platforms,
            hp.tier_snapshot, hp.social_platforms_updated_at,
            (SELECT COUNT(*) FROM task_submissions ts2 WHERE ts2.herald_id = ta.herald_id AND ts2.status = 'APPROVED') AS completed_tasks,
            (SELECT ROUND(AVG(CASE WHEN tr.score >= 4 THEN 1.0 ELSE 0 END) * 100) / 100.0
             FROM task_ratings tr WHERE tr.herald_id = ta.herald_id) AS good_rate
     FROM task_applications ta
     JOIN users u ON u.id = ta.herald_id
     LEFT JOIN herald_profiles hp ON hp.user_id = ta.herald_id
     WHERE ta.task_id = ?`, [req.params.id]
  );

  const subRow = await findOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM task_submissions WHERE task_id = ?', [req.params.id]
  );

  const submissionCount = subRow?.cnt || 0;

  res.json({ ...task, applications, _count: { applications: applications.length, submissions: submissionCount } });
});

/** POST /api/tasks — 创建任务 (品牌商家) */
tasksRouter.post('/', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const data = CreateTaskSchema.parse(req.body);

    // 任务币种快照自品牌资料（CNY=中国业务 / JPY=日本业务），创建后不可变
    const brand = await findOne<{ currency: string }>('SELECT currency FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);

    const taskId = await insert('tasks', {
      creator_id: req.user!.userId,
      mode: data.mode,
      title: data.title,
      description: data.description,
      requirements: data.requirements || null,
      budget: data.budget,
      commission: data.commission,
      currency: brand?.currency || 'JPY',
      max_heralds: data.maxHeralds,
      deadline: data.deadline || null,
      category: data.category || null,
      content_type: data.mode === 'PERFORMANCE' ? null : data.contentType,
      difficulty: data.difficulty,
      cover_image: data.coverImage || null,
      code_mode: data.codeMode || 'auto',
      platform_requirements: data.platformRequirements ? JSON.stringify(data.platformRequirements) : null,
      status: 'DRAFT',
    });

    // PERFORMANCE + 自动模式：创建时立即生成推广码池
    if (data.mode === 'PERFORMANCE' && data.codeMode === 'auto') {
      generateCodePool(taskId, data.maxHeralds);
    }

    const task = await findOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
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
tasksRouter.put('/:id', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, status FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.status !== 'DRAFT') return res.status(400).json({ error: '只有草稿可以编辑' });

  const { title, description, requirements, commission, maxHeralds, deadline, category, contentType, difficulty, coverImage, platformRequirements } = req.body;
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
  if (platformRequirements !== undefined) data.platform_requirements = platformRequirements ? JSON.stringify(platformRequirements) : null;

  await update('tasks', data, 'id = ?', [req.params.id]);
  res.json(await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]));
});

/** PATCH /api/tasks/:id/meta — 已发布任务的有限字段编辑 */
tasksRouter.patch('/:id/meta', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<{ id: string; creator_id: string; status: string; max_heralds: number }>(
    'SELECT id, creator_id, status, max_heralds FROM tasks WHERE id = ?', [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }
  if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) {
    return res.status(400).json({ error: '只有进行中的任务可以编辑' });
  }

  const { description, requirements, deadline, coverImage, platformRequirements, maxHeralds } = req.body;
  const data: Record<string, any> = {};
  if (description !== undefined) data.description = description;
  if (requirements !== undefined) data.requirements = requirements || null;
  if (deadline !== undefined) data.deadline = deadline || null;
  if (coverImage !== undefined) data.cover_image = coverImage || null;
  if (platformRequirements !== undefined) data.platform_requirements = platformRequirements ? JSON.stringify(platformRequirements) : null;
  // 名额只允许增加
  if (maxHeralds !== undefined) {
    if (maxHeralds < task.max_heralds) return res.status(400).json({ error: '名额不能减少' });
    data.max_heralds = maxHeralds;
  }

  if (!Object.keys(data).length) return res.status(400).json({ error: '没有可更新的字段' });
  await update('tasks', data, 'id = ?', [req.params.id]);
  res.json(await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]));
});

/** GET /api/tasks/:id/codes — 推广码池概览（商家用） */
tasksRouter.patch('/:id/publish', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>(
    'SELECT id, creator_id, status, commission, currency, max_heralds, title FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '只有创建者可以发布' });
  }
  if (task.status !== 'DRAFT') {
    return res.status(400).json({ error: '只有草稿状态可以发布' });
  }

  // 检查品牌钱包余额（从 wallets 表读，O(1)，按任务币种）
  const needed = task.commission * task.max_heralds;
  const bal = await getBalance(task.creator_id, 'brand', task.currency);

  if (bal.available < needed) {
    return res.status(402).json({
      error: `余额不足，需要 ${task.currency} ${needed}，当前可用 ${task.currency} ${bal.available.toFixed(0)}`,
      code: 'INSUFFICIENT_BALANCE',
      needed,
      available: bal.available,
      currency: task.currency,
    });
  }

  // 发布任务
  await update('tasks', {
    status: 'OPEN',
    published_at: new Date().toISOString(),
    escrow_amount: needed,
    is_escrowed: 1,
  }, 'id = ?', [req.params.id]);

  // 品牌钱包：可用→冻结（原子操作，按任务币种）
  const { entryId: lockEntryId } = await freezeForTask({
    userId: task.creator_id,
    amount: needed,
    currency: task.currency,
    idempotencyKey: `TASK_FREEZE:${req.params.id}`,
    referenceType: 'task',
    referenceId: String(req.params.id),
    note: `任务《${task.title}》发布锁定 ${task.currency} ${needed}`,
  });

  // task_transactions 记录业务事件
  const lockTxnId = await insert('task_transactions', {
    task_id: req.params.id,
    type: 'TASK_LOCK',
    task_amount: needed,
    amount: needed,
    platform_fee: 0,
    from_user_id: task.creator_id,
    status: 'completed',
    note: `任务《${task.title}》发布锁定`,
    reference_type: 'wallet_entry',
    reference_id: lockEntryId,
  });

  await update('tasks', { lock_txn_id: lockTxnId }, 'id = ?', [req.params.id]);

  const updated = await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});

// /escrow 端点已废弃，资金锁定在 /publish 时自动完成

/** PATCH /api/tasks/:id/complete — 完成/关闭任务，退还未使用锁定资金 */
tasksRouter.patch('/:id/complete', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, title, currency, escrow_amount, is_escrowed, commission, max_heralds, lock_txn_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId) return res.status(403).json({ error: '无权限' });

  // 已结算金额：从 task_transactions 查（只算 TASK_RELEASE）
  const paid = await findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM task_transactions
     WHERE task_id = ? AND type = 'TASK_RELEASE' AND status = 'completed'`,
    [req.params.id]
  );
  const refundAmount = (task.escrow_amount || 0) - (Number(paid?.total) || 0);

  await update('tasks', { status: 'COMPLETED', completed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);

  if (refundAmount > 0) {
    // 品牌钱包：冻结→可用（退还未使用预算）
    const { entryId: refundEntryId } = await unfreezeTask({
      userId: task.creator_id,
      amount: refundAmount,
      currency: task.currency,
      idempotencyKey: `TASK_UNFREEZE:${req.params.id}`,
      referenceType: 'task',
      referenceId: String(req.params.id),
      note: `任务《${task.title}》关闭退还 ${task.currency} ${refundAmount.toFixed(0)}`,
    });

    await insert('task_transactions', {
      task_id: req.params.id,
      type: 'TASK_REFUND',
      task_amount: refundAmount,
      amount: refundAmount,
      platform_fee: 0,
      from_user_id: task.creator_id,
      parent_txn_id: task.lock_txn_id || null,
      status: 'completed',
      note: `任务《${task.title}》关闭退还 ¥${refundAmount.toFixed(0)}`,
      reference_type: 'wallet_entry',
      reference_id: refundEntryId,
    });
  }

  const updated = await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});
