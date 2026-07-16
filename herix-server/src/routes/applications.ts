import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { ApplyTaskSchema } from '../types';
import { ZodError } from 'zod';
import { notify } from '../utils/notify';
import { getBrandCreditInfo } from '../utils/settings';
import crypto from 'crypto';

function genPromoCode(): string {
  return 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

export const applicationRouter = Router();

/** POST /api/applications/:taskId — 赫使报名任务 */
applicationRouter.post('/:taskId', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  try {
    const data = ApplyTaskSchema.parse(req.body);

    const task = await findOne<{ id: string; status: string; max_heralds: number; platform_requirements: string | null; req_mode: string | null; req_min_count: number | null }>(
      'SELECT id, status, max_heralds, platform_requirements, req_mode, req_min_count FROM tasks WHERE id = ?', [req.params.taskId]
    );
    if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
    if (task.status !== 'OPEN') return res.status(400).json({ error: '任务不在招募中', code: 'TASK_NOT_RECRUITING' });

    // 获取赫使档案（用于平台账号校验，居住地/KYC 在结算时才要求）
    const profile = await findOne<any>(
      'SELECT social_platforms FROM herald_profiles WHERE user_id = ?',
      [req.user!.userId]
    );

    // 平台账号要求验证 — 一次性收集所有问题
    // 模式（与前端 utils/requirements.ts 语义保持一致，改动须两边同步）：
    //   ALL(默认)：required=true 的项全部必须满足，required=false 仅展示
    //   ANY_N：列出的所有项都算候选，满足其中 ≥ req_min_count 项即可（忽略单项 required 标志）
    if (task.platform_requirements) {
      let reqs: Array<{ platformId: string; minFollowers?: number | null; required: boolean }> = [];
      try { reqs = JSON.parse(task.platform_requirements); } catch { /* ignore */ }

      const anyN = task.req_mode === 'ANY_N';
      const candidates = anyN ? reqs : reqs.filter(r => r.required);
      if (candidates.length > 0) {
        let heraldPlatforms: Array<{ platformId: string; followers?: number | null }> = [];
        try { heraldPlatforms = profile?.social_platforms ? JSON.parse(profile.social_platforms) : []; } catch { /* ignore */ }

        const failures: Array<{ platformId: string; type: 'MISSING' | 'INSUFFICIENT'; required?: number; current?: number }> = [];

        for (const req_ of candidates) {
          const match = heraldPlatforms.find((p: any) => p.platformId === req_.platformId);
          if (!match) {
            failures.push({ platformId: req_.platformId, type: 'MISSING' });
          } else if (req_.minFollowers && (match.followers || 0) < req_.minFollowers) {
            failures.push({ platformId: req_.platformId, type: 'INSUFFICIENT', required: req_.minFollowers, current: match.followers || 0 });
          }
        }

        const needCount = anyN ? Math.min(Math.max(1, Number(task.req_min_count) || 1), candidates.length) : candidates.length;
        const satisfiedCount = candidates.length - failures.length;
        const passed = anyN ? satisfiedCount >= needCount : failures.length === 0;

        if (!passed) {
          const hasInsufficient = failures.some(f => f.type === 'INSUFFICIENT');
          return res.status(403).json({
            error: anyN ? `需满足任意 ${needCount} 项账号要求（当前满足 ${satisfiedCount} 项）` : '不满足任务的社交账号要求',
            code: 'REQUIREMENTS_NOT_MET',
            canRetry: !hasInsufficient,
            failures,
            reqMode: anyN ? 'ANY_N' : 'ALL',
            needCount,
            satisfiedCount,
          });
        }
      }
    }

    // 防止自我交易：不能报名自己发布的任务（调试阶段关闭）
    // const taskOwner = await findOne<{ creator_id: string }>('SELECT creator_id FROM tasks WHERE id = ?', [req.params.taskId]);
    // if (taskOwner?.creator_id === req.user!.userId) {
    //   return res.status(403).json({ error: '不能报名自己发布的任务', code: 'CANNOT_APPLY_OWN_TASK' });
    // }

    // 检查是否已报名
    const existing = await findOne<{ id: string }>(
      'SELECT id FROM task_applications WHERE task_id = ? AND herald_id = ?',
      [req.params.taskId, req.user!.userId]
    );
    if (existing) return res.status(409).json({ error: '已经报名过该任务', code: 'ALREADY_APPLIED' });

    const appId = await insert('task_applications', {
      task_id: req.params.taskId,
      herald_id: req.user!.userId,
      message: data.message || null,
    });

    const app = await findOne<any>(
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
applicationRouter.patch('/:id/review', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
  // 运行时校验 status，防止任意字符串写入状态机
  const { reviewNote } = req.body as { reviewNote?: string };
  const status = req.body.status as string;
  if (status !== 'APPROVED' && status !== 'REJECTED') {
    return res.status(400).json({ error: '无效的审核状态' });
  }

  const app = await findOne<{ id: string; status: string; task_id: string; herald_id: string }>(
    'SELECT ta.id, ta.status, ta.task_id, ta.herald_id FROM task_applications ta WHERE ta.id = ?', [req.params.id]
  );
  if (!app) return res.status(404).json({ error: '报名不存在' });

  const task = await findOne<{ creator_id: string }>('SELECT creator_id FROM tasks WHERE id = ?', [app.task_id]);
  if (!task || (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN')) {
    return res.status(403).json({ error: '只有任务创建者可审核' });
  }
  if (app.status !== 'PENDING') {
    return res.status(400).json({ error: '该报名已审核' });
  }

  // 报名审核通过前检查信用额度（STANDARD 任务）
  if (status === 'APPROVED') {
    const taskCredit = await findOne<{ mode: string; cost_per_herald: number; creator_id: string }>(
      'SELECT mode, cost_per_herald, creator_id FROM tasks WHERE id = ?', [app.task_id]
    );
    if (taskCredit && taskCredit.mode === 'STANDARD' && (taskCredit.cost_per_herald || 0) > 0) {
      const creditInfo = await getBrandCreditInfo(taskCredit.creator_id);
      if (creditInfo.totalCapacity < taskCredit.cost_per_herald) {
        return res.status(402).json({
          error: '信用额度不足，请充值以保证赫使及时付款',
          code: 'INSUFFICIENT_CREDIT',
          needed: taskCredit.cost_per_herald,
          available: creditInfo.totalCapacity,
        });
      }
    }
  }

  await update('task_applications', { status, review_note: reviewNote || null, updated_at: new Date().toISOString() }, 'id = ?', [req.params.id]);

  // 如果报名通过 → 检查名额是否已满，满了自动关任务
  if (status === 'APPROVED') {
    const taskInfo = await findOne<{ max_heralds: number }>('SELECT max_heralds FROM tasks WHERE id = ?', [app.task_id]);
    if (taskInfo) {
      const approvedCount = await findOne<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM task_applications WHERE task_id = ? AND status = 'APPROVED'",
        [app.task_id]
      );
      if (approvedCount && approvedCount.cnt >= taskInfo.max_heralds) {
        await update('tasks', { status: 'COMPLETED', completed_at: new Date().toISOString() }, 'id = ?', [app.task_id]);
      }
    }
  }

  // PERFORMANCE 任务审核通过时：从码池取一个可用码分配
  if (status === 'APPROVED') {
    const taskMode = await findOne<any>('SELECT mode FROM tasks WHERE id = ?', [app.task_id]);
    if (taskMode?.mode === 'PERFORMANCE') {
      const alreadyAssigned = await findOne<any>(
        'SELECT id FROM ambassador_tasks WHERE task_id = ? AND herald_id = ?',
        [app.task_id, app.herald_id]
      );
      if (!alreadyAssigned) {
        const availCode = await findOne<any>(
          "SELECT id, code FROM task_promo_codes WHERE task_id = ? AND herald_id IS NULL LIMIT 1",
          [app.task_id]
        );
        if (availCode) {
          const now = new Date().toISOString();
          await update('task_promo_codes',
            { herald_id: app.herald_id, assigned_at: now },
            'id = ?', [availCode.id]
          );
          await insert('ambassador_tasks', {
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
  const notifyHerald = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [app.herald_id]);
  const notifyTask = await findOne<any>('SELECT title FROM tasks WHERE id = ?', [app.task_id]);
  if (notifyHerald && notifyTask) {
    const approved = status === 'APPROVED';
    const noteClause = reviewNote ? `\n备注：${reviewNote}` : '';
    await notify({
      userId: app.herald_id,
      email: notifyHerald.email,
      targetRole: 'HERALD',
      type: approved ? 'APP_APPROVED' : 'APP_REJECTED',
      title: `报名${approved ? '通过' : '未通过'}：${notifyTask.title}`,
      body: approved
        ? `${notifyHerald.nickname}，您报名的任务「${notifyTask.title}」已通过审核，请前往平台查看任务详情并开始执行。${noteClause}`
        : `${notifyHerald.nickname}，很遗憾，您报名的任务「${notifyTask.title}」未通过本次审核。欢迎继续报名其他任务。${noteClause}`,
      // taskTitle/note 进 metadata：前端按 type+params 渲染三语通知，title/body 留作旧客户端兜底
      metadata: { taskId: app.task_id, applicationId: app.id, taskTitle: notifyTask.title, note: reviewNote || null },
    }).catch((e) => console.error('[notify] APP review notification failed:', e));
  }
  const updated = await findOne('SELECT * FROM task_applications WHERE id = ?', [req.params.id]);
  res.json(updated);
  } catch (err) {
    console.error('App review error:', err);
    res.status(500).json({ error: '审核失败' });
  }
});

/** GET /api/applications/my — 我的报名 (赫使侧) */
applicationRouter.get('/my', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  const apps = await findMany<any>(
    `SELECT ta.*, t.title as task_title, t.status as task_status, t.commission, t.mode
     FROM task_applications ta
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.herald_id = ?
     ORDER BY ta.created_at DESC`, [req.user!.userId]
  );
  res.json(apps);
});
