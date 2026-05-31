import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import crypto from 'crypto';

export const referralsRouter = Router();

/** 生成唯一推广码 */
function genCode(taskId: string, heraldId: string): string {
  const hash = crypto.createHash('md5').update(taskId + heraldId + Date.now()).digest('hex').substring(0, 8);
  return 'HERIX-' + hash.toUpperCase();
}

/** POST /api/referrals/assign/:taskId — 赫使领取推广码任务（类型A专属） */
referralsRouter.post('/assign/:taskId', requireAuth, requireRole('HERALD'), (req: Request, res: Response) => {
  const task = findOne<{ id: string; mode: string }>(
    "SELECT id, mode FROM tasks WHERE id = ? AND mode = 'PERFORMANCE' AND status = 'OPEN'",
    [req.params.taskId]
  );
  if (!task) return res.status(404).json({ error: '任务不存在或不支持推广码模式' });

  // 检查居住地合规
  const profile = findOne<any>(
    'SELECT residence, kyc_status, declaration_status FROM herald_profiles WHERE user_id = ?',
    [req.user!.userId]
  );
  if (!profile?.residence) return res.status(403).json({ error: '请先设置居住地', code: 'RESIDENCE_REQUIRED' });
  if (profile.kyc_status !== 'approved') return res.status(403).json({ error: '请先完成 KYC', code: 'KYC_REQUIRED' });

  // 检查是否已领取
  const existing = findOne<{ id: string }>(
    'SELECT id FROM ambassador_tasks WHERE task_id = ? AND herald_id = ?',
    [req.params.taskId, req.user!.userId]
  );
  if (existing) {
    return res.status(409).json({ error: '已领取过该任务' });
  }

  // 检查名额
  const taskCount = findOne<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM ambassador_tasks WHERE task_id = ? AND status = 'active'",
    [req.params.taskId]
  );
  const taskInfo = findOne<{ max_heralds: number }>(
    'SELECT max_heralds FROM tasks WHERE id = ?', [req.params.taskId]
  );
  if (taskInfo && taskCount && taskCount.cnt >= taskInfo.max_heralds) {
    return res.status(403).json({ error: '名额已满' });
  }

  const code = genCode(req.params.taskId, req.user!.userId);
  const id = insert('ambassador_tasks', {
    task_id: req.params.taskId,
    herald_id: req.user!.userId,
    unique_code: code,
  });

  const result = findOne('SELECT * FROM ambassador_tasks WHERE id = ?', [id]);
  res.status(201).json(result);
});

/** GET /api/referrals/my-codes — 我的推广码列表 */
referralsRouter.get('/my-codes', requireAuth, requireRole('HERALD'), (req: Request, res: Response) => {
  const codes = findMany<any>(
    `SELECT at.id, at.task_id, at.unique_code, at.status, at.joined_at,
            t.title as task_title, t.commission, t.mode,
            (SELECT COUNT(*) FROM referrals r WHERE r.ambassador_task_id = at.id) as registered_count,
            (SELECT COUNT(*) FROM referrals r WHERE r.ambassador_task_id = at.id AND r.qualified = 1) as used_count,
            (SELECT COALESCE(SUM(CASE WHEN r.qualified = 1 THEN t.commission ELSE 0 END), 0) FROM referrals r WHERE r.ambassador_task_id = at.id) as earned_amount
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     WHERE at.herald_id = ?
     ORDER BY at.joined_at DESC`, [req.user!.userId]
  );
  res.json(codes);
});

/** POST /api/referrals/csv-import — 品牌方上传 CSV 转化数据 */
referralsRouter.post('/csv-import', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const { taskId, rows } = req.body;
  // rows: [{ code: "HERIX-XXXX", referred_token: "hash123", registered_at: "...", kyc_at: "...", transfer_at: "...", transfer_amount: 10000 }]

  if (!taskId || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: '参数错误：需要 taskId 和 rows 数组' });
  }

  const task = findOne<{ id: string; creator_id: string }>(
    'SELECT id, creator_id FROM tasks WHERE id = ?', [taskId]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权操作' });
  }

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    // 通过 code 找到大使任务
    const at = findOne<{ id: string }>(
      'SELECT id FROM ambassador_tasks WHERE unique_code = ? AND task_id = ?',
      [row.code, taskId]
    );
    if (!at) { skipped++; continue; }

    // 检查是否已导入
    const existing = findOne<{ id: string }>(
      'SELECT id FROM referrals WHERE ambassador_task_id = ? AND referred_token = ?',
      [at.id, row.referred_token]
    );
    if (existing) { skipped++; continue; }

    // 判断是否合格（有首次转账就算合格）
    const hasTransfer = !!row.transfer_at;
    insert('referrals', {
      ambassador_task_id: at.id,
      referred_token: row.referred_token,
      registered_at: row.registered_at || null,
      kyc_completed_at: row.kyc_at || null,
      first_transfer_at: row.transfer_at || null,
      first_transfer_amount: row.transfer_amount || null,
      qualified: hasTransfer ? 1 : 0,
    });
    imported++;
  }

  res.json({ imported, skipped, total: rows.length });
});

/** GET /api/referrals/stats/:taskId — 推广数据统计（品牌方） */
referralsRouter.get('/stats/:taskId', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const stats = findMany<any>(
    `SELECT at.unique_code, u.nickname as herald_name,
            (SELECT COUNT(*) FROM referrals r WHERE r.ambassador_task_id = at.id) as total_referred,
            (SELECT COUNT(*) FROM referrals r WHERE r.ambassador_task_id = at.id AND r.qualified = 1) as qualified_count
     FROM ambassador_tasks at
     JOIN users u ON u.id = at.herald_id
     WHERE at.task_id = ?
     ORDER BY qualified_count DESC`, [req.params.taskId]
  );
  res.json(stats);
});
