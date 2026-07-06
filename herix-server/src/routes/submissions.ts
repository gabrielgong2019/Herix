import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { SubmitResultSchema, ReviewSubmissionSchema } from '../types';
import { ZodError } from 'zod';
import { settleTask, creditHerald, creditPlatformFee, PLATFORM_USER_ID } from '../utils/wallet';

export const submissionsRouter = Router();

/** POST /api/submissions/:taskId — 赫使提交结果 */
submissionsRouter.post('/:taskId', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  try {
    const data = SubmitResultSchema.parse(req.body);

    // 检查报名是否被批准
    const app = await findOne<{ status: string }>(
      'SELECT status FROM task_applications WHERE task_id = ? AND herald_id = ?',
      [req.params.taskId, req.user!.userId]
    );
    if (!app || app.status !== 'APPROVED') {
      return res.status(403).json({ error: '只有被批准的赫使可以提交结果' });
    }

    // 检查是否已经提交过
    const existing = await findOne<{ id: string }>(
      'SELECT id FROM task_submissions WHERE task_id = ? AND herald_id = ?',
      [req.params.taskId, req.user!.userId]
    );
    if (existing) return res.status(409).json({ error: '已经提交过结果' });

    const subId = await insert('task_submissions', {
      task_id: req.params.taskId,
      herald_id: req.user!.userId,
      content_url: data.contentUrl,
      description: data.description || null,
      screenshot_urls: data.screenshotUrls ? JSON.stringify(data.screenshotUrls) : null,
    });

    const submission = await findOne<any>(
      `SELECT ts.*, t.title as task_title, u.nickname as herald_name
       FROM task_submissions ts
       JOIN tasks t ON t.id = ts.task_id
       JOIN users u ON u.id = ts.herald_id
       WHERE ts.id = ?`, [subId]
    );

    res.status(201).json(submission);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error('Submit error:', err);
    res.status(500).json({ error: '提交失败' });
  }
});

/** PATCH /api/submissions/:id/review — 品牌商家审核结果 */
submissionsRouter.patch('/:id/review', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const data = ReviewSubmissionSchema.parse(req.body);

    const submission = await findOne<{ id: string; status: string; task_id: string; herald_id: string }>(
      'SELECT id, status, task_id, herald_id FROM task_submissions WHERE id = ?', [req.params.id]
    );
    if (!submission) return res.status(404).json({ error: '提交不存在' });

    const task = await findOne<{ creator_id: string; commission: number; currency: string; title: string; lock_txn_id: string }>(
      'SELECT creator_id, commission, currency, title, lock_txn_id FROM tasks WHERE id = ?', [submission.task_id]
    );
    if (!task || (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN')) {
      return res.status(403).json({ error: '无权限' });
    }
    if (submission.status !== 'PENDING_REVIEW') {
      return res.status(400).json({ error: '该提交已审核' });
    }

    if (data.status === 'APPROVED') {
      const commission = task.commission;
      const platformFee = Math.round(commission * 0.15 * 100) / 100; // 15% 平台抽成
      const payout = commission - platformFee;

      await update('task_submissions', {
        status: 'APPROVED',
        commission_amount: task.commission,  // 快照：历史可独立查询，不依赖 tasks 表
        review_note: data.reviewNote || null,
        reviewed_at: new Date().toISOString(),
      }, 'id = ?', [req.params.id]);

      // task_transactions 记录业务事件
      const releaseTxnId = await insert('task_transactions', {
        task_id:       submission.task_id,
        type:          'TASK_RELEASE',
        task_amount:   commission,
        amount:        payout,
        platform_fee:  platformFee,
        from_user_id:  task.creator_id,
        to_user_id:    submission.herald_id,
        parent_txn_id: task.lock_txn_id || null,
        status:        'completed',
        note:          `任务《${task.title}》报酬发放`,
      });

      // 三方钱包分录（原子各自独立，幂等 key 保证不重复）
      await Promise.all([
        settleTask({
          userId: task.creator_id, amount: commission, currency: task.currency,
          idempotencyKey: `SETTLE:${releaseTxnId}`,
          referenceType: 'task_transaction', referenceId: releaseTxnId,
          note: `任务《${task.title}》结算`,
        }),
        creditHerald({
          userId: submission.herald_id, amount: payout, currency: task.currency,
          idempotencyKey: `CREDIT:${releaseTxnId}`,
          referenceType: 'task_transaction', referenceId: releaseTxnId,
          note: `任务《${task.title}》报酬`,
        }),
        creditPlatformFee({
          userId: PLATFORM_USER_ID, amount: platformFee, currency: task.currency,
          idempotencyKey: `FEE:${releaseTxnId}`,
          referenceType: 'task_transaction', referenceId: releaseTxnId,
          note: `平台服务费 15%`,
        }),
      ]);
    } else {
      await update('task_submissions', {
        status: 'REJECTED',
        review_note: data.reviewNote || null,
        reviewed_at: new Date().toISOString(),
      }, 'id = ?', [req.params.id]);
    }

    const updated = await findOne('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
    res.json({ ...updated, needsRating: data.status === 'APPROVED' });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error('Review error:', err);
    res.status(500).json({ error: '审核失败' });
  }
});

/** POST /api/submissions/:id/rate — 品牌对已通过提交评分 */
submissionsRouter.post('/:id/rate', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ error: '评分须为 1-5 分' });
    }

    const submission = await findOne<any>(
      `SELECT ts.id, ts.task_id, ts.herald_id, ts.status, t.creator_id
       FROM task_submissions ts JOIN tasks t ON t.id = ts.task_id
       WHERE ts.id = ?`, [req.params.id]
    );
    if (!submission) return res.status(404).json({ error: '提交不存在' });
    if (submission.status !== 'APPROVED') return res.status(400).json({ error: '只能对已通过的提交评分' });
    if (submission.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: '无权限' });
    }

    const existing = await findOne(
      'SELECT id FROM task_ratings WHERE task_id = ? AND herald_id = ?',
      [submission.task_id, submission.herald_id]
    );
    if (existing) return res.status(409).json({ error: '已评分' });

    await insert('task_ratings', {
      task_id: submission.task_id,
      herald_id: submission.herald_id,
      score: Number(score),
      comment: comment || null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Rate error:', err);
    res.status(500).json({ error: '评分失败' });
  }
});

/** GET /api/submissions/task/:taskId — 任务的提交列表 (品牌商家) */
submissionsRouter.get('/task/:taskId', requireAuth, async (req: Request, res: Response) => {
  const subs = await findMany<any>(
    `SELECT ts.*, u.nickname, hp.display_name, hp.country, hp.social_platforms
     FROM task_submissions ts
     JOIN users u ON u.id = ts.herald_id
     LEFT JOIN herald_profiles hp ON hp.user_id = ts.herald_id
     WHERE ts.task_id = ?
     ORDER BY ts.submitted_at DESC`, [req.params.taskId]
  );
  res.json(subs);
});

/** GET /api/submissions/my — 我的提交 (赫使侧) */
submissionsRouter.get('/my', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  const subs = await findMany<any>(
    `SELECT ts.*, t.title as task_title, t.commission
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     WHERE ts.herald_id = ?
     ORDER BY ts.submitted_at DESC`, [req.user!.userId]
  );
  res.json(subs);
});
