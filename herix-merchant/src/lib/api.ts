import axios from 'axios'
// 枚举/状态值唯一事实源：前后端共享契约（@contracts → herix-server/src/shared/contracts.ts）。
// 此前两边手写互抄导致 difficulty 大小写漂移(创建全挂)、content_type 漏值等一整类 bug
import type {
  TaskMode, Difficulty, ContentType, TaskStatus, TaskVisibility,
  SubmissionStage, BillingCycle, SubscriptionStatus, PublishTier,
} from '@contracts'

const BASE = import.meta.env.VITE_API_URL || '/api'

export const http = axios.create({ baseURL: BASE, withCredentials: true })

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('herix-merchant-token')
      window.location.href = '/merchant/login'
    }
    return Promise.reject(err)
  }
)

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('herix-merchant-token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Auth ──────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    http.post<{ token: string; user: MerchantUser }>('/auth/login', { account: email, password }),
  me: () => http.get<MerchantUser>('/auth/me'),
  sendCode: (email: string) =>
    http.post('/auth/send-code', { email, purpose: 'REGISTER' }),
  register: (data: { email: string; password: string; code: string; nickname?: string }) =>
    http.post<{ token: string }>('/auth/register', { ...data, role: 'BRAND' }),
  onboard: (data: {
    companyName: string
    industry?: string
    website?: string
    contactName: string
    contactPhone?: string
    billingEmail?: string
    companyDesc?: string
    country?: string
    isAgency?: boolean
    agreedToTerms: boolean
  }) => http.post('/users/brand/onboard', data),
}

