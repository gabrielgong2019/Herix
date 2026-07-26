/**
 * 平台仲裁（2026-07-26，P1）：改稿额度用尽后的唯一出口。
 * 开案条件：当前阶段拒绝额度已用尽 + 该提交从未开过案（UNIQUE submission_id）。
 * 开案期间 submission 冻结超时计时（submissionTimers 跳过 OPEN 案）。
 * 裁决：判赫使胜 = 强制通过（终稿走结算）；判商家胜 = 维持拒绝并释放名额。
 * 商家在开案期间直接通过内容 = 争议消解，review 路由自动结案（APPROVED_BY_BRAND）。
 */
import { Router, Request, Response } from 'express';
import { findOne, findMany, insert } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { notify } from '../utils/notify';
import pool from '../db';
import { canReject } from '../utils/submissionFlow';
import { countRejects, approveDraftSubmission, settleFinalSubmission, auditRevision } from '../utils/reviewActions';

export const arbitrationsRouter = Router();

/** POST /api/arbitrations — 商家/赫使开案（额度用尽后） */
arbitrationsRouter.post('/', requireAuth, requireRole('BRAND', 'HERALD', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const { submissionId, reason } = req.body || {};
    if (!submissionId || !String(reason || '').trim()) {
      return res.status(400).json({ error: '需提供 submissionId 和申请理由', code: 'REASON_REQUIRED' });
    }

    const sub = await findOne<any>(
      `SELECT ts.id, ts.task_id, ts.herald_id, ts.stage, ts.status,
              t.creator_id, t.title,
              COALESCE(tcs.require_draft_review, 0) AS require_draft_review,
              COALESCE(tcs.max_revisions, 2) AS max_revisions
       FROM task_submissions ts
       JOIN tasks t ON t.id = ts.task_id
       LEFT JOIN task_content_specs tcs ON tcs.task_id = ts.task_id
       WHERE ts.id = ?`, [submissionId]
    );
    if (!sub) return res.status(404).json({ error: '提交不存在' });

    const uid = req.user!.userId;
    const isBrandParty = uid === sub.creator_id;
    const isHeraldParty = uid === sub.herald_id;
    if (!isBrandParty && !isHeraldParty && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: '无权限' });
    }

    // 已终审的提交没有争议标的
    if (sub.status === 'APPROVED' && sub.stage === 'FINAL') {
      return res.status(400).json({ error: '该提交已通过结算，无需仲裁', code: 'ALREADY_SETTLED' });
    }

    // 开案门槛：当前阶段拒绝额度已用尽（额度没用尽先走正常审核流程）
    const rejects = await countRejects(sub.task_id, sub.herald_id);
    const verdict = canReject(sub.stage, !!sub.require_draft_review, sub.max_revisions, rejects.draft, rejects.final);
    if (verdict.allowed) {
      return res.status(400).json({
        error: '当前改稿额度未用尽，请先走正常审核/重提流程',
        code: 'ARBITRATION_NOT_AVAILABLE',
      });
    }

    // 一个提交终身只能开一案（UNIQUE 兜底，这里先给友好报错）
    const existing = await findOne<any>('SELECT id, status FROM arbitrations WHERE submission_id = ?', [submissionId]);
    if (existing) {
      return res.status(409).json({ error: '该提交已有仲裁记录', code: 'ARBITRATION_EXISTS', status: existing.status });
    }

    const openerRole = isBrandParty ? 'BRAND' : isHeraldParty ? 'HERALD' : 'ADMIN';
    const arbId = await insert('arbitrations', {
      submission_id: sub.id, task_id: sub.task_id, herald_id: sub.herald_id,
      opened_by: uid, opened_by_role: openerRole,
      stage: sub.stage, reason: String(reason).trim(), status: 'OPEN',
      created_at: new Date().toISOString(),
    });

    // 通知对方当事人（开案期间超时计时冻结）
    const counterpartyId = isBrandParty ? sub.herald_id : sub.creator_id;
    const cp = await findOne<any>('SELECT email FROM users WHERE id = ?', [counterpartyId]);
    await notify({
      userId: counterpartyId,
      email: cp?.email,
      targetRole: isBrandParty ? 'HERALD' : 'BRAND',
      type: 'ARBITRATION_OPENED',
      variables: { task: sub.title },
      metadata: { taskId: sub.task_id, submissionId: sub.id, taskTitle: sub.title, arbitrationId: arbId },
    }).catch((e) => console.error('[notify] ARBITRATION_OPENED failed:', e));

    res.status(201).json({ id: arbId, status: 'OPEN' });
  } catch (err) {
    console.error('Arbitration open error:', err);
    res.status(500).json({ error: '开案失败' });
  }
});

