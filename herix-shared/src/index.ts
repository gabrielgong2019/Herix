/**
 * Herix 前后端共享契约 —— 枚举/状态值的唯一事实源。
 *
 * 背景：herix-merchant / herix-miniapp / herix-server 的类型此前手写互抄或镜像，
 * 造成 difficulty 大小写漂移（UI 创建任务 100% 失败）、平台注册表镜像漂移等
 * 一整类 bug。本包是这类值的唯一定义处，三端统一从这里 import。
 *
 * 规则：
 * - 本包必须保持零依赖（纯类型 + as const 常量 + 无副作用函数），禁止 import
 *   任何业务模块（pg/express/…）
 * - ⚠️ 带「DB-CHECK」标记的枚举在 herix-server/src/db.ts 有对应 CHECK 约束——
 *   加值必须同步幂等重建约束（DROP CONSTRAINT IF EXISTS + ADD），否则运行时才炸
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
export type StandardContentType = typeof STANDARD_CONTENT_TYPES[number];

// PENDING_REVIEW（2026-07-26）：未KYB商家发布后的平台审核态（DRAFT→PENDING_REVIEW→OPEN，被拒退回DRAFT）。
// 曾用 status=OPEN + platform_review 正交列表达，导致报名接口对未过审任务放行 + 商家端显示"招募中"误导
export const TASK_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const; // DB-CHECK
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_VISIBILITIES = ['PUBLIC', 'INVITE'] as const;
export type TaskVisibility = typeof TASK_VISIBILITIES[number];

/** DB-CHECK: users.role + users_role_check */
export const USER_ROLES = ['HERALD', 'BRAND', 'ADMIN', 'PLATFORM'] as const;
export type UserRole = typeof USER_ROLES[number];

/** 资格要求满足模式（ALL=必须全满足；ANY_N=满足任意 N 项） */
export const REQ_MODES = ['ALL', 'ANY_N'] as const;
export type ReqMode = typeof REQ_MODES[number];

/** DB-CHECK: tasks 主表 + task_referral_specs 均有 CHECK */
export const CODE_MODES = ['auto', 'custom'] as const;
export type CodeMode = typeof CODE_MODES[number];

/** DB-CHECK: task_referral_specs.data_mode */
export const DATA_MODES = ['AGGREGATE', 'DETAIL'] as const;
export type DataMode = typeof DATA_MODES[number];

// ── 报名 / 交付 ────────────────────────────────────────────────────
/** DB-CHECK: task_applications_status_check（EXPIRED=名额释放，2026-07-26 加） */
export const APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

/** 两阶段交付组合态：stage × status，见 utils/submissionFlow.ts */
export const SUBMISSION_STAGES = ['DRAFT', 'FINAL'] as const;
export type SubmissionStage = typeof SUBMISSION_STAGES[number];

export const SUBMISSION_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type SubmissionStatus = typeof SUBMISSION_STATUSES[number];

/** 审核动作可选项（APPROVED/REJECTED 是 SUBMISSION_STATUSES 的子集） */
export type ReviewDecision = Extract<SubmissionStatus, 'APPROVED' | 'REJECTED'>;

// ── 订阅 / 发票 ────────────────────────────────────────────────────
export const PLAN_CODES = ['basic', 'premium', 'custom'] as const;
export type PlanCode = typeof PLAN_CODES[number];

/** DB-CHECK: merchant_subscriptions.billing_cycle */
export const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type BillingCycle = typeof BILLING_CYCLES[number];

export const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** DB-CHECK: merchant_subscriptions.status（状态机见 utils/subscriptions.ts） */
export const SUBSCRIPTION_STATUSES = ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED'] as const;
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];

/** DB-CHECK: subscription_invoices.status */
export const INVOICE_STATUSES = ['PENDING', 'PAID', 'VOID'] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

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

// ── 社交平台注册表（2026-07-29 前后端单一来源）─────────────────────
// 权威元数据：id + countLabel(数量门槛叫法) + inputType(账号ID还是主页链接)。
// UI 专属字段(icon/name/placeholder)不在契约里，由各端自行叠加。
// 加平台只改这里；服务端校验/tier、前端展示/收集都从这派生，杜绝漂移。
export const SOCIAL_PLATFORMS = [
  { id: 'wechat',      countLabel: 'friends',   inputType: 'id'  },
  { id: 'instagram',   countLabel: 'followers', inputType: 'url' },
  { id: 'xiaohongshu', countLabel: 'followers', inputType: 'url' },
  { id: 'tiktok',      countLabel: 'followers', inputType: 'url' },
  { id: 'line',        countLabel: 'friends',   inputType: 'id'  },
  { id: 'zalo',        countLabel: 'friends',   inputType: 'id'  },
  { id: 'whatsapp',    countLabel: 'friends',   inputType: 'id'  },
  { id: 'facebook',    countLabel: 'followers', inputType: 'url' },
  { id: 'youtube',     countLabel: 'followers', inputType: 'url' },
  { id: 'twitter',     countLabel: 'followers', inputType: 'url' },
] as const;
export type SocialPlatformId = typeof SOCIAL_PLATFORMS[number]['id'];
export type CountLabel = 'followers' | 'friends';
export const SOCIAL_PLATFORM_IDS: readonly string[] = SOCIAL_PLATFORMS.map(p => p.id);
/** 查平台元数据；未知 id 返回 null（调用方据此判合法性） */
export function socialPlatformMeta(id: string): { id: string; countLabel: CountLabel; inputType: 'id' | 'url' } | null {
  return (SOCIAL_PLATFORMS.find(p => p.id === id) as any) || null;
}
/** 联系类平台（好友数，非公开粉丝）——不计入 KOL 段位 */
export function isContactPlatform(id: string): boolean {
  return socialPlatformMeta(id)?.countLabel === 'friends';
}
