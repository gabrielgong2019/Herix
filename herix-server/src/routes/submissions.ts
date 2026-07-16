import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { SubmitResultSchema, ReviewSubmissionSchema } from '../types';
import { ZodError } from 'zod';
import { settleCreditTask, creditHerald, creditPlatformFee, PLATFORM_USER_ID, getBalance } from '../utils/wallet';
import { notify } from '../utils/notify';
import pool from '../db';

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
      return res.status(403).json({ error: '只有被批准的赫使可以提交结果', code: 'NOT_APPROVED_HERALD' });
    }

    // 检查是否已有不可重提交的记录（待审/已通过）
    const blocking = await findOne<{ id: string }>(
      "SELECT id FROM task_submissions WHERE task_id = ? AND herald_id = ? AND status IN ('PENDING_REVIEW','APPROVED')",
      [req.params.taskId, req.user!.userId]
    );
    if (blocking) return res.status(409).json({ error: '已经提交过结果', code: 'ALREADY_SUBMITTED' });

    // 若有被拒记录，复用该行（UPDATE）；否则新建
    const rejected = await findOne<{ id: string }>(
      "SELECT id FROM task_submissions WHERE task_id = ? AND herald_id = ? AND status = 'REJECTED'",
      [req.params.taskId, req.user!.userId]
    );

    let subId: string;
    if (rejected) {
      await update('task_submissions', {
        content_url: data.contentUrl,
        description: data.description || null,
        screenshot_urls: data.screenshotUrls ? JSON.stringify(data.screenshotUrls) : null,
        status: 'PENDING_REVIEW',
        review_note: null,
        reviewed_at: null,
        submitted_at: new Date().toISOString(),
      }, 'id = ?', [rejected.id]);
      subId = rejected.id;
    } else {
      subId = await insert('task_submissions', {
        task_id: req.params.taskId,
        herald_id: req.user!.userId,
        content_url: data.contentUrl,
        description: data.description || null,
        screenshot_urls: data.screenshotUrls ? JSON.stringify(data.screenshotUrls) : null,
      });
    }

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

    const task = await findOne<{ id: string; creator_id: string; payout_per_herald: number; cost_per_herald: number; commission_rate: number; title: string }>(
      'SELECT id, creator_id, payout_per_herald, cost_per_herald, commission_rate, title FROM tasks WHERE id = ?', [submission.task_id]
    );
    if (!task || (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN')) {
      return res.status(403).json({ error: '无权限' });
    }
    if (submission.status !== 'PENDING_REVIEW') {
      return res.status(400).json({ error: '该提交已审核' });
    }

    if (data.status === 'APPROVED') {
      // 使用发布时快照，与当前费率设置解耦
      const payout        = task.payout_per_herald;
      const costPerHerald = task.cost_per_herald;
      const commissionRate = task.commission_rate;
      const platformFee   = Math.round((costPerHerald - payout) * 100) / 100;

      // 1. 余额检查在任何写操作之前
      const brandBal = await getBalance(task.creator_id, 'brand');
      if (brandBal.available < costPerHerald) {
        const isBrand = req.user!.role === 'BRAND';
        await notify({
          userId: task.creator_id,
          targetRole: 'BRAND',
          type: 'SETTLEMENT_BLOCKED',
          title: '任务待结算 — 请充值完成打款',
          body: `任务《${task.title}》已完成，需支付 ¥${costPerHerald}（赫使到手 ¥${payout} + 平台服务费 ¥${platformFee}），当前余额 ¥${brandBal.available} 不足。`,
          metadata: { taskId: task.id, needed: costPerHerald, available: brandBal.available },
        }).catch((e) => console.error('[notify] SETTLEMENT_BLOCKED failed:', e));
        return res.status(402).json({
          error: isBrand
            ? `余额不足，需 ¥${costPerHerald}，当前可用 ¥${brandBal.available}，请充值后再审核`
            : `品牌余额不足，需 ¥${costPerHerald}，当前可用 ¥${brandBal.available}，请联系代理公司完成充值`,
          code: 'INSUFFICIENT_BALANCE',
          needed: costPerHerald,
          available: brandBal.available,
        });
      }

      // 2. 原子 UPDATE：CAS（Compare-And-Swap）防止并发双重审批
      //    只有 status 仍为 PENDING_REVIEW 时才更新，否则说明另一个请求已抢先
      const claimResult = await pool.query(
        `UPDATE task_submissions
         SET status = 'APPROVED', commission_amount = $1, review_note = $2, reviewed_at = $3
         WHERE id = $4 AND status = 'PENDING_REVIEW'`,
        [payout, data.reviewNote || null, new Date().toISOString(), req.params.id]
      );
      if (claimResult.rowCount === 0) {
        return res.status(400).json({ error: '该提交已审核' });
      }

      // task_transactions 记录业务事件
      const releaseTxnId = await insert('task_transactions', {
        task_id:           submission.task_id,
        type:              'TASK_RELEASE',
        task_amount:       costPerHerald,
        amount:            payout,
        platform_fee:      platformFee,
        platform_fee_rate: commissionRate,
        from_user_id:      task.creator_id,
        to_user_id:        submission.herald_id,
        status:            'completed',
        note:              `任务《${task.title}》报酬发放`,
      });

      // 直接扣可用余额结算（无预冻结）
      await Promise.all([
        settleCreditTask({
          userId: task.creator_id, amount: costPerHerald,
          idempotencyKey: `SETTLE:${releaseTxnId}`,
          referenceType: 'task_transaction', referenceId: releaseTxnId,
          note: `任务《${task.title}》结算`,
        }),
        creditHerald({
          userId: submission.herald_id, amount: payout,
          idempotencyKey: `CREDIT:${releaseTxnId}`,
          referenceType: 'task_transaction', referenceId: releaseTxnId,
          note: `任务《${task.title}》报酬`,
        }),
        creditPlatformFee({
          userId: PLATFORM_USER_ID, amount: platformFee,
          idempotencyKey: `FEE:${releaseTxnId}`,
          referenceType: 'task_transaction', referenceId: releaseTxnId,
          note: `平台服务费 ${(commissionRate * 100).toFixed(0)}%`,
        }),
      ]);
    } else {
      await update('task_submissions', {
        status: 'REJECTED',
        review_note: data.reviewNote || null,
        reviewed_at: new Date().toISOString(),
      }, 'id = ?', [req.params.id]);
    }

    // 通知赫使审核结果
    const heraldUser = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [submission.herald_id]);
    if (heraldUser) {
      const approved = data.status === 'APPROVED';
      const noteClause = data.reviewNote ? `\n备注：${data.reviewNote}` : '';
      await notify({
        userId: submission.herald_id,
        email: heraldUser.email,
        targetRole: 'HERALD',
        type: approved ? 'SUB_APPROVED' : 'SUB_REJECTED',
        title: `内容审核${approved ? '通过' : '未通过'}：${task.title}`,
        body: approved
          ? `${heraldUser.nickname}，您提交的任务「${task.title}」内容已审核通过，报酬将自动结算至您的钱包。${noteClause}`
          : `${heraldUser.nickname}，您提交的任务「${task.title}」内容审核未通过，请查看反馈后重新提交。${noteClause}`,
        // taskTitle/note 进 metadata：前端按 type+params 渲染三语通知
        metadata: { taskId: submission.task_id, submissionId: submission.id, taskTitle: task.title, note: data.reviewNote || null },
      }).catch((e) => console.error('[notify] SUB review notification failed:', e));
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
    `SELECT ts.*, t.title as task_title, t.payout_per_herald
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     WHERE ts.herald_id = ?
     ORDER BY ts.submitted_at DESC`, [req.user!.userId]
  );
  res.json(subs);
});
