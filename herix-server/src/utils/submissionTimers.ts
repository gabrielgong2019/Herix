/**
 * 交付双向计时器（2026-07-26，P1）：约束双方都不能挂起流程。
 *
 *   商家侧：待审提交超过 review_timeout_days 天无人审 → 自动通过
 *           （草稿=自动过稿不结算；终稿=自动结算打款，余额不足跳过下轮重试）。
 *           临期剩 24h 时先发一次催审通知（reminder_sent 标记，提交时归零）。
 *   赫使侧：被拒后超过 resubmit_timeout_days 天未重提 → 释放任务名额
 *           （报名置 EXPIRED，slot 计数自动回收——名额从 COUNT(status='APPROVED') 派生）。
 *
 * 仲裁冻结：submission 有 OPEN 仲裁案时两侧计时都跳过。
 * 时限在 platform_settings 可配（review_timeout_days / resubmit_timeout_days）。
 * 跟 fxSync 同一模式：启动延时首跑 + setInterval 每小时扫一次。
 */
import pool from '../db';
import { findMany, update } from './db';
import { getSetting } from './settings';
import { notify } from './notify';
import { approveDraftSubmission, settleFinalSubmission, auditRevision, SYSTEM_ACTOR } from './reviewActions';

const NO_OPEN_ARBITRATION = `NOT EXISTS (
  SELECT 1 FROM arbitrations a WHERE a.submission_id = ts.id AND a.status = 'OPEN')`;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/** 单轮扫描（导出供测试脚本直接调用） */
