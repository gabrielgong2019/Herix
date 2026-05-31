import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { ApplyTaskSchema } from '../types';
import { ZodError } from 'zod';
import { sendMail } from '../utils/mailer';
import crypto from 'crypto';

function genPromoCode(): string {
  return 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

export const applicationRouter = Router();

/** POST /api/applications/:taskId — 赫使报名任务 */
applicationRouter.post('/:taskId', requireAuth, requireRole('HERALD'), (req: Request, res: Response) => {
  try {
    const data = ApplyTaskSchema.parse(req.body);

    const task = findOne<{ id: string; status: string; max_heralds: number }>(
      'SELECT id, status, max_heralds FROM tasks WHERE id = ?', [req.params.taskId]
    );
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status !== 'OPEN') return res.status(400).json({ error: '任务不在招募中' });

    // 居住地合规检查
    const profile = findOne<any>(
      'SELECT residence, kyc_status, declaration_status FROM herald_profiles WHERE user_id = ?',
      [req.user!.userId]
    );

    if (profile) {
      if (!profile.residence) {
        return res.status(403).json({ error: '请先设置居住地后再报名', code: 'RESIDENCE_REQUIRED' });
      }
      if (profile.kyc_status !== 'approved') {
        return res.status(403).json({ error: '请先完成身份核验后再报名', code: 'KYC_REQUIRED' });
      }
      if (profile.residence === 'japan' && profile.declaration_status !== 'approved' && profile.declaration_status !== 'exempt') {
        return res.status(403).json({ error: '请先提交在留资格声明', code: 'DECLARATION_REQUIRED' });
      }
    }

    // 防止自我交易：不能报名自己发布的任务（调试阶段关闭）
    // const taskOwner = findOne<{ creator_id: string }>('SELECT creator_id FROM tasks WHERE id = ?', [req.params.taskId]);
    // if (taskOwner?.creator_id === req.user!.userId) {
    //   return res.status(403).json({ error: '不能报名自己发布的任务' });
    // }

    // 检查是否已报名
    const existing = findOne<{ id: string }>(
      'SELECT id FROM task_applications WHERE task_id = ? AND herald_id = ?',
      [req.params.taskId, req.user!.userId]
    );
    if (existing) return res.status(409).json({ error: '已经报名过该任务' });

    const appId = insert('task_applications', {
      task_id: req.params.taskId,
      herald_id: req.user!.userId,
      message: data.message || null,
    });

    const app = findOne<any>(
      `SELECT ta.*, t.title as task_title, u.nickname as herald_name
       FROM task_applications ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN users u ON u.id = ta.herald_id
       WHERE ta.id = ?`, [appId]
    );

    res.status(201).json(app);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error('Apply error:', err);
    res.status(500).json({ error: '报名失败' });
  }
});

/** PATCH /api/applications/:id/review — 品牌商家审核报名 */
applicationRouter.patch('/:id/review', requireAuth, requireRole('BRAND', 'ADMIN'), (req: Request, res: Response) => {
  const { status } = req.body as { status: 'APPROVED' | 'REJECTED' };

  const app = findOne<{ id: string; status: string; task_id: string }>(
    'SELECT ta.id, ta.status, ta.task_id, ta.herald_id FROM task_applications ta WHERE ta.id = ?', [req.params.id]
  );
  if (!app) return res.status(404).json({ error: '报名不存在' });

  const task = findOne<{ creator_id: string }>('SELECT creator_id FROM tasks WHERE id = ?', [app.task_id]);
  if (!task || (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN')) {
    return res.status(403).json({ error: '只有任务创建者可审核' });
  }
  if (app.status !== 'PENDING') {
    return res.status(400).json({ error: '该报名已审核' });
  }

  update('task_applications', { status, updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);

  // 如果报名通过 → 检查名额是否已满，满了自动关任务
  if (status === 'APPROVED') {
    const taskInfo = findOne<{ max_heralds: number }>('SELECT max_heralds FROM tasks WHERE id = ?', [app.task_id]);
    if (taskInfo) {
      const approvedCount = findOne<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM task_applications WHERE task_id = ? AND status = 'APPROVED'",
        [app.task_id]
      );
      if (approvedCount && approvedCount.cnt >= taskInfo.max_heralds) {
        update('tasks', { status: 'COMPLETED', completed_at: new Date().toISOString() }, 'id = ?', [app.task_id]);
      }
    }
  }

  // PERFORMANCE 任务审核通过时：从码池取一个可用码分配
  if (status === 'APPROVED') {
    const taskMode = findOne<any>('SELECT mode FROM tasks WHERE id = ?', [app.task_id]);
    if (taskMode?.mode === 'PERFORMANCE') {
      const alreadyAssigned = findOne<any>(
        'SELECT id FROM ambassador_tasks WHERE task_id = ? AND herald_id = ?',
        [app.task_id, app.herald_id]
      );
      if (!alreadyAssigned) {
        const availCode = findOne<any>(
          "SELECT id, code FROM task_promo_codes WHERE task_id = ? AND herald_id IS NULL LIMIT 1",
          [app.task_id]
        );
        if (availCode) {
          const now = new Date().toISOString();
          update('task_promo_codes',
            { herald_id: app.herald_id, assigned_at: now },
            'id = ?', [availCode.id]
          );
          insert('ambassador_tasks', {
            task_id: app.task_id,
            herald_id: app.herald_id,
            unique_code: availCode.code,
            status: 'active',
          });
        } else {
          console.warn(`[WARN] 任务 ${app.task_id} 码池已耗尽，无法分配给赫使 ${app.herald_id}`);
        }
      }
    }
  }

  // 通知赫使
  const notifyHerald = findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [app.herald_id]);
  const notifyTask = findOne<any>('SELECT title FROM tasks WHERE id = ?', [app.task_id]);
  if (notifyHerald?.email && notifyTask) {
    const mailMsg = status === 'APPROVED'
      ? `${notifyHerald.nickname}，您报名的任务「${notifyTask.title}」已通过审核！请前往 Herix 平台查看任务详情并开始执行。`
      : `${notifyHerald.nickname}，很遗憾，您报名的任务「${notifyTask.title}」未通过本次审核。欢迎继续报名其他任务。`;
    sendMail(notifyHerald.email, `【Herix】报名${status === 'APPROVED' ? '通过' : '未通过'}`, mailMsg).catch(() => {});
  }
  const updated = findOne('SELECT * FROM task_applications WHERE id = ?', [req.params.id]);
  res.json(updated);
});

/** GET /api/applications/my — 我的报名 (赫使侧) */
applicationRouter.get('/my', requireAuth, requireRole('HERALD'), (req: Request, res: Response) => {
  const apps = findMany<any>(
    `SELECT ta.*, t.title as task_title, t.status as task_status, t.commission, t.mode
     FROM task_applications ta
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.herald_id = ?
     ORDER BY ta.created_at DESC`, [req.user!.userId]
  );
  res.json(apps);
});
