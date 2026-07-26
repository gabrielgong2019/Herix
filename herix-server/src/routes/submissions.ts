import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { SubmitResultSchema, ReviewSubmissionSchema } from '../types';
import { ZodError } from 'zod';
import { notify } from '../utils/notify';
import pool from '../db';
import { decideSubmit, canReject } from '../utils/submissionFlow';
import { auditRevision, countRejects, approveDraftSubmission, settleFinalSubmission } from '../utils/reviewActions';

export const submissionsRouter = Router();

/** 商家在仲裁开案期间直接通过内容 = 争议消解，自动结案 */
async function closeOpenArbitration(submissionId: string, resolvedBy: string) {
  await pool.query(
    `UPDATE arbitrations SET status = 'RESOLVED', resolution = 'APPROVED_BY_BRAND',
            resolve_note = '商家在仲裁期间直接通过内容，争议消解', resolved_by = $1, resolved_at = $2
     WHERE submission_id = $3 AND status = 'OPEN'`,
    [resolvedBy, new Date().toISOString(), submissionId]
  );
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
      reminder_sent: 0,        // 新提交重置临期催审标记（每个待审周期最多催一次）
      resubmit_warn_sent: 0,   // 重提时重置，下轮被拒后重新计算预警窗口
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

    const subRef = { id: submission.id, task_id: submission.task_id, herald_id: submission.herald_id };

    if (data.status === 'APPROVED' && stage === 'DRAFT') {
      // 草稿通过 = 内容定稿（发布后若与草稿不符走仲裁，留痕表就是基准版本）。
      // 组合态 stage=DRAFT + status=APPROVED 表示"待赫使发布并提交终稿"，不结算。
      // CAS/审计/通知都在 approveDraftSubmission（与超时自动通过、仲裁裁决共用）
      const r = await approveDraftSubmission({
        submission: subRef, taskTitle: task.title,
        reviewNote: data.reviewNote, actorId: req.user!.userId,
      });
      if (!r.ok) return res.status(400).json({ error: '该提交已审核' });
      await closeOpenArbitration(submission.id, req.user!.userId);

      const updatedDraft = await findOne('SELECT * FROM task_submissions WHERE id = ?', [req.params.id]);
      return res.json({ ...updatedDraft, needsRating: false });
    }

    if (data.status === 'APPROVED') {
      // 终稿通过 = 结算打款（余额检查→CAS→记账→通知都在 settleFinalSubmission）
      const r = await settleFinalSubmission({
        submission: subRef, task,
        reviewNote: data.reviewNote, actorId: req.user!.userId,
      });
      if (!r.ok && r.code === 'INSUFFICIENT_BALANCE') {
        const isBrand = req.user!.role === 'BRAND';
        return res.status(402).json({
          error: isBrand
            ? `余额不足，需 ¥${r.needed}，当前可用 ¥${r.available}，请充值后再审核`
            : `品牌余额不足，需 ¥${r.needed}，当前可用 ¥${r.available}，请联系代理公司完成充值`,
          code: 'INSUFFICIENT_BALANCE',
          needed: r.needed,
          available: r.available,
        });
      }
      if (!r.ok) return res.status(400).json({ error: '该提交已审核' });
      await closeOpenArbitration(submission.id, req.user!.userId);
    } else {
      await update('task_submissions', {
        status: 'REJECTED',
        review_note: data.reviewNote || null,
        reviewed_at: new Date().toISOString(),
      }, 'id = ?', [req.params.id]);

      await auditRevision({
        submissionId: submission.id, taskId: submission.task_id, heraldId: submission.herald_id,
        stage, kind: 'REVIEW', action: 'REJECTED', note: data.reviewNote, actorId: req.user!.userId,
      });

      const heraldUser = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [submission.herald_id]);
      if (heraldUser) {
        const noteClause = data.reviewNote ? `\n备注：${data.reviewNote}` : '';
        await notify({
          userId: submission.herald_id,
          email: heraldUser.email,
          targetRole: 'HERALD',
          type: stage === 'DRAFT' ? 'DRAFT_REJECTED' : 'SUB_REJECTED',
          title: stage === 'DRAFT' ? `草稿审核未通过：${task.title}` : `内容审核未通过：${task.title}`,
          body: stage === 'DRAFT'
            ? `${heraldUser.nickname}，您提交的任务「${task.title}」草稿未通过审核，请按反馈修改后重新提交草稿。${noteClause}`
            : `${heraldUser.nickname}，您提交的任务「${task.title}」内容审核未通过，请查看反馈后重新提交。${noteClause}`,
          // taskTitle/note 进 metadata：前端按 type+params 渲染三语通知
          metadata: { taskId: submission.task_id, submissionId: submission.id, taskTitle: task.title, note: data.reviewNote || null },
        }).catch((e) => console.error('[notify] SUB review notification failed:', e));
      }
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

/** GET /api/submissions/pending — 商家的全部待审提交（跨任务，审核中心用）。
 *  含阶段/多链接/改稿计数/任务配置，前端据此渲染徽章与额度提示 */
submissionsRouter.get('/pending', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const rows = await findMany<any>(
    `SELECT ts.id, ts.task_id, ts.herald_id, ts.stage, ts.status, ts.content_url, ts.content_urls,
            ts.description, ts.screenshot_urls, ts.submitted_at,
            t.title AS task_title, u.nickname AS herald_name,
            COALESCE(tcs.require_draft_review, 0) AS require_draft_review,
            COALESCE(tcs.max_revisions, 2) AS max_revisions,
            (SELECT COUNT(*)::int FROM submission_revisions sr
             WHERE sr.task_id = ts.task_id AND sr.herald_id = ts.herald_id
               AND sr.kind = 'REVIEW' AND sr.action = 'REJECTED' AND sr.stage = ts.stage) AS stage_rejects,
            EXISTS (SELECT 1 FROM arbitrations a
                    WHERE a.submission_id = ts.id AND a.status = 'OPEN') AS arbitration_open
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     JOIN users u ON u.id = ts.herald_id
     LEFT JOIN task_content_specs tcs ON tcs.task_id = ts.task_id
     WHERE t.creator_id = ? AND ts.status = 'PENDING_REVIEW'
     ORDER BY ts.submitted_at ASC`, [req.user!.userId]
  );
  res.json(rows);
});

