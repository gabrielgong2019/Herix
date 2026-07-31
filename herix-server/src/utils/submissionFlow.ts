/**
 * 两阶段交付状态机 —— 转换规则唯一收口（2026-07-26，P0a）
 *
 * 状态用 stage × status 组合态表达（不新增 status 枚举值，旧客户端只认识
 * PENDING_REVIEW/APPROVED/REJECTED 三个值）：
 *
 *   stage=DRAFT + PENDING_REVIEW  草稿待审
 *   stage=DRAFT + REJECTED        草稿被拒（可重提，消耗改稿额度）
 *   stage=DRAFT + APPROVED        草稿已过，待赫使发布并提交终稿  ← 中间态
 *   stage=FINAL + PENDING_REVIEW  终稿待核验
 *   stage=FINAL + REJECTED        终稿被拒（链接问题等，小额度上限）
 *   stage=FINAL + APPROVED        完成（结算仅发生在这里）
 *
 * 拒绝额度语义（约束的是商家，不是赫使）：
 *   - 草稿阶段拒绝 → 消耗 max_revisions（创意返工预算）
 *   - 终稿阶段拒绝 → 草稿前置任务固定上限 FINAL_REJECT_LIMIT（核验非创意，
 *     不允许商家在终稿续写改稿地狱）；单阶段任务则由 max_revisions 管终稿循环
 *   - 额度用尽后商家只能通过或走平台仲裁
 *   改稿次数一律从 submission_revisions 派生（COUNT 拒绝事件），无计数列，单一来源。
 */

export const FINAL_REJECT_LIMIT = 2;

export interface SubmissionRowLike {
  stage: 'DRAFT' | 'FINAL';
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
}

export type SubmitDecision =
  | { ok: true; stage: 'DRAFT' | 'FINAL'; isResubmit: boolean; flipsFromDraft: boolean }
  | { ok: false; httpStatus: number; code: string; error: string };

/** 赫使提交时：根据任务配置与当前行推导本次提交属于哪个阶段（或拒绝） */
export function decideSubmit(requireDraft: boolean, row: SubmissionRowLike | null): SubmitDecision {
  if (!row) {
    return { ok: true, stage: requireDraft ? 'DRAFT' : 'FINAL', isResubmit: false, flipsFromDraft: false };
  }
  if (row.status === 'PENDING_REVIEW') {
    return { ok: false, httpStatus: 409, code: 'ALREADY_SUBMITTED', error: '已经提交过结果' };
  }
  if (row.stage === 'DRAFT') {
    if (row.status === 'REJECTED') return { ok: true, stage: 'DRAFT', isResubmit: true, flipsFromDraft: false };
    // DRAFT + APPROVED：草稿已过，本次提交即终稿
    return { ok: true, stage: 'FINAL', isResubmit: false, flipsFromDraft: true };
  }
  // stage=FINAL
  if (row.status === 'REJECTED') return { ok: true, stage: 'FINAL', isResubmit: true, flipsFromDraft: false };
  return { ok: false, httpStatus: 409, code: 'ALREADY_SUBMITTED', error: '已经提交过结果' };
}

/**
 * 客户端"下一步动作"类型——由服务端计算后下推，客户端不再重新推导状态机。
 *
 *   SUBMIT_DRAFT    → 赫使应提交草稿（初次或重提）
 *   SUBMIT_FINAL    → 草稿已过，赫使应发布内容并提交终稿链接
 *   WAITING_REVIEW  → 已提交，等待商家审核
 *   DONE            → 终稿已过，任务完成
 */
export type NextAction = 'SUBMIT_DRAFT' | 'SUBMIT_FINAL' | 'WAITING_REVIEW' | 'DONE';

/** 根据任务配置与当前提交行，计算赫使侧的下一步动作（null = 无有效提交行且任务无草稿要求） */
export function computeNextAction(requireDraft: boolean, row: SubmissionRowLike | null): NextAction {
  if (!row) return requireDraft ? 'SUBMIT_DRAFT' : 'SUBMIT_FINAL';
  if (row.status === 'PENDING_REVIEW') return 'WAITING_REVIEW';
  if (row.stage === 'DRAFT') {
    if (row.status === 'REJECTED') return 'SUBMIT_DRAFT';
    return 'SUBMIT_FINAL'; // DRAFT + APPROVED
  }
  // stage = FINAL
  if (row.status === 'REJECTED') return 'SUBMIT_FINAL';
  return 'DONE'; // FINAL + APPROVED
}

export type RejectDecision = { allowed: true } | { allowed: false; code: string; error: string; used: number; limit: number };

/** 商家拒绝时：按阶段与既往拒绝次数判定是否还有额度 */
export function canReject(
  stage: 'DRAFT' | 'FINAL',
  requireDraft: boolean,
  maxRevisions: number,
  draftRejects: number,
  finalRejects: number,
): RejectDecision {
  if (stage === 'DRAFT') {
    if (draftRejects >= maxRevisions) {
      return {
        allowed: false, code: 'REVISION_LIMIT_REACHED', used: draftRejects, limit: maxRevisions,
        error: `改稿次数已用完（${draftRejects}/${maxRevisions}），请通过内容或联系平台仲裁`,
      };
    }
    return { allowed: true };
  }
  const limit = requireDraft ? FINAL_REJECT_LIMIT : maxRevisions;
  if (finalRejects >= limit) {
    return {
      allowed: false, code: 'REVISION_LIMIT_REACHED', used: finalRejects, limit,
      error: requireDraft
        ? `终稿核验拒绝次数已用完（${finalRejects}/${limit}），内容与草稿不符请联系平台仲裁`
        : `改稿次数已用完（${finalRejects}/${limit}），请通过内容或联系平台仲裁`,
    };
  }
  return { allowed: true };
}
