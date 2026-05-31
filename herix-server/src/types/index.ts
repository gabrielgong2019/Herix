import { z } from 'zod';

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
  mode: z.enum(['STANDARD', 'PERFORMANCE']).default('STANDARD'),
  title: z.string().min(2, '标题至少2字符').max(100),
  description: z.string().min(10, '描述至少10字符'),
  requirements: z.string().optional(),
  budget: z.number().positive('预算必须大于0'),
  commission: z.number().positive('报酬必须大于0'),
  maxHeralds: z.number().int().min(1).default(1),
  deadline: z.string().optional(),
  category: z.string().optional(),
  contentType: z.enum(['photo', 'video', 'referral']).default('photo'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  coverImage: z.string().optional(),
  userBenefit: z.string().optional(),
  codeMode: z.enum(['auto', 'custom']).default('auto'),
});

export const ApplyTaskSchema = z.object({
  message: z.string().optional(),
});

export const SubmitResultSchema = z.object({
  contentUrl: z.string().url('请提供有效的内容链接'),
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