/** GET /api/arbitrations — 仲裁队列（管理员），?status=OPEN/RESOLVED 可筛 */
arbitrationsRouter.get('/', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await findMany<any>(
    `SELECT a.*, t.title AS task_title, t.payout_per_herald, t.cost_per_herald,
            bu.nickname AS brand_name, hu.nickname AS herald_name,
            ts.status AS submission_status, ts.stage AS submission_stage,
            ts.content_urls, ts.description, ts.review_note,
            COALESCE(tcs.require_draft_review, 0) AS require_draft_review,
            COALESCE(tcs.max_revisions, 2) AS max_revisions
     FROM arbitrations a
     JOIN tasks t ON t.id = a.task_id
     JOIN users bu ON bu.id = t.creator_id
     JOIN users hu ON hu.id = a.herald_id
     JOIN task_submissions ts ON ts.id = a.submission_id
     LEFT JOIN task_content_specs tcs ON tcs.task_id = a.task_id
     ${status ? 'WHERE a.status = ?' : ''}
     ORDER BY (a.status = 'OPEN') DESC, a.created_at ASC`,
    status ? [status] : []
  );
  res.json(rows);
});

/** POST /api/arbitrations/:id/resolve — 管理员裁决 */
arbitrationsRouter.post('/:id/resolve', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { winner, note } = req.body || {};
    if (winner !== 'HERALD' && winner !== 'BRAND') {
      return res.status(400).json({ error: 'winner 须为 HERALD 或 BRAND' });
    }
    if (!String(note || '').trim()) {
      return res.status(400).json({ error: '裁决必须填写理由', code: 'REASON_REQUIRED' });
    }

    const arb = await findOne<any>('SELECT * FROM arbitrations WHERE id = ?', [req.params.id]);
    if (!arb) return res.status(404).json({ error: '仲裁案不存在' });
    if (arb.status !== 'OPEN') return res.status(409).json({ error: '该案已裁决', code: 'ALREADY_RESOLVED' });

    const sub = await findOne<any>(
      `SELECT ts.id, ts.task_id, ts.herald_id, ts.stage, ts.status,
              t.id AS t_id, t.creator_id, t.title, t.payout_per_herald, t.cost_per_herald, t.commission_rate
       FROM task_submissions ts JOIN tasks t ON t.id = ts.task_id WHERE ts.id = ?`,
      [arb.submission_id]
    );
    if (!sub) return res.status(404).json({ error: '提交不存在' });

    const resolveNote = String(note).trim();
    const subRef = { id: sub.id, task_id: sub.task_id, herald_id: sub.herald_id };

    if (winner === 'HERALD') {
      // 判赫使胜 = 强制通过（允许从 REJECTED 翻案）；终稿走结算，余额不足则案子保持 OPEN 待充值后重试
      if (sub.stage === 'FINAL') {
        const r = await settleFinalSubmission({
          submission: subRef,
          task: { id: sub.t_id, creator_id: sub.creator_id, title: sub.title,
                  payout_per_herald: sub.payout_per_herald, cost_per_herald: sub.cost_per_herald,
                  commission_rate: sub.commission_rate },
          reviewNote: `平台仲裁裁决：${resolveNote}`, actorId: req.user!.userId,
          auditAction: 'ARBITRATION_APPROVED',
          fromStatuses: ['PENDING_REVIEW', 'REJECTED'],
        });
        if (!r.ok && r.code === 'INSUFFICIENT_BALANCE') {
          return res.status(402).json({
            error: `品牌余额不足，需 ¥${r.needed}，当前可用 ¥${r.available}，请商家充值后再执行裁决`,
            code: 'INSUFFICIENT_BALANCE', needed: r.needed, available: r.available,
          });
        }
        if (!r.ok) return res.status(409).json({ error: '提交状态已变化，请刷新后重试' });
      } else {
        const r = await approveDraftSubmission({
          submission: subRef, taskTitle: sub.title,
          reviewNote: `平台仲裁裁决：${resolveNote}`, actorId: req.user!.userId,
          auditAction: 'ARBITRATION_APPROVED',
          fromStatuses: ['PENDING_REVIEW', 'REJECTED'],
        });
        if (!r.ok) return res.status(409).json({ error: '提交状态已变化，请刷新后重试' });
      }
    } else {
      // 判商家胜 = 维持拒绝（终态）并释放名额
      await pool.query(
        `UPDATE task_submissions SET status = 'REJECTED', review_note = $1, reviewed_at = $2 WHERE id = $3`,
        [`平台仲裁裁决：${resolveNote}`, new Date().toISOString(), sub.id]
      );
      await pool.query(
        `UPDATE task_applications SET status = 'EXPIRED', updated_at = $1
         WHERE task_id = $2 AND herald_id = $3 AND status = 'APPROVED'`,
        [new Date().toISOString(), sub.task_id, sub.herald_id]
      );
      await auditRevision({
        submissionId: sub.id, taskId: sub.task_id, heraldId: sub.herald_id,
        stage: sub.stage, kind: 'REVIEW', action: 'ARBITRATION_REJECTED',
        note: resolveNote, actorId: req.user!.userId,
      });
    }

    await pool.query(
      `UPDATE arbitrations SET status = 'RESOLVED', resolution = $1, resolve_note = $2, resolved_by = $3, resolved_at = $4
       WHERE id = $5 AND status = 'OPEN'`,
      [winner, resolveNote, req.user!.userId, new Date().toISOString(), arb.id]
    );

    // 通知双方裁决结果
    const [brandU, heraldU] = await Promise.all([
      findOne<any>('SELECT email FROM users WHERE id = ?', [sub.creator_id]),
      findOne<any>('SELECT email FROM users WHERE id = ?', [sub.herald_id]),
    ]);
    const bodyFor = (won: boolean) =>
      `任务「${sub.title}」的仲裁已裁决：${won ? '支持您的主张' : '未支持您的主张'}。裁决说明：${resolveNote}`;
    await Promise.all([
      notify({
        userId: sub.creator_id, email: brandU?.email, targetRole: 'BRAND',
        type: 'ARBITRATION_RESOLVED', title: `仲裁已裁决：${sub.title}`,
        body: bodyFor(winner === 'BRAND'),
        metadata: { taskId: sub.task_id, submissionId: sub.id, taskTitle: sub.title, winner, note: resolveNote },
      }).catch((e) => console.error('[notify] ARBITRATION_RESOLVED brand failed:', e)),
      notify({
        userId: sub.herald_id, email: heraldU?.email, targetRole: 'HERALD',
        type: 'ARBITRATION_RESOLVED', title: `仲裁已裁决：${sub.title}`,
        body: bodyFor(winner === 'HERALD'),
        metadata: { taskId: sub.task_id, submissionId: sub.id, taskTitle: sub.title, winner, note: resolveNote },
      }).catch((e) => console.error('[notify] ARBITRATION_RESOLVED herald failed:', e)),
    ]);

    res.json({ ok: true, resolution: winner });
  } catch (err) {
    console.error('Arbitration resolve error:', err);
    res.status(500).json({ error: '裁决失败' });
  }
});
