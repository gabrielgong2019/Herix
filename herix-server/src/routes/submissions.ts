import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { SubmitResultSchema, ReviewSubmissionSchema } from '../types';
import { ZodError } from 'zod';
import { settleCreditTask, creditHerald, creditPlatformFee, PLATFORM_USER_ID, getBalance } from '../utils/wallet';
import { notify } from '../utils/notify';
import pool from '../db';
import { decideSubmit, canReject } from '../utils/submissionFlow';

export const submissionsRouter = Router();

/** 审计留痕：每次提交/审核动作各一行（append-only，改稿计数与仲裁证据链均从此表派生） */
async function auditRevision(row: {
  submissionId: string; taskId: string; heraldId: string; stage: string;
  kind: 'SUBMIT' | 'REVIEW'; action: string;
  contentUrls?: string[] | null; description?: string | null; screenshotUrls?: string[] | null;
  note?: string | null; actorId?: string | null;
}) {
  await insert('submission_revisions', {
    submission_id: row.submissionId, task_id: row.taskId, herald_id: row.heraldId,
    stage: row.stage, kind: row.kind, action: row.action,
    content_urls: row.contentUrls?.length ? JSON.stringify(row.contentUrls) : null,
    description: row.description || null,
    screenshot_urls: row.screenshotUrls?.length ? JSON.stringify(row.screenshotUrls) : null,
    note: row.note || null, actor_id: row.actorId || null,
  });
}

