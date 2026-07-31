/**
 * 审批动作收口（2026-07-26 P1；2026-07-31 P0 原子化）：
 * 草稿过稿 / 终稿结算 从 submissions 路由抽出，三个调用方复用同一实现——
 * 商家手动审核(route)、超时自动通过(submissionTimers)、仲裁裁决(arbitrations)。
 *
 * 原子性保证（2026-07-31）：
 *   approveDraftSubmission — CAS UPDATE + auditRevision 在同一事务
 *   settleFinalSubmission  — CAS UPDATE + task_transactions + 3 钱包操作在同一事务
 *     品牌余额检查通过后才进事务，applyWalletEntry FOR UPDATE 是最终防线；
 *     如果事务内余额不足（极窄竞态），整个事务回滚，task_submissions 状态不变。
 *   audit 和 notify 在事务 COMMIT 后执行，失败不影响结算。
 */
import { findOne, insert, DbClient } from './db';
import { settleCreditTask, creditHerald, creditPlatformFee, PLATFORM_USER_ID, getBalance } from './wallet';
import { notify } from './notify';
import pool from '../db';
import { genId } from './db';

/** 系统动作（超时自动通过/名额释放）在审计链里的 actor 标识 */
export const SYSTEM_ACTOR = 'SYSTEM';

/** 审计留痕：每次提交/审核动作各一行（append-only，改稿计数与仲裁证据链均从此表派生）
 *  可选传入 client 以加入调用方事务（commit 后才可见，确保原子性）。 */
export async function auditRevision(row: {
  submissionId: string; taskId: string; heraldId: string; stage: string;
  kind: 'SUBMIT' | 'REVIEW'; action: string;
  contentUrls?: string[] | null; description?: string | null; screenshotUrls?: string[] | null;
  note?: string | null; actorId?: string | null;
}, client?: DbClient) {
  await insert('submission_revisions', {
    submission_id: row.submissionId, task_id: row.taskId, herald_id: row.heraldId,
    stage: row.stage, kind: row.kind, action: row.action,
    content_urls: row.contentUrls?.length ? JSON.stringify(row.contentUrls) : null,
    description: row.description || null,
    screenshot_urls: row.screenshotUrls?.length ? JSON.stringify(row.screenshotUrls) : null,
    note: row.note || null, actor_id: row.actorId || null,
  }, client);
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
 * CAS UPDATE + auditRevision 在同一事务，确保"过稿但无审计记录"状态不存在。
 * fromStatuses 默认只从 PENDING_REVIEW 转（商家手审/超时自动通过）；仲裁判赫使胜时
 * 允许从 REJECTED 强制翻案。
 */
export async function approveDraftSubmission(args: {
  submission: SubmissionRef; taskTitle: string;
  reviewNote?: string | null; actorId: string;
  auditAction?: string;
  fromStatuses?: string[];
}): Promise<ApproveResult> {
  const from = args.fromStatuses ?? ['PENDING_REVIEW'];
  const now = new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claim = await client.query(
      `UPDATE task_submissions SET status = 'APPROVED', review_note = $1, reviewed_at = $2
       WHERE id = $3 AND status = ANY($4)`,
      [args.reviewNote || null, now, args.submission.id, from]
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'ALREADY_REVIEWED' };
    }

    await auditRevision({
      submissionId: args.submission.id, taskId: args.submission.task_id, heraldId: args.submission.herald_id,
      stage: 'DRAFT', kind: 'REVIEW', action: args.auditAction ?? 'APPROVED',
      note: args.reviewNote, actorId: args.actorId,
    }, client);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // 通知在事务外：失败不影响已提交的结果
  const heraldU = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [args.submission.herald_id]);
  await notify({
    userId: args.submission.herald_id,
    email: heraldU?.email,
    targetRole: 'HERALD',
    type: 'DRAFT_APPROVED',
    variables: { task: args.taskTitle, nickname: heraldU?.nickname || '', note: args.reviewNote ? `\n备注：${args.reviewNote}` : '' },
    metadata: { taskId: args.submission.task_id, submissionId: args.submission.id, taskTitle: args.taskTitle, note: args.reviewNote || null },
  }).catch((e) => console.error('[notify] DRAFT_APPROVED failed:', e));

  return { ok: true };
}

/**
 * 终稿结算：单事务保证 CAS UPDATE + task_transactions + 3 钱包操作原子执行。
 *
 * 事务结构：
 *   BEGIN
 *     UPDATE task_submissions (CAS — 防并发双重审批)
 *     INSERT task_transactions (业务事件，releaseTxnId 作为幂等键基础)
 *     UPDATE wallets brand   FOR UPDATE → UPDATE + INSERT wallet_entries  (settleCreditTask)
 *     UPDATE wallets herald  FOR UPDATE → UPDATE + INSERT wallet_entries  (creditHerald)
 *     UPDATE wallets platform FOR UPDATE → UPDATE + INSERT wallet_entries (creditPlatformFee)
 *   COMMIT
 *
 * 余额预检（事务外）仅为快速返回用户友好 402；真正防止余额下穿的是
 * applyWalletEntry 内的 FOR UPDATE + newAvailable < 0 检查，事务内报错即全局回滚。
 */