/** GET /api/submissions/:id/revisions — 交付审计链（仲裁证据/草稿定稿对照）。
 *  可见方：任务创建者/管理员/该提交的赫使本人 */
submissionsRouter.get('/:id/revisions', requireAuth, async (req: Request, res: Response) => {
  const sub = await findOne<{ task_id: string; herald_id: string; creator_id: string }>(
    `SELECT ts.task_id, ts.herald_id, t.creator_id FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id WHERE ts.id = ?`, [req.params.id]
  );
  if (!sub) return res.status(404).json({ error: '提交不存在' });
  const uid = req.user!.userId;
  if (uid !== sub.creator_id && uid !== sub.herald_id && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }
  const rows = await findMany<any>(
    `SELECT stage, kind, action, content_urls, description, screenshot_urls, note, created_at
     FROM submission_revisions WHERE task_id = ? AND herald_id = ? ORDER BY created_at ASC`,
    [sub.task_id, sub.herald_id]
  );
  res.json(rows);
});

/** GET /api/submissions/my — 我的提交 (赫使侧)。
 *  额度/仲裁字段给客户端做"申请仲裁"入口的显隐判断 */
submissionsRouter.get('/my', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  const subs = await findMany<any>(
    `SELECT ts.*, t.title as task_title, t.payout_per_herald,
            COALESCE(tcs.require_draft_review, 0) AS require_draft_review,
            COALESCE(tcs.max_revisions, 2) AS max_revisions,
            (SELECT COUNT(*)::int FROM submission_revisions sr
             WHERE sr.task_id = ts.task_id AND sr.herald_id = ts.herald_id
               AND sr.kind = 'REVIEW' AND sr.action = 'REJECTED' AND sr.stage = ts.stage) AS stage_rejects,
            EXISTS (SELECT 1 FROM arbitrations a
                    WHERE a.submission_id = ts.id AND a.status = 'OPEN') AS arbitration_open
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     LEFT JOIN task_content_specs tcs ON tcs.task_id = ts.task_id
     WHERE ts.herald_id = ?
     ORDER BY ts.submitted_at DESC`, [req.user!.userId]
  );
  res.json(subs);
});