/** 按阶段统计既往拒绝次数（派生值，无计数列） */
async function countRejects(taskId: string, heraldId: string): Promise<{ draft: number; final: number }> {
  const r = await pool.query(
    `SELECT stage, COUNT(*)::int AS n FROM submission_revisions
     WHERE task_id = $1 AND herald_id = $2 AND kind = 'REVIEW' AND action = 'REJECTED'
     GROUP BY stage`,
    [taskId, heraldId]
  );
  const out = { draft: 0, final: 0 };
  for (const row of r.rows) {
    if (row.stage === 'DRAFT') out.draft = row.n;
    if (row.stage === 'FINAL') out.final = row.n;
  }
  return out;
}

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

    // 归一化链接：contentUrls 为权威，旧客户端的单链接 contentUrl 自动包装
    const urls = data.contentUrls?.length ? data.contentUrls : (data.contentUrl ? [data.contentUrl] : []);

    // 任务内容规格（两阶段配置 + 提交闸机参数）
    const spec = await findOne<{ min_images: number | null; require_draft_review: number }>(
      'SELECT min_images, require_draft_review FROM task_content_specs WHERE task_id = ?',
      [req.params.taskId]
    );
    const requireDraft = !!(spec?.require_draft_review);

    // 当前行（组合态） → 判定本次提交属于哪个阶段（规则收口在 submissionFlow）
    const row = await findOne<{ id: string; stage: 'DRAFT' | 'FINAL'; status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' }>(
      'SELECT id, stage, status FROM task_submissions WHERE task_id = ? AND herald_id = ?',
      [req.params.taskId, req.user!.userId]
    );
    const decision = decideSubmit(requireDraft, row || null);
    if (!decision.ok) {
      return res.status(decision.httpStatus).json({ error: decision.error, code: decision.code });
    }

    // 阶段校验：终稿必须带链接；草稿至少有点内容（脚本文字/成品图/预览链接任一）
    if (decision.stage === 'FINAL' && urls.length === 0) {
      return res.status(400).json({ error: '请提供至少一个内容链接', code: 'LINK_REQUIRED' });
    }
    if (decision.stage === 'DRAFT' && !data.description?.trim() && !data.screenshotUrls?.length && urls.length === 0) {
      return res.status(400).json({ error: '草稿不能为空：请提供脚本文字、成品图或预览链接', code: 'DRAFT_EMPTY' });
    }

    // 提交闸机（2026-07-25）：图片张数机器校验，两阶段都适用（草稿即体现成品图数量）。
    // 视频时长无法校验（内容是外链，拿不到元数据），仅作要求展示
    if (spec?.min_images) {
      const got = data.screenshotUrls?.length || 0;
      if (got < spec.min_images) {
        return res.status(400).json({
          error: `该任务要求至少 ${spec.min_images} 张图片/截图（当前 ${got} 张）`,
          code: 'MIN_IMAGES_NOT_MET',
          required: spec.min_images,
          got,
        });
      }
    }

    // 单行 = 该赫使交付的当前状态（历史版本进 submission_revisions，不丢）
    const writeData = {
      stage: decision.stage,
      content_url: urls[0] || null,           // 旧版 weapp 兼容镜像（=首链接），随客户端更新退役
      content_urls: urls.length ? JSON.stringify(urls) : null,
      description: data.description || null,
      screenshot_urls: data.screenshotUrls ? JSON.stringify(data.screenshotUrls) : null,
      status: 'PENDING_REVIEW',
      review_note: null,
      reviewed_at: null,
      submitted_at: new Date().toISOString(),
    };
    let subId: string;
    if (row) {
      await update('task_submissions', writeData, 'id = ?', [row.id]);
      subId = row.id;
    } else {
      subId = await insert('task_submissions', {
        task_id: req.params.taskId,
        herald_id: req.user!.userId,
        ...writeData,
      });
    }

    await auditRevision({
      submissionId: subId, taskId: String(req.params.taskId), heraldId: req.user!.userId,
      stage: decision.stage, kind: 'SUBMIT',
      action: decision.isResubmit ? 'RESUBMIT' : decision.flipsFromDraft ? 'SUBMIT_FINAL' : 'SUBMIT',
      contentUrls: urls, description: data.description, screenshotUrls: data.screenshotUrls,
      actorId: req.user!.userId,
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

    const submission = await findOne<{ id: string; status: string; task_id: string; herald_id: string; stage: 'DRAFT' | 'FINAL' }>(
      'SELECT id, status, task_id, herald_id, stage FROM task_submissions WHERE id = ?', [req.params.id]
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

    const stage = submission.stage || 'FINAL';
    const spec = await findOne<{ require_draft_review: number; max_revisions: number }>(
      'SELECT require_draft_review, max_revisions FROM task_content_specs WHERE task_id = ?',
      [submission.task_id]
    );

    if (data.status === 'REJECTED') {
      // 拒绝理由必填（2026-07-26）：'乱提意见'最便宜的解药是每次意见都要落字、可被仲裁回看
      if (!data.reviewNote?.trim()) {
        return res.status(400).json({ error: '拒绝时必须填写理由，帮助赫使了解改进方向', code: 'REASON_REQUIRED' });
      }
      // 改稿额度闸门：约束的是商家（额度用尽只能通过或仲裁），次数从留痕表派生
      const rejects = await countRejects(submission.task_id, submission.herald_id);
      const verdict = canReject(stage, !!(spec?.require_draft_review), spec?.max_revisions ?? 2, rejects.draft, rejects.final);
      if (!verdict.allowed) {
        return res.status(400).json({ error: verdict.error, code: verdict.code, used: verdict.used, limit: verdict.limit });
      }
    }

    if (data.status === 'APPROVED' && stage === 'DRAFT') {
      // 草稿通过 = 内容定稿（发布后若与草稿不符走仲裁，留痕表就是基准版本）。
      // 组合态 stage=DRAFT + status=APPROVED 表示"待赫使发布并提交终稿"，不结算
      const claim = await pool.query(
        `UPDATE task_submissions SET status = 'APPROVED', review_note = $1, reviewed_at = $2
         WHERE id = $3 AND status = 'PENDING_REVIEW'`,
        [data.reviewNote || null, new Date().toISOString(), req.params.id]
      );
      if (claim.rowCount === 0) return res.status(400).json({ error: '该提交已审核' });

      await auditRevision({
        submissionId: submission.id, taskId: submission.task_id, heraldId: submission.herald_id,
        stage: 'DRAFT', kind: 'REVIEW', action: 'APPROVED', note: data.reviewNote, actorId: req.user!.userId,
      });
      const heraldU = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [submission.herald_id]);
      await notify({
        userId: submission.herald_id,
        email: heraldU?.email,
        targetRole: 'HERALD',
        type: 'DRAFT_APPROVED',
        title: `草稿审核通过：${task.title}`,
        body: `${heraldU?.nickname || ''}，您提交的任务「${task.title}」草稿已通过审核。现在可以正式发布内容，发布后回到任务页提交最终链接。`,
        metadata: { taskId: submission.task_id, submissionId: submission.id, taskTitle: task.title },
      }).catch((e) => console.error('[notify] DRAFT_APPROVED failed:', e));

      const updatedDraft = await findOne('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
      return res.json({ ...updatedDraft, needsRating: false });
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

    await auditRevision({
      submissionId: submission.id, taskId: submission.task_id, heraldId: submission.herald_id,
      stage, kind: 'REVIEW', action: data.status, note: data.reviewNote, actorId: req.user!.userId,
    });

    // 通知赫使审核结果
    const heraldUser = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [submission.herald_id]);
    if (heraldUser) {
      const approved = data.status === 'APPROVED';
      const noteClause = data.reviewNote ? `\n备注：${data.reviewNote}` : '';
      await notify({
        userId: submission.herald_id,
        email: heraldUser.email,
        targetRole: 'HERALD',
        type: approved ? 'SUB_APPROVED' : stage === 'DRAFT' ? 'DRAFT_REJECTED' : 'SUB_REJECTED',
        title: stage === 'DRAFT'
          ? `草稿审核未通过：${task.title}`
          : `内容审核${approved ? '通过' : '未通过'}：${task.title}`,
        body: approved
          ? `${heraldUser.nickname}，您提交的任务「${task.title}」内容已审核通过，报酬将自动结算至您的钱包。${noteClause}`
          : stage === 'DRAFT'
            ? `${heraldUser.nickname}，您提交的任务「${task.title}」草稿未通过审核，请按反馈修改后重新提交草稿。${noteClause}`
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
      brand_id: req.user!.userId,
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
    `SELECT ts.*, u.nickname, hp.display_name, hp.country, hp.social_platforms,
            tr.score as rating_score, tr.comment as rating_comment
     FROM task_submissions ts
     JOIN users u ON u.id = ts.herald_id
     LEFT JOIN herald_profiles hp ON hp.user_id = ts.herald_id
     LEFT JOIN task_ratings tr ON tr.task_id = ts.task_id AND tr.herald_id = ts.herald_id
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