export async function settleFinalSubmission(args: {
  submission: SubmissionRef; task: TaskPayoutRef;
  reviewNote?: string | null; actorId: string;
  auditAction?: string;
  fromStatuses?: string[];
  notifyBlockedBrand?: boolean;
}): Promise<ApproveResult> {
  const { task, submission } = args;
  const payout         = task.payout_per_herald;
  const costPerHerald  = task.cost_per_herald;
  const commissionRate = task.commission_rate;
  const platformFee    = Math.round((costPerHerald - payout) * 100) / 100;
  const now            = new Date().toISOString();

  // 余额预检（事务外，非权威，仅为用户友好 402）
  const brandBal = await getBalance(task.creator_id, 'brand');
  if (brandBal.available < costPerHerald) {
    if (args.notifyBlockedBrand !== false) {
      await notify({
        userId: task.creator_id,
        targetRole: 'BRAND',
        type: 'SETTLEMENT_BLOCKED',
        variables: { task: task.title, needed: costPerHerald, available: brandBal.available },
        metadata: { taskId: task.id, submissionId: submission.id, taskTitle: task.title, needed: costPerHerald, available: brandBal.available },
      }).catch((e) => console.error('[notify] SETTLEMENT_BLOCKED failed:', e));
    }
    return { ok: false, code: 'INSUFFICIENT_BALANCE', needed: costPerHerald, available: brandBal.available };
  }

  // 预生成 releaseTxnId，保证幂等键在事务内确定性存在
  const releaseTxnId = genId();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // CAS — 防并发双重审批
    const claimResult = await client.query(
      `UPDATE task_submissions
       SET status = 'APPROVED', commission_amount = $1, review_note = $2, reviewed_at = $3
       WHERE id = $4 AND status = ANY($5)`,
      [payout, args.reviewNote || null, now, submission.id, args.fromStatuses ?? ['PENDING_REVIEW']]
    );
    if (claimResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'ALREADY_REVIEWED' };
    }

    // 业务事件记录（releaseTxnId 作幂等键基础）
    await insert('task_transactions', {
      id:                releaseTxnId,
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
    }, client);

    // 三方记账：在同一事务内顺序执行（同一 client = 同一事务）
    // 锁顺序固定：brand → herald → platform，杜绝死锁
    await settleCreditTask({
      userId: task.creator_id, amount: costPerHerald,
      idempotencyKey: `SETTLE:${releaseTxnId}`,
      referenceType: 'task_transaction', referenceId: releaseTxnId,
      note: `任务《${task.title}》结算`,
    }, client);
    await creditHerald({
      userId: submission.herald_id, amount: payout,
      idempotencyKey: `CREDIT:${releaseTxnId}`,
      referenceType: 'task_transaction', referenceId: releaseTxnId,
      note: `任务《${task.title}》报酬`,
    }, client);
    await creditPlatformFee({
      userId: PLATFORM_USER_ID, amount: platformFee,
      idempotencyKey: `FEE:${releaseTxnId}`,
      referenceType: 'task_transaction', referenceId: releaseTxnId,
      note: `平台服务费 ${(commissionRate * 100).toFixed(0)}%`,
    }, client);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    // applyWalletEntry 余额不足时抛"余额不足"错误，转译为结构化返回值
    const msg = (e as Error).message ?? '';
    if (msg.includes('余额不足')) {
      // 重读实时余额给调用方（事务已回滚，读到的是当前真实值）
      const realBal = await getBalance(task.creator_id, 'brand');
      if (args.notifyBlockedBrand !== false) {
        await notify({
          userId: task.creator_id, targetRole: 'BRAND', type: 'SETTLEMENT_BLOCKED',
          variables: { task: task.title, needed: costPerHerald, available: realBal.available },
          metadata: { taskId: task.id, submissionId: submission.id, taskTitle: task.title, needed: costPerHerald, available: realBal.available },
        }).catch(() => {});
      }
      return { ok: false, code: 'INSUFFICIENT_BALANCE', needed: costPerHerald, available: realBal.available };
    }
    throw e;
  } finally {
    client.release();
  }

  // audit + notify 在事务 COMMIT 后：失败不影响已结算状态
  await auditRevision({
    submissionId: submission.id, taskId: submission.task_id, heraldId: submission.herald_id,
    stage: 'FINAL', kind: 'REVIEW', action: args.auditAction ?? 'APPROVED',
    note: args.reviewNote, actorId: args.actorId,
  });

  const heraldUser = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [submission.herald_id]);
  if (heraldUser) {
    await notify({
      userId: submission.herald_id,
      email: heraldUser.email,
      targetRole: 'HERALD',
      type: 'SUB_APPROVED',
      variables: { task: task.title, nickname: heraldUser.nickname || '', note: args.reviewNote ? `\n备注：${args.reviewNote}` : '' },
      metadata: { taskId: submission.task_id, submissionId: submission.id, taskTitle: task.title, note: args.reviewNote || null },
    }).catch((e) => console.error('[notify] SUB_APPROVED failed:', e));
  }
  return { ok: true };
}
