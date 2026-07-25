/**
 * 审批动作收口（2026-07-26，P1）：草稿过稿 / 终稿结算 从 submissions 路由抽出，
 * 三个调用方复用同一实现——商家手动审核(route)、超时自动通过(submissionTimers)、
 * 仲裁裁决(arbitrations)。审计留痕与通知都在动作内部完成，调用方只处理响应。
 */
import { findOne, insert } from './db';
import { settleCreditTask, creditHerald, creditPlatformFee, PLATFORM_USER_ID, getBalance } from './wallet';
import { notify } from './notify';
import pool from '../db';

/** 系统动作（超时自动通过/名额释放）在审计链里的 actor 标识 */
export const SYSTEM_ACTOR = 'SYSTEM';

/** 审计留痕：每次提交/审核动作各一行（append-only，改稿计数与仲裁证据链均从此表派生） */
export async function auditRevision(row: {
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
export async function countRejects(taskId: string, heraldId: string): Promise<{ draft: number; final: number }> {
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

export interface SubmissionRef { id: string; task_id: string; herald_id: string }
export interface TaskPayoutRef {
  id: string; creator_id: string; title: string;
  payout_per_herald: number; cost_per_herald: number; commission_rate: number;
}

export type ApproveResult =
  | { ok: true }
  | { ok: false; code: 'ALREADY_REVIEWED' }
  | { ok: false; code: 'INSUFFICIENT_BALANCE'; needed: number; available: number };

/**
 * 草稿过稿：组合态 stage=DRAFT + status=APPROVED（待赫使发布并提交终稿），不结算。
 * fromStatuses 默认只从 PENDING_REVIEW 转（商家手审/超时自动通过）；仲裁判赫使胜时
 * 允许从 REJECTED 强制翻案。
 */
export async function approveDraftSubmission(args: {
  submission: SubmissionRef; taskTitle: string;
  reviewNote?: string | null; actorId: string;
  auditAction?: string;                 // 默认 APPROVED；超时=AUTO_APPROVED；仲裁=ARBITRATION_APPROVED
  fromStatuses?: string[];
}): Promise<ApproveResult> {
  const from = args.fromStatuses ?? ['PENDING_REVIEW'];
  const claim = await pool.query(
    `UPDATE task_submissions SET status = 'APPROVED', review_note = $1, reviewed_at = $2
     WHERE id = $3 AND status = ANY($4)`,
    [args.reviewNote || null, new Date().toISOString(), args.submission.id, from]
  );
  if (claim.rowCount === 0) return { ok: false, code: 'ALREADY_REVIEWED' };

  await auditRevision({
    submissionId: args.submission.id, taskId: args.submission.task_id, heraldId: args.submission.herald_id,
    stage: 'DRAFT', kind: 'REVIEW', action: args.auditAction ?? 'APPROVED',
    note: args.reviewNote, actorId: args.actorId,
  });
  const heraldU = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [args.submission.herald_id]);
  await notify({
    userId: args.submission.herald_id,
    email: heraldU?.email,
    targetRole: 'HERALD',
    type: 'DRAFT_APPROVED',
    title: `草稿审核通过：${args.taskTitle}`,
    body: `${heraldU?.nickname || ''}，您提交的任务「${args.taskTitle}」草稿已通过审核。现在可以正式发布内容，发布后回到任务页提交最终链接。`,
    metadata: { taskId: args.submission.task_id, submissionId: args.submission.id, taskTitle: args.taskTitle, note: args.reviewNote || null },
  }).catch((e) => console.error('[notify] DRAFT_APPROVED failed:', e));
  return { ok: true };
}

/**
 * 终稿结算：余额检查 → CAS 通过 → TASK_RELEASE 业务事件 → 三方记账 → 通知。
 * 唯一会动钱的路径。余额不足时不做任何写操作，可选给商家发 SETTLEMENT_BLOCKED
 * （计时器调用方自行做 24h 去重后再决定 notifyBlockedBrand）。
 */
export async function settleFinalSubmission(args: {
  submission: SubmissionRef; task: TaskPayoutRef;
  reviewNote?: string | null; actorId: string;
  auditAction?: string;
  fromStatuses?: string[];
  notifyBlockedBrand?: boolean;         // 默认 true
}): Promise<ApproveResult> {
  const { task, submission } = args;
  // 使用发布时快照，与当前费率设置解耦
  const payout         = task.payout_per_herald;
  const costPerHerald  = task.cost_per_herald;
  const commissionRate = task.commission_rate;
  const platformFee    = Math.round((costPerHerald - payout) * 100) / 100;

  // 1. 余额检查在任何写操作之前
  const brandBal = await getBalance(task.creator_id, 'brand');
  if (brandBal.available < costPerHerald) {
    if (args.notifyBlockedBrand !== false) {
      await notify({
        userId: task.creator_id,
        targetRole: 'BRAND',
        type: 'SETTLEMENT_BLOCKED',
        title: '任务待结算 — 请充值完成打款',
        body: `任务《${task.title}》已完成，需支付 ¥${costPerHerald}（赫使到手 ¥${payout} + 平台服务费 ¥${platformFee}），当前余额 ¥${brandBal.available} 不足。`,
        metadata: { taskId: task.id, submissionId: submission.id, needed: costPerHerald, available: brandBal.available },
      }).catch((e) => console.error('[notify] SETTLEMENT_BLOCKED failed:', e));
    }
    return { ok: false, code: 'INSUFFICIENT_BALANCE', needed: costPerHerald, available: brandBal.available };
  }

  // 2. 原子 UPDATE：CAS 防止并发双重审批（含超时任务与手审并发的场景）
  const claimResult = await pool.query(
    `UPDATE task_submissions
     SET status = 'APPROVED', commission_amount = $1, review_note = $2, reviewed_at = $3
     WHERE id = $4 AND status = ANY($5)`,
    [payout, args.reviewNote || null, new Date().toISOString(), submission.id, args.fromStatuses ?? ['PENDING_REVIEW']]
  );
  if (claimResult.rowCount === 0) return { ok: false, code: 'ALREADY_REVIEWED' };

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

  await auditRevision({
    submissionId: submission.id, taskId: submission.task_id, heraldId: submission.herald_id,
    stage: 'FINAL', kind: 'REVIEW', action: args.auditAction ?? 'APPROVED',
    note: args.reviewNote, actorId: args.actorId,
  });

  const heraldUser = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [submission.herald_id]);
  if (heraldUser) {
    const noteClause = args.reviewNote ? `\n备注：${args.reviewNote}` : '';
    await notify({
      userId: submission.herald_id,
      email: heraldUser.email,
      targetRole: 'HERALD',
      type: 'SUB_APPROVED',
      title: `内容审核通过：${task.title}`,
      body: `${heraldUser.nickname}，您提交的任务「${task.title}」内容已审核通过，报酬将自动结算至您的钱包。${noteClause}`,
      metadata: { taskId: submission.task_id, submissionId: submission.id, taskTitle: task.title, note: args.reviewNote || null },
    }).catch((e) => console.error('[notify] SUB_APPROVED failed:', e));
  }
  return { ok: true };
}
