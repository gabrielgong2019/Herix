/**
 * 前后端共享契约（2026-07-26 第一期）——枚举/状态值的唯一事实源。
 *
 * 背景：herix-merchant 与 herix-server 的类型此前两边手写互抄，无任何机制保证一致，
 * 造成 difficulty 大小写漂移（UI 创建任务 100% 失败）、前端向不存在的字段/端点编程
 * 等一整类 bug。本文件是这类值的唯一定义处，两端一律从这里 import。
 *
 * 规则：
 * - 本文件必须保持零依赖（纯类型 + as const 常量），merchant 会打包它，
 *   不允许 import 任何服务端模块（pg/express/…）
 * - ⚠️ 带「DB-CHECK」标记的枚举在 db.ts 有对应 CHECK 约束——加值必须同步
 *   幂等重建约束（DROP CONSTRAINT IF EXISTS + ADD），否则运行时才炸
 * - merchant 通过 vite/tsconfig 别名 @contracts 引入
 */

// ── 任务 ──────────────────────────────────────────────────────────
export const TASK_MODES = ['STANDARD', 'PERFORMANCE'] as const;
export type TaskMode = typeof TASK_MODES[number];

/** ⚠️ 小写——DB 与 zod 均为小写，前端曾误用大写 'MEDIUM' 导致创建全挂 */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = typeof DIFFICULTIES[number];

/** 'referral' 是邀请码任务的占位 content_type（merchant 手写类型曾漏掉它——漂移实例） */
export const CONTENT_TYPES = ['photo', 'video', 'both', 'referral'] as const;
export type ContentType = typeof CONTENT_TYPES[number];
/** 内容创作任务的可选形式（表单 UI 用，不含 referral 占位值） */
export const STANDARD_CONTENT_TYPES = ['photo', 'video', 'both'] as const;

export const TASK_STATUSES = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_VISIBILITIES = ['PUBLIC', 'INVITE'] as const;
export type TaskVisibility = typeof TASK_VISIBILITIES[number];

// ── 报名 / 交付 ────────────────────────────────────────────────────
/** DB-CHECK: task_applications_status_check（EXPIRED=名额释放，2026-07-26 加） */
export const APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

/** 两阶段交付组合态：stage × status，见 utils/submissionFlow.ts */
export const SUBMISSION_STAGES = ['DRAFT', 'FINAL'] as const;
export type SubmissionStage = typeof SUBMISSION_STAGES[number];

export const SUBMISSION_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type SubmissionStatus = typeof SUBMISSION_STATUSES[number];

// ── 订阅 ──────────────────────────────────────────────────────────
export const PLAN_CODES = ['basic', 'premium', 'custom'] as const;
export type PlanCode = typeof PLAN_CODES[number];

/** DB-CHECK: merchant_subscriptions.billing_cycle */
export const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type BillingCycle = typeof BILLING_CYCLES[number];

export const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** DB-CHECK: merchant_subscriptions.status（状态机见 utils/subscriptions.ts） */
export const SUBSCRIPTION_STATUSES = ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED'] as const;
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];

/** DB-CHECK: subscription_inquiries.status */
export const INQUIRY_STATUSES = ['NEW', 'CONTACTED', 'CLOSED'] as const;
export type InquiryStatus = typeof INQUIRY_STATUSES[number];

// ── 钱包 ──────────────────────────────────────────────────────────
/** DB-CHECK: wallet_entries_type_check（2026-07-26 加订阅两类时曾漏改约束运行时炸） */
export const WALLET_ENTRY_TYPES = [
  'TOPUP', 'TASK_FREEZE', 'TASK_UNFREEZE', 'TASK_SETTLE', 'TASK_CREDIT', 'PLATFORM_FEE',
  'WITHDRAWAL_FREEZE', 'WITHDRAWAL_DEBIT', 'WITHDRAWAL_UNFREEZE',
  'SUBSCRIPTION_FEE', 'SUBSCRIPTION_INCOME', 'ADJUSTMENT',
] as const;
export type WalletEntryType = typeof WALLET_ENTRY_TYPES[number];

// ── 发布并发阶梯 ──────────────────────────────────────────────────
export const PUBLISH_TIERS = ['BASE', 'KYB', 'FUNDED', 'SUBSCRIPTION', 'OVERRIDE'] as const;
export type PublishTier = typeof PUBLISH_TIERS[number];
