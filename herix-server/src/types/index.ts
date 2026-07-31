import { z } from 'zod';
// 枚举唯一事实源：shared/contracts.ts（前后端共享，勿在此处重复字面量）
import { TASK_MODES, CONTENT_TYPES, DIFFICULTIES, TASK_VISIBILITIES, SOCIAL_PLATFORM_IDS } from '../shared/contracts';
import { LOCALE_CODES } from '../constants/locales';

// ── 段位阈值（粉丝数） ──
export const TIER_THRESHOLDS = {
  NANO:  { label: 'Nano',  max: 1_000 },
  MICRO: { label: 'Micro', min: 1_000,   max: 10_000 },
  MID:   { label: 'Mid',   min: 10_000,  max: 100_000 },
  MACRO: { label: 'Macro', min: 100_000 },
} as const;

export function calcTier(followers: number): string {
  if (followers < TIER_THRESHOLDS.NANO.max)  return 'Nano';
  if (followers < TIER_THRESHOLDS.MICRO.max) return 'Micro';
  if (followers < TIER_THRESHOLDS.MID.max)   return 'Mid';
  return 'Macro';
}

// ── 评级等级 ──
export const RATING_LEVELS = [
  { name: 'Platinum', minTasks: 50, minGoodRate: 0.95 },
  { name: 'Gold',     minTasks: 25, minGoodRate: 0.85 },
  { name: 'Silver',   minTasks: 10, minGoodRate: 0.75 },
  { name: 'Bronze',   minTasks: 3,  minGoodRate: 0.60 },
] as const; // 从高到低排列，取第一个满足的

export function calcRatingLevel(completedTasks: number, goodRate: number): string {
  for (const level of RATING_LEVELS) {
    if (completedTasks >= level.minTasks && goodRate >= level.minGoodRate) {
      return level.name;
    }
  }
  return 'Unrated';
}

// ── Auth ──

export const RegisterSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6, '密码至少6位'),
  nickname: z.string().optional(),
  role: z.enum(['BRAND', 'HERALD']).default('HERALD'),
}).refine(data => data.phone || data.email, {
  message: '手机号或邮箱至少填一个',
});

export const LoginSchema = z.object({
  account: z.string(),  // 手机号或邮箱
  password: z.string(),
});

// ── 任务 ──

export const CreateTaskSchema = z.object({
  mode: z.enum(TASK_MODES).default('STANDARD'),
  sourceLang: z.enum(LOCALE_CODES).default('zh'),
  title: z.string().min(2, '标题至少2字符').max(100),
  description: z.string().min(10, '描述至少10字符'),
  requirements: z.string().optional(),
  payoutPerHerald: z.number().positive('赫使报酬必须大于0'),
  maxHeralds: z.number().int().min(0).default(1),
  deadline: z.string().optional(),
  category: z.string().min(1, '请选择任务分类'),
  contentType: z.enum(CONTENT_TYPES).default('photo'),
  difficulty: z.enum(DIFFICULTIES).default('easy'),
  // 拒绝 base64 dataURL：封面必须走 /uploads/task/:id/cover multipart(压缩+存文件+DB只存URL)，
  // base64 进 JSON 会撞 express.json 100KB 上限(413)，进 DB 会拖垮所有任务列表接口(2026-07-20 实测)
  coverImage: z.string().refine((v) => !v.startsWith('data:'), { message: '封面请使用图片上传接口，不支持 base64 内嵌' }).optional(),
  userBenefit: z.string().optional(),
  codeMode: z.enum(['auto', 'custom']).default('auto'),
  visibility: z.enum(TASK_VISIBILITIES).default('PUBLIC'),
  platformRequirements: z.array(z.object({
    platformId: z.string().refine((id) => SOCIAL_PLATFORM_IDS.includes(id), { message: '未知社交平台' }),
    minFollowers: z.number().int().min(0).nullish(),
    required: z.boolean().default(true),
  })).optional(),
  // 资格要求满足模式：ALL=required项全须满足；ANY_N=列出项满足任意 reqMinCount 项即可（此模式下忽略单项 required 标志）
  reqMode: z.enum(['ALL', 'ANY_N']).default('ALL'),
  reqMinCount: z.number().int().min(1).optional(),
  // 数据回传模式（仅 PERFORMANCE 有意义）：AGGREGATE=累计计数；DETAIL=逐用户明细。发布后锁定
  dataMode: z.enum(['AGGREGATE', 'DETAIL']).default('AGGREGATE'),
  // 社群定向：空数组=全员可见
  targetCommunities: z.array(z.string()).default([]),
  // 站点归属：任务属于哪个运营站点，赫使按站点过滤
  siteId: z.string().default('jp'),
  // 任务发布标准化
  minImages: z.number().int().min(1).optional(),
  minVideoSeconds: z.number().int().min(1).optional(),
  maxRevisions: z.number().int().min(0).max(20).default(2),
  // 草稿前置(2026-07-26 opt-in)：开启后须先过草稿审核才能提交最终链接
  requireDraftReview: z.boolean().default(false),
  requireProposal: z.boolean().default(false),
  submitDeadline: z.string().optional(),
});

export const ApplyTaskSchema = z.object({
  message: z.string().optional(),
  proposalText: z.string().optional(),
  proposalLinks: z.array(z.string()).optional(),
});

export const SubmitResultSchema = z.object({
  // 两阶段交付(2026-07-26)：contentUrls 为权威(终稿≥1，路由层按阶段校验)；
  // contentUrl 为旧版 weapp 单链接兼容入参，服务端归一化进 contentUrls
  contentUrl: z.string().url('请提供有效的内容链接').optional(),
  contentUrls: z.array(z.string().url('请提供有效的内容链接')).max(10, '链接最多 10 个').optional(),
  description: z.string().optional(),
  screenshotUrls: z.array(z.string()).optional(),
});

export const ReviewSubmissionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().optional(),
});

// ── 用户资料 ──

export const UpdateBrandProfileSchema = z.object({
  companyName: z.string().min(1),
  companyDesc: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  contactName: z.string().min(1),
  contactPhone: z.string().optional(),
  billingEmail: z.string().email().optional().or(z.literal('')),
  defaultLang: z.enum(LOCALE_CODES).optional(),
});

export const UpdateHeraldProfileSchema = z.object({
  displayName: z.string().min(1),
  bio: z.string().optional(),
  country: z.string().optional(),
  diasporaGroup: z.string().optional(),
  socialPlatforms: z.array(z.object({
    platform: z.string(),
    url: z.string(),
    followers: z.number().int().optional(),
  })).optional(),
  specialties: z.array(z.string()).optional(),
});
