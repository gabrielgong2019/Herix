import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { findMany, update, insert, genId } from '../utils/db';
import pool from '../db';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** 创建站内信（内部调用，不对外暴露） */
export async function createNotification(opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
  targetRole?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await insert('notifications', {
    id: genId(),
    user_id: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    is_read: 0,
    target_role: opts.targetRole ?? null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    created_at: new Date().toISOString(),
  });
}

/** GET /api/notifications — 拉取当前用户站内信（最近50条，按角色过滤） */
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  let roles: string[] = req.user!.roles || [req.user!.role];
  if (typeof (roles as any) === 'string') {
    try { roles = JSON.parse(roles as any); } catch { roles = [req.user!.role]; }
  }
  const rows = await pool.query<any>(
    `SELECT id, type, title, body, is_read, target_role, metadata, created_at
     FROM notifications
     WHERE user_id = $1 AND (target_role IS NULL OR target_role = ANY($2::text[]))
     ORDER BY created_at DESC LIMIT 50`,
    [userId, roles],
  );
  const unread = rows.rows.filter((r: any) => !r.is_read).length;
  res.json({ unread, notifications: rows.rows });
});

/** PATCH /api/notifications/:id/read — 标为已读 */
notificationsRouter.patch('/:id/read', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await pool.query(
    `UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  res.json({ success: true });
});

/** PATCH /api/notifications/read-all — 全部已读 */
notificationsRouter.patch('/read-all', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await pool.query(
    `UPDATE notifications SET is_read = 1 WHERE user_id = $1`,
    [userId],
  );
  res.json({ success: true });
});
