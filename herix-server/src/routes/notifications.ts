import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { findMany, update, insert, genId } from '../utils/db';
import pool from '../db';
import { getTaskTranslations } from '../utils/taskLocalize';

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

/** 解析用户拥有的角色集合（JWT roles 可能是数组或 JSON 串） */
function userRoles(req: Request): string[] {
  let roles: any = req.user!.roles || [req.user!.role];
  if (typeof roles === 'string') {
    try { roles = JSON.parse(roles); } catch { roles = [req.user!.role]; }
  }
  return roles;
}

/** GET /api/notifications?role=HERALD|BRAND — 拉取当前用户站内信（最近50条）
 *
 *  隔离维度是「当前所在的端」而非「拥有的角色集合」：双角色账号(HERALD+BRAND)
 *  按角色集合过滤等于不过滤——商家端会看到赫使侧通知（2026-07-16 实测 bug）。
 *  端（miniapp/herix=HERALD, merchant=BRAND）通过 ?role= 声明；服务端校验声明
 *  必须是用户拥有的角色（不能读自己没有的角色的通知）。不传 role 时兜底旧行为。 */
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const roles = userRoles(req);
  const surfaceRole = req.query.role ? String(req.query.role) : null;
  if (surfaceRole && !roles.includes(surfaceRole)) {
    return res.status(403).json({ error: '无权读取该角色的通知', code: 'ROLE_NOT_OWNED' });
  }
  const roleFilter = surfaceRole ? [surfaceRole] : roles;
  const rows = await pool.query<any>(
    `SELECT id, type, title, body, is_read, target_role, metadata, created_at
     FROM notifications
     WHERE user_id = $1 AND (target_role IS NULL OR target_role = ANY($2::text[]))
     ORDER BY created_at DESC LIMIT 50`,
    [userId, roleFilter],
  );
  const unread = rows.rows.filter((r: any) => !r.is_read).length;
  // 历史通知 metadata.taskTitle 是按创建时源语言落库的，这里按用户语言就地覆盖（2026-08-05）
  const langRow = await pool.query<{ preferred_lang: string }>(
    `SELECT preferred_lang FROM users WHERE id = $1`, [userId]
  );
  const lang = (langRow.rows[0]?.preferred_lang as string) || 'zh';
  if (lang && lang !== 'zh') {
    const taskIds: string[] = [];
    const parsed: Array<{ meta: any; row: any }> = [];
    for (const row of rows.rows) {
      let meta: any = {};
      try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : row.metadata || {}; } catch { meta = {}; }
      if (meta.taskId) { taskIds.push(meta.taskId); parsed.push({ meta, row }); }
    }
    const tr = await getTaskTranslations(taskIds, lang);
    for (const { meta, row } of parsed) {
      const localized = tr.get(meta.taskId);
      if (localized?.title) {
        meta.taskTitle = localized.title;
        row.metadata = JSON.stringify(meta);
      }
    }
  }
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

/** PATCH /api/notifications/read-all?role= — 全部已读（按端隔离：
 *  商家端点"全部已读"不应清掉赫使侧的未读，反之亦然） */
notificationsRouter.patch('/read-all', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const roles = userRoles(req);
  const surfaceRole = req.query.role ? String(req.query.role) : null;
  if (surfaceRole && !roles.includes(surfaceRole)) {
    return res.status(403).json({ error: '无权操作该角色的通知', code: 'ROLE_NOT_OWNED' });
  }
  if (surfaceRole) {
    await pool.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND (target_role IS NULL OR target_role = $2)`,
      [userId, surfaceRole],
    );
  } else {
    await pool.query(`UPDATE notifications SET is_read = 1 WHERE user_id = $1`, [userId]);
  }
  res.json({ success: true });
});
