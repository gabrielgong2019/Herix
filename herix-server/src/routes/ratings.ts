import { Router, Request, Response } from 'express';
import { findOne, findMany, insert } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';

export const ratingsRouter = Router();

/** POST /api/ratings/:taskId — 赫使评价任务（审核通过后才能评） */
ratingsRouter.post('/:taskId', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  const { score, comment } = req.body;
  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ error: '评分需在1-5之间' });
  }

  // 检查赫使是否已完成该任务
  const sub = await findOne<{ id: string }>(
    "SELECT id FROM task_submissions WHERE task_id = ? AND herald_id = ? AND status = 'APPROVED'",
    [req.params.taskId, req.user!.userId]
  );
  if (!sub) {
    return res.status(403).json({ error: '只有完成任务的赫使可以评价' });
  }

  // 检查是否已经评过
  const existing = await findOne<{ id: string }>(
    'SELECT id FROM task_ratings WHERE task_id = ? AND herald_id = ?',
    [req.params.taskId, req.user!.userId]
  );
  if (existing) {
    return res.status(409).json({ error: '已经评价过该任务' });
  }

  const id = await insert('task_ratings', {
    task_id: req.params.taskId,
    herald_id: req.user!.userId,
    score,
    comment: comment || null,
  });

  const rating = await findOne('SELECT * FROM task_ratings WHERE id = ?', [id]);
  res.status(201).json(rating);
});

/** GET /api/ratings/:taskId — 查看任务的评价列表 */
ratingsRouter.get('/:taskId', async (req: Request, res: Response) => {
  const ratings = await findMany<any>(
    `SELECT tr.*, u.nickname as herald_name
     FROM task_ratings tr
     JOIN users u ON u.id = tr.herald_id
     WHERE tr.task_id = ?
     ORDER BY tr.created_at DESC`, [req.params.taskId]
  );
  res.json(ratings);
});