// ── Tasks ─────────────────────────────────────────────────────────
export const tasksApi = {
  list: (params?: { status?: string; page?: number; creator?: string }) =>
    http.get<{ tasks: Task[]; total: number }>('/tasks', { params }),
  get: (id: string) => http.get<Task>(`/tasks/${id}`),
  create: (data: TaskFormData) => http.post<Task>('/tasks', data),
  update: (id: string, data: Partial<TaskFormData>) => http.put<Task>(`/tasks/${id}`, data),
  updateMeta: (id: string, data: {
    description?: string; requirements?: string; deadline?: string
    coverImage?: string; maxHeralds?: number
  }) => http.patch<Task>(`/tasks/${id}/meta`, data),
  publish: (id: string) => http.patch<{ success: boolean }>(`/tasks/${id}/publish`),
  applications: (id: string) => http.get<Application[]>(`/tasks/${id}/applications`),
  uploadCsv: (id: string, records: CsvRecord[]) =>
    http.post<CsvUploadResult>(`/tasks/${id}/csv`, { records }),
  // 提交/报名审核走服务端真实路由（2026-07-26 修契约漂移：此前 /tasks/:id/submissions
  // 和 /tasks/:id/applications/:appId/approve|reject 服务端从未实现，Tab 恒空、审核按钮 404）
  submissions: (id: string) => http.get<Submission[]>(`/submissions/task/${id}`),
  approveApp: (_taskId: string, appId: string) =>
    http.patch(`/applications/${appId}/review`, { status: 'APPROVED' }),
  rejectApp: (_taskId: string, appId: string, reviewNote?: string) =>
    http.patch(`/applications/${appId}/review`, { status: 'REJECTED', reviewNote }),
  getCodePool: (id: string) => http.get<CodePool>(`/tasks/${id}/codes`),
  uploadCustomCodes: (id: string, codes: string[]) =>
    http.post<{ added: number; skipped: number }>(`/tasks/${id}/codes/upload`, { codes }),
  // 封面走既有 multipart 端点(压缩→存文件→DB只存URL)——禁止 base64 塞 JSON：
  // express.json 100KB 上限会 413，且 base64 进 cover_image 列会拖垮所有列表接口
  uploadCover: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post<{ url: string }>(`/uploads/task/${id}/cover`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  downloadCodesUrl: (id: string) => `${BASE}/tasks/${id}/codes/export`,
  getWeappLink: (id: string) => http.get<WeappLinkResult>(`/tasks/${id}/weapp-link`),
  getWeappQrUrl: (id: string) => `${BASE}/tasks/${id}/weapp-qrcode`,
  getReferrals: (id: string) => http.get<ReferralData>(`/tasks/${id}/referrals`),
  unbindBrand: (taskId: string, userId: string) =>
    http.post(`/tasks/${taskId}/brand-unbind`, { userId }),
  partnerList: () => http.get<PartnerTask[]>('/tasks/partner/mine'),
  bindTask: (taskId: string, token: string) =>
    http.post(`/tasks/${taskId}/brand-bind`, { token }),
}

// ── Reviews ───────────────────────────────────────────────────────
export interface PendingApplication {
  id: string
  task_id: string
  herald_id: string
  message?: string | null
  created_at: string
  task_title: string
  herald_name: string
  display_name?: string | null
}

export const reviewsApi = {
  pendingApplications: () => http.get<PendingApplication[]>('/applications/pending'),
  // 2026-07-26 接到真实端点（此前 /merchant/submissions/pending 与 approve/reject POST 均不存在，页面是坏的）
  list: () => http.get<Submission[]>('/submissions/pending'),
  review: (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) =>
    http.patch(`/submissions/${id}/review`, { status, reviewNote }),
  revisions: (id: string) => http.get<SubmissionRevision[]>(`/submissions/${id}/revisions`),
  // 改稿额度用尽后的出口：开平台仲裁案（一个提交终身一案，开案期间超时计时冻结）
  arbitrate: (submissionId: string, reason: string) =>
    http.post('/arbitrations', { submissionId, reason }),
}

// ── Notifications（商家端站内信，?role=BRAND 端隔离：双角色账号不串赫使侧通知）──
export interface Notification {
  id: string
  type: string
  title: string
  body: string
  is_read: number
  metadata: string | null
  created_at: string
}
export const notificationsApi = {
  list: () => http.get<{ unread: number; notifications: Notification[] }>('/notifications?role=BRAND'),
  markRead: (id: string) => http.patch(`/notifications/${id}/read`),
  markAllRead: () => http.patch('/notifications/read-all?role=BRAND'),
}

// ── Subscriptions（营销顾问订阅：钱包余额扣款，无支付网关）──────────
export interface SubscriptionPlanInfo {
  code: string
  monthlyPrice: number | null   // null = 定制版（联系我们）
  benefits: { guaranteedTasks?: number; commissionDiscount?: number }
  pricing: { MONTHLY: number; QUARTERLY: number; ANNUAL: number } | null
}
export interface MerchantSubscription {
  id: string
  plan_code: string
  billing_cycle: BillingCycle
  price_snapshot: number
  status: SubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  auto_renew: number
  created_at: string
}
export interface SubscriptionInvoice {
  id: string
  invoice_no: string
  amount: number
  status: 'PENDING' | 'PAID' | 'VOID'
  created_at: string
  paid_at: string | null
}
export const subscriptionsApi = {
  plans: () => http.get<{ plans: SubscriptionPlanInfo[]; discounts: { quarterly: number; annual: number } }>('/subscriptions/plans'),
  mine: () => http.get<{ subscription: MerchantSubscription | null; invoices: SubscriptionInvoice[]; walletAvailable?: number }>('/subscriptions/mine'),
  subscribe: (planCode: string, billingCycle: string) =>
    http.post<{ subscription: MerchantSubscription; invoice: SubscriptionInvoice; activated: boolean; shortfall: number; walletAvailable: number }>('/subscriptions', { planCode, billingCycle }),
  setAutoRenew: (id: string, autoRenew: boolean) => http.patch(`/subscriptions/${id}/auto-renew`, { autoRenew }),
  cancel: (id: string) => http.post(`/subscriptions/${id}/cancel`),
  // 定制版洽谈：只收营销需求，公司/联系人平台已有
  submitInquiry: (data: { goals: string; budgetRange?: string; note?: string }) =>
    http.post<{ ok: boolean; existing: boolean }>('/subscriptions/inquiries', data),
  myInquiry: () => http.get<{ inquiry: { id: string; status: string; created_at: string } | null }>('/subscriptions/inquiries/mine'),
}

// ── Wallet ────────────────────────────────────────────────────────
export const walletApi = {
  brandBalance: (params?: { from?: string; to?: string }) =>
    http.get<BrandBalance>('/wallet/brand-balance', { params }),
  transactions: (params?: { from?: string; to?: string; limit?: number }) =>
    http.get<WalletLedger>('/wallet/transactions', {
      params: { walletType: 'brand', limit: 50, ...params },
    }),
  topupHistory: () => http.get<TopupRequest[]>('/wallet/topup-history'),
  submitTopup: (amount: number, note: string) =>
    http.post<{ id: string }>('/wallet/topup', { amount, note }),
}

// ── Categories / Communities / Sites ─────────────────────────────
export const metaApi = {
  categories: () => http.get<Category[]>('/categories'),
  communities: (site?: string) =>
    http.get<Community[]>('/communities', { params: site ? { site } : undefined }),
  sites: () => http.get<Site[]>('/sites'),
  platforms: () => http.get<Platform[]>('/platforms'),
}

// ── Settings ──────────────────────────────────────────────────────
export const settingsApi = {
  // profile is fetched via authApi.me() — auth/me includes all brand_profile fields
  profile: () => http.get<MerchantUser>('/auth/me'),
  updateProfile: (data: {
    companyName: string
    industry?: string
    website?: string
    contactName: string
    contactPhone?: string
    billingEmail?: string
    companyDesc?: string
  }) => http.patch('/users/profile/brand', data),
  uploadBrandAsset: (type: 'logo' | 'promo', file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post<{ url: string }>(`/uploads/brand/${type}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  uploadKybDoc: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post('/uploads/brand/kyb-doc', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

// ── Types ─────────────────────────────────────────────────────────
export interface MerchantUser {
  id: string
  email: string
  nickname?: string
  name?: string
  company_name?: string
  brand_name?: string
  contact_email?: string
  brandName?: string
  role?: string
  brand_onboarded?: boolean
  // brand_profile fields joined by auth/me
  industry?: string
  website?: string
  contact_name?: string
  contact_phone?: string
  brand_billing_email?: string
  company_desc?: string
  is_agency?: boolean
  brand_country?: string
  kyb_status?: 'none' | 'pending' | 'approved' | 'rejected'
  kyb_note?: string
  kyb_reject_reason?: string
  brand_logo_url?: string
  brand_promo_image_url?: string
}

export interface Task {
  id: string
  title: string
  description: string
  requirements?: string
  category: string
  mode: TaskMode
  status: TaskStatus | string // 服务端大写状态（历史数据可能有例外，宽松收）
  visibility: TaskVisibility
  difficulty: Difficulty
  content_type: ContentType
  payout_per_herald: number
  cost_per_herald?: number
  commission_rate?: number
  max_heralds: number
  target_communities: string[]
  platform_requirements?: string | Array<{ platformId: string; minFollowers?: number }> | null
  cover_image?: string
  deadline?: string
  code_mode?: 'auto' | 'custom'
  data_mode?: 'AGGREGATE' | 'DETAIL'
  min_images?: number | null
  min_video_seconds?: number | null
  max_revisions?: number
  require_proposal?: number
  require_draft_review?: number
  submit_deadline?: string | null
  created_at: string
  published_at?: string
  applicant_count?: number
  approved_count?: number
  upload_token?: string
  fast_payout?: boolean
  platform_review?: 'pending' | 'approved' | 'rejected'
  platform_review_note?: string
  brand_parties?: Array<{ user_id: string; nickname: string; email: string; bound_at: string }>
  applications?: Application[]
}

export interface TaskFormData {
  title: string
  description: string
  requirements?: string
  category: string
  mode: TaskMode
  status: 'draft' | 'open'  // 仅前端流程标记：发布走 PATCH /publish，服务端不读此字段
  visibility: TaskVisibility
  difficulty: Difficulty
  contentType: 'photo' | 'video' | 'both'
  payoutPerHerald: number
  maxHeralds: number
  targetCommunities: string[]
  siteId: string
  coverImage?: string
  deadline?: string
  codeMode?: 'auto' | 'custom'
  dataMode?: 'AGGREGATE' | 'DETAIL'
  minImages?: number | null
  minVideoSeconds?: number | null
  maxRevisions: number
  requireProposal: boolean
  requireDraftReview?: boolean
  submitDeadline?: string | null
}

export interface Application {
  id: string
  task_id: string
  user_id: string
  herald_id?: string
  status: string
  created_at: string
  nickname?: string
  display_name?: string
  avatar_url?: string
  herald?: { name: string; avatar?: string }
  tier_snapshot?: string
  social_platforms?: string
  community?: string
  bio?: string
  completed_tasks?: number
  good_rate?: number
  specialty_tags?: string[] | null
  proposal_text?: string | null
  proposal_links?: string | null
}

export interface Submission {
  id: string
  task_id: string
  herald_id?: string
  user_id?: string
  stage?: SubmissionStage
  status: string // 服务端大写: PENDING_REVIEW | APPROVED | REJECTED
  content_url?: string
  content_urls?: string | null // JSON 数组字符串，parseLinks() 解析
  description?: string
  screenshot_urls?: string | null
  review_note?: string
  submitted_at?: string
  created_at?: string
  task_title?: string
  herald_name?: string
  require_draft_review?: number
  max_revisions?: number
  stage_rejects?: number
  arbitration_open?: boolean
  nickname?: string
  herald?: { name: string }
  task?: { title: string }
}

export interface SubmissionRevision {
  stage: 'DRAFT' | 'FINAL'
  kind: 'SUBMIT' | 'REVIEW'
  action: string
  content_urls?: string | null
  description?: string | null
  screenshot_urls?: string | null
  note?: string | null
  created_at: string
}

/** content_urls(JSON) → 数组，回落单链接旧字段 */
export function parseLinks(sub: { content_urls?: string | null; content_url?: string | null }): string[] {
  if (sub.content_urls) { try { const a = JSON.parse(sub.content_urls); if (Array.isArray(a)) return a } catch { /* fall through */ } }
  return sub.content_url ? [sub.content_url] : []
}

export interface CodePool {
  total: number
  assigned: number
  available: number
  samples: string[]
}

export interface WeappLinkResult {
  available: boolean
  link?: string
  expiresAt?: string
  reason?: string
}

export interface ReferralRecord {
  id: string
  code: string
  user_masked: string
  registered_at: string
  converted_at?: string
  settled: boolean
  herald_name: string
}

export interface ReferralData {
  dataMode: string
  records: ReferralRecord[]
}

export interface PartnerTask {
  id: string
  title: string
  status: string
  mode: string
  data_mode?: string
  max_heralds: number
  created_at: string
  agency_name: string
  code_holders: number
  total_registered: number
  total_converted: number
}

export interface Transaction {
  id: string
  type: string
  amount: number
  created_at: string
  note?: string
}

export interface BrandBalance {
  currency: string
  available: number
  frozen: number
  periodFrom: string
  periodTo: string
  periodInflow: number
  periodOutflow: number
  credit: {
    hasToppedUp: boolean
    initialCredit: number
    creditUsed: number
    sharedUsed?: number
    creditRemaining: number
    totalCapacity: number
    trialEligible: boolean
    trialDefault: number
    fastPayoutEligible: boolean
    fastPayoutThreshold: number
  }
  publishLimit?: {
    current: number
    limit: number | null   // null = 订阅期内不限
    tier: PublishTier
    subscriptionPlan: string | null
    kybApproved?: boolean
    funded?: boolean
    baseLimit?: number
    kybLimit?: number
    fundedLimit?: number
    fundedThreshold?: number
  }
}

export interface WalletEntry {
  id: string
  type: string
  amount: number
  currency: string
  note?: string
  direction: 'in' | 'out' | 'transfer'
  created_at: string
}

export interface WalletLedger {
  transactions: WalletEntry[]
  total: number
  periodFrom: string
  periodTo: string
  periodInflow?: number
  periodOutflow?: number
}

export interface TopupRequest {
  id: string
  amount: number
  currency: string
  note?: string
  status: 'pending' | 'confirmed' | 'rejected'
  created_at: string
}

export type CsvRecord =
  | { code: string; registered_count: number; used_count: number }
  | { code: string; user: string; converted: boolean }

export interface CsvUploadResult {
  processed: number
  skipped: number
  totalPaid: number
  skippedCodes?: string[]
  blockedCodes?: string[]
  skippedHints?: Array<{ code: string; belongsTo: string }>
}

export interface Category {
  id: string
  label: string
  icon?: string
}

export interface Community {
  id: string
  labelKey: string
  region: string
}

export interface Site {
  id: string
  labelKey: string
  country: string
  currency: string
}

export interface Platform {
  id: string
  name: string
  icon?: string
}

export interface BrandProfile {
  id: string
  brand_name: string
  contact_email: string
  logo?: string
  company_name?: string
  industry?: string
  website?: string
  contact_name?: string
  contact_phone?: string
  billing_email?: string
  company_desc?: string
  is_agency?: boolean
  kyb_status?: 'none' | 'pending' | 'approved' | 'rejected'
  kyb_reject_reason?: string
}
