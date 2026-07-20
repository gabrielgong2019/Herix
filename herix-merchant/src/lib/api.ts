import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'

export const http = axios.create({ baseURL: BASE, withCredentials: true })

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('herix-merchant-token')
      window.location.href = '/login'
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
}

// ── Tasks ─────────────────────────────────────────────────────────
export const tasksApi = {
  list: (params?: { status?: string; page?: number }) =>
    http.get<{ tasks: Task[]; total: number }>('/tasks', { params }),
  get: (id: string) => http.get<Task>(`/tasks/${id}`),
  create: (data: TaskFormData) => http.post<Task>('/tasks', data),
  update: (id: string, data: Partial<TaskFormData>) => http.put<Task>(`/tasks/${id}`, data),
  applications: (id: string) => http.get<Application[]>(`/tasks/${id}/applications`),
  submissions: (id: string) => http.get<Submission[]>(`/tasks/${id}/submissions`),
  approveApp: (taskId: string, appId: string) =>
    http.post(`/tasks/${taskId}/applications/${appId}/approve`),
  rejectApp: (taskId: string, appId: string) =>
    http.post(`/tasks/${taskId}/applications/${appId}/reject`),
}

// ── Reviews ───────────────────────────────────────────────────────
export const reviewsApi = {
  list: () => http.get<Submission[]>('/merchant/submissions/pending'),
  approve: (id: string) => http.post(`/submissions/${id}/approve`),
  reject: (id: string, reason?: string) => http.post(`/submissions/${id}/reject`, { reason }),
}

// ── Wallet ────────────────────────────────────────────────────────
export const walletApi = {
  balance: () => http.get<{ credits: number }>('/merchant/wallet/balance'),
  transactions: (page = 1) =>
    http.get<{ items: Transaction[]; total: number }>('/merchant/wallet/transactions', {
      params: { page },
    }),
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
  profile: () => http.get<BrandProfile>('/merchant/profile'),
  updateProfile: (data: Partial<BrandProfile>) => http.patch('/merchant/profile', data),
}

// ── Types ─────────────────────────────────────────────────────────
export interface MerchantUser {
  id: string
  email: string
  nickname?: string
  name?: string
  company_name?: string
  brandName?: string
  role?: string
  brand_onboarded?: boolean
}

export interface Task {
  id: string
  title: string
  description: string
  requirements?: string
  category: string
  mode: 'STANDARD' | 'PERFORMANCE'
  status: 'draft' | 'open' | 'completed' | 'cancelled'
  visibility: 'PUBLIC' | 'INVITE'
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  content_type: 'photo' | 'video' | 'both'
  payout_per_herald: number
  max_heralds: number
  target_communities: string[]
  cover_image?: string
  deadline?: string
  code_mode?: 'auto' | 'custom'
  data_mode?: 'AGGREGATE' | 'DETAIL'
  created_at: string
  applicant_count?: number
  approved_count?: number
}

export interface TaskFormData {
  title: string
  description: string
  requirements?: string
  category: string
  mode: 'STANDARD' | 'PERFORMANCE'
  status: 'draft' | 'open'
  visibility: 'PUBLIC' | 'INVITE'
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  contentType: 'photo' | 'video' | 'both'
  payoutPerHerald: number
  maxHeralds: number
  targetCommunities: string[]
  siteId: string
  coverImage?: string
  deadline?: string
  codeMode?: 'auto' | 'custom'
  dataMode?: 'AGGREGATE' | 'DETAIL'
}

export interface Application {
  id: string
  task_id: string
  user_id: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  herald?: { name: string; avatar?: string }
}

export interface Submission {
  id: string
  task_id: string
  user_id: string
  status: 'pending' | 'approved' | 'rejected'
  content_url?: string
  note?: string
  created_at: string
  task?: { title: string }
  herald?: { name: string }
}

export interface Transaction {
  id: string
  type: 'recharge' | 'payout' | 'refund' | 'fee'
  amount: number
  created_at: string
  note?: string
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
}
