import { Router, Request, Response } from 'express';
import { findMany } from '../utils/db';

export const ratingsRouter = Router();

/** GET /api/ratings/:taskId — 查看任务的评价列表 */
ratingsRouter.get('/:taskId', async (req: Request, res: Response) => {
  const ratings = await findMany<any>(
    `SELECT tr.*, u.nickname as herald_name, b.nickname as brand_name
     FROM task_ratings tr
     JOIN users u ON u.id = tr.herald_id
     LEFT JOIN users b ON b.id = tr.brand_id
     WHERE tr.task_id = ?
     ORDER BY tr.created_at DESC`, [req.params.taskId]
  );
  res.json(ratings);
});