export async function runSubmissionTimersOnce(): Promise<{ reminded: number; autoApproved: number; released: number; warned: number; finalReminded: number }> {
  const reviewDays      = Number(await getSetting('review_timeout_days')) || 7;
  const resubmitDays    = Number(await getSetting('resubmit_timeout_days')) || 7;
  const finalRemindDays = Number(await getSetting('final_submit_reminder_days')) || 7;
  const dueCutoff    = isoDaysAgo(reviewDays);
  const remindCutoff = isoDaysAgo(Math.max(reviewDays - 1, 0));
  let reminded = 0, autoApproved = 0, released = 0, warned = 0, finalReminded = 0;

  // ── 1. 临期催审（剩 ≤24h 且未到期，只发一次）──
  const toRemind = await findMany<any>(
    `SELECT ts.id, ts.task_id, ts.stage, t.creator_id, t.title, u.email
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     JOIN users u ON u.id = t.creator_id
     WHERE ts.status = 'PENDING_REVIEW' AND ts.reminder_sent = 0
       AND ts.submitted_at < ? AND ts.submitted_at >= ?
       AND ${NO_OPEN_ARBITRATION}`,
    [remindCutoff, dueCutoff]
  );
  for (const s of toRemind) {
    const stageName = s.stage === 'DRAFT' ? '草稿' : '终稿';
    await notify({
      userId: s.creator_id,
      email: s.email,
      targetRole: 'BRAND',
      type: 'REVIEW_REMINDER',
      variables: { task: s.title, days: reviewDays - 1, stage: s.stage, autoNote: s.stage === 'FINAL' ? '并结算打款' : '' },
      metadata: { taskId: s.task_id, submissionId: s.id, taskTitle: s.title, stage: s.stage },
    }).catch((e) => console.error('[timers] REVIEW_REMINDER failed:', e));
    await update('task_submissions', { reminder_sent: 1 }, 'id = ?', [s.id]);
    reminded++;
  }

  // ── 2. 到期自动通过 ──
  const toApprove = await findMany<any>(
    `SELECT ts.id, ts.task_id, ts.herald_id, ts.stage,
            t.creator_id, t.title, t.payout_per_herald, t.cost_per_herald, t.commission_rate
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     WHERE ts.status = 'PENDING_REVIEW' AND ts.submitted_at < ?
       AND ${NO_OPEN_ARBITRATION}`,
    [dueCutoff]
  );
  for (const s of toApprove) {
    const sub = { id: s.id, task_id: s.task_id, herald_id: s.herald_id };
    const note = `超时未审核（${reviewDays}天），系统自动通过`;
    if (s.stage === 'DRAFT') {
      const r = await approveDraftSubmission({
        submission: sub, taskTitle: s.title, reviewNote: note,
        actorId: SYSTEM_ACTOR, auditAction: 'AUTO_APPROVED',
      });
      if (r.ok) autoApproved++;
    } else {
      // 余额不足的 SETTLEMENT_BLOCKED 通知 24h 去重（计时器每小时跑，不去重会刷屏）
      const dedup = await pool.query(
        `SELECT 1 FROM notifications
         WHERE type = 'SETTLEMENT_BLOCKED' AND user_id = $1
           AND metadata LIKE $2 AND created_at > $3 LIMIT 1`,
        [s.creator_id, `%"submissionId":"${s.id}"%`, isoDaysAgo(1)]
      );
      const r = await settleFinalSubmission({
        submission: sub,
        task: { id: s.task_id, creator_id: s.creator_id, title: s.title,
                payout_per_herald: s.payout_per_herald, cost_per_herald: s.cost_per_herald,
                commission_rate: s.commission_rate },
        reviewNote: note, actorId: SYSTEM_ACTOR, auditAction: 'AUTO_APPROVED',
        notifyBlockedBrand: dedup.rowCount === 0,
      });
      if (r.ok) autoApproved++;
      else if (r.code === 'INSUFFICIENT_BALANCE') {
        console.log(`[timers] auto-approve blocked (balance): sub=${s.id} task=${s.task_id} needed=${r.needed} available=${r.available}`);
      }
    }
  }

  // ── 3a. 赫使临期预警（修改期剩 ≤24h，只发一次）──
  const toWarn = await findMany<any>(
    `SELECT ts.id, ts.task_id, ts.herald_id, ts.stage, t.title, u.email
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     JOIN users u ON u.id = ts.herald_id
     WHERE ts.status = 'REJECTED' AND ts.resubmit_warn_sent = 0
       AND ts.reviewed_at < ? AND ts.reviewed_at >= ?
       AND EXISTS (SELECT 1 FROM task_applications ta
                   WHERE ta.task_id = ts.task_id AND ta.herald_id = ts.herald_id AND ta.status = 'APPROVED')
       AND ${NO_OPEN_ARBITRATION}`,
    [isoDaysAgo(resubmitDays - 1), isoDaysAgo(resubmitDays)]
  );
  for (const s of toWarn) {
    await notify({
      userId: s.herald_id,
      email: s.email,
      targetRole: 'HERALD',
      type: 'RESUBMIT_EXPIRY_WARN',
      variables: { task: s.title },
      metadata: { taskId: s.task_id, submissionId: s.id, taskTitle: s.title },
    }).catch((e) => console.error('[timers] RESUBMIT_EXPIRY_WARN failed:', e));
    await update('task_submissions', { resubmit_warn_sent: 1 }, 'id = ?', [s.id]);
    warned++;
  }

  // ── 3b. 赫使超时未重提 → 释放名额 ──
  const toRelease = await findMany<any>(
    `SELECT ts.id, ts.task_id, ts.herald_id, ts.stage, t.title, u.email
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     JOIN users u ON u.id = ts.herald_id
     WHERE ts.status = 'REJECTED' AND ts.reviewed_at < ?
       AND EXISTS (SELECT 1 FROM task_applications ta
                   WHERE ta.task_id = ts.task_id AND ta.herald_id = ts.herald_id AND ta.status = 'APPROVED')
       AND ${NO_OPEN_ARBITRATION}`,
    [isoDaysAgo(resubmitDays)]
  );
  for (const s of toRelease) {
    // 报名置 EXPIRED：名额计数（COUNT status='APPROVED'）自动回收，提交路径的
    // "只有被批准的赫使可以提交" 检查同时挡住后续重提，无需给 submission 加终态
    await pool.query(
      `UPDATE task_applications SET status = 'EXPIRED', updated_at = $1
       WHERE task_id = $2 AND herald_id = $3 AND status = 'APPROVED'`,
      [new Date().toISOString(), s.task_id, s.herald_id]
    );
    await auditRevision({
      submissionId: s.id, taskId: s.task_id, heraldId: s.herald_id,
      stage: s.stage, kind: 'REVIEW', action: 'SLOT_RELEASED',
      note: `修改期已过（${resubmitDays}天），系统释放名额`, actorId: SYSTEM_ACTOR,
    });
    await notify({
      userId: s.herald_id,
      email: s.email,
      targetRole: 'HERALD',
      type: 'SLOT_RELEASED',
      variables: { task: s.title },
      metadata: { taskId: s.task_id, submissionId: s.id, taskTitle: s.title },
    }).catch((e) => console.error('[timers] SLOT_RELEASED failed:', e));
    released++;
  }

  // ── 4. 草稿已过·待交终稿催办（只催不动作）：草稿通过 finalRemindDays 天仍未发布交终稿 → 友好提醒赫使 ──
  // 状态锚点 DRAFT+APPROVED：赫使一交终稿该行即翻 FINAL+PENDING_REVIEW，自然退出本 sweep。只发一次。
  const toNudgeFinal = await findMany<any>(
    `SELECT ts.id, ts.task_id, ts.herald_id, t.title, u.email
     FROM task_submissions ts
     JOIN tasks t ON t.id = ts.task_id
     JOIN users u ON u.id = ts.herald_id
     WHERE ts.stage = 'DRAFT' AND ts.status = 'APPROVED' AND ts.final_reminder_sent = 0
       AND ts.reviewed_at < ?
       AND EXISTS (SELECT 1 FROM task_applications ta
                   WHERE ta.task_id = ts.task_id AND ta.herald_id = ts.herald_id AND ta.status = 'APPROVED')
       AND ${NO_OPEN_ARBITRATION}`,
    [isoDaysAgo(finalRemindDays)]
  );
  for (const s of toNudgeFinal) {
    await notify({
      userId: s.herald_id,
      email: s.email,
      targetRole: 'HERALD',
      type: 'DRAFT_FINAL_REMINDER',
      variables: { task: s.title },
      metadata: { taskId: s.task_id, submissionId: s.id, taskTitle: s.title },
    }).catch((e) => console.error('[timers] DRAFT_FINAL_REMINDER failed:', e));
    await update('task_submissions', { final_reminder_sent: 1 }, 'id = ?', [s.id]);
    finalReminded++;
  }

  if (reminded || autoApproved || released || warned || finalReminded) {
    console.log(`[timers] reminded=${reminded} autoApproved=${autoApproved} released=${released} warned=${warned} finalReminded=${finalReminded}`);
  }
  return { reminded, autoApproved, released, warned, finalReminded };
}
// 调度移至 jobs/registry.ts（runOnce = runSubmissionTimersOnce，每小时一轮）
