import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, metaApi, walletApi, settingsApi, type TaskFormData, type Task, type BrandBalance } from '@/lib/api'
import { extractBrief, type ExtractHit } from '@/lib/extract'
import { DIFFICULTIES } from '@contracts'
import { Topbar } from '@/components/layout/Topbar'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, ImagePlus, X } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────

// 与 herix-server/src/constants/locales.ts 保持同步（新增语言两处均需更新）
const LOCALE_OPTIONS = [
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt' },
]

function detectLang(text: string): string | null {
  let ja = 0, ko = 0, zh = 0, en = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp >= 0x3040 && cp <= 0x30ff) ja++       // 平假名 + 片假名 → 日文独有
    else if (cp >= 0xac00 && cp <= 0xd7af) ko++   // 韩文字母
    else if (cp >= 0x4e00 && cp <= 0x9fff) zh++   // CJK（中日共用，无日文假名时判中文）
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) en++
  }
  const total = ja + ko + zh + en
  if (total < 8) return null
  if (ja > 2) return 'ja'          // 只要有平假名/片假名就是日文
  if (ko / total > 0.1) return 'ko'
  if (zh / total > 0.15) return 'zh'
  if (en / total > 0.5) return 'en'
  return null
}

// hasFollowers 区分两类要求：有粉丝概念的可选填粉丝门槛；联系类(微信/LINE等)只有"必须绑定"。
// 与 herix-miniapp/src/utils/platforms.ts 保持一致（新增平台两处同步）
// countLabel 区分数量门槛叫法：内容平台=粉丝数，联系平台=好友数。与 miniapp platforms.ts 对齐
const PLATFORMS: { id: string; name: string; icon: string; countLabel: 'followers' | 'friends' }[] = [
  { id: 'xiaohongshu', name: '小红书', icon: '📕', countLabel: 'followers' },
  { id: 'instagram', name: 'Instagram', icon: '📸', countLabel: 'followers' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', countLabel: 'followers' },
  { id: 'youtube', name: 'YouTube', icon: '▶️', countLabel: 'followers' },
  { id: 'twitter', name: 'X/Twitter', icon: '𝕏', countLabel: 'followers' },
  { id: 'facebook', name: 'Facebook', icon: '📘', countLabel: 'followers' },
  { id: 'wechat', name: '微信', icon: '💬', countLabel: 'friends' },
  { id: 'line', name: 'LINE', icon: '💚', countLabel: 'friends' },
  { id: 'zalo', name: 'Zalo', icon: '🔵', countLabel: 'friends' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '📱', countLabel: 'friends' },
]

const PLATFORM_FEE_RATE = 0.2
// 与服务端 MAX_CUSTOM_CODES_PER_UPLOAD 同步（herix-server/src/routes/tasks.ts）
const MAX_CUSTOM_CODES = 2000
const AVG_CONVERSIONS_PER_CODE = 5

/** 平台要求实时摘要文案（ALL：必须/展示两组；ANY_N：候选池+需满足数） */
function platformReqSummary(form: FormState, t: (k: string, params?: Record<string, unknown>) => string): string {
  const nameOf = (id: string) => PLATFORMS.find((p) => p.id === id)?.name || id
  const fmt = (r: FormState['platformRequirements'][number]) =>
    `${nameOf(r.platformId)}${r.minFollowers ? ` ≥${r.minFollowers}` : ''}`
  if (form.reqMode === 'ANY_N') {
    return t('taskForm.summaryAnyN', {
      n: form.reqMinCount, total: form.platformRequirements.length,
      list: form.platformRequirements.map(fmt).join('、'),
    })
  }
  const required = form.platformRequirements.filter((r) => r.required)
  const optional = form.platformRequirements.filter((r) => !r.required)
  const parts: string[] = []
  if (required.length) parts.push(t('taskForm.summaryRequired', { list: required.map(fmt).join('、') }))
  if (optional.length) parts.push(t('taskForm.summaryOptional', { list: optional.map(fmt).join('、') }))
  return parts.join(' · ')
}

// ── Sub-components ────────────────────────────────────────────────

function SectionHeader({ num, title, hint }: { num: number; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-4 mb-6">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5"
        style={{ background: 'var(--primary)', color: '#fff' }}
      >
        {num}
      </div>
      <div>
        <div className="text-base font-semibold" style={{ color: 'var(--text)' }}>{title}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{hint}</div>
      </div>
    </div>
  )
}

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="mb-5">
      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
        {label}
        {required && <span className="ml-1" style={{ color: 'var(--primary)' }}>*</span>}
        {hint && <span className="ml-2 font-normal text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors',
        'focus:border-current',
        props.className,
      )}
      style={{ borderColor: 'var(--border)', background: '#fff', ...props.style }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; props.onFocus?.(e) }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; props.onBlur?.(e) }}
    />
  )
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn('w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors resize-none', props.className)}
      style={{ borderColor: 'var(--border)', background: '#fff', ...props.style }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--primary)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn('w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-white', props.className)}
      style={{ borderColor: 'var(--border)', ...props.style }}
    />
  )
}

function Chip({
  label, selected, onClick,
}: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer"
      style={
        selected
          ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }
          : { background: '#fff', color: 'var(--text)', borderColor: 'var(--border)' }
      }
    >
      {label}
    </button>
  )
}

function RadioCard({
  selected, onClick, title, desc,
}: { selected: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 text-left p-4 rounded-xl border-2 transition-all cursor-pointer"
      style={
        selected
          ? { borderColor: 'var(--primary)', background: 'var(--primary-light)' }
          : { borderColor: 'var(--border)', background: '#fff' }
      }
    >
      <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{title}</div>
      <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{desc}</div>
    </button>
  )
}

// ── Cost preview panel ────────────────────────────────────────────

// ── 标准任务：确定性成本，发布时锁定金额 ────────────────────────────
function StandardCostPreview({ payout, maxHeralds, balance, t }: {
  payout: number; maxHeralds: number
  balance?: BrandBalance
  t: (k: string, params?: Record<string, unknown>) => string
}) {
  if (!payout || !maxHeralds) return null
  const base = payout * maxHeralds
  const fee = Math.ceil(base * PLATFORM_FEE_RATE)
  const total = base + fee

  const credit = balance?.credit
  const trialGrant = credit?.trialEligible ? Math.min(credit.trialDefault, total) : 0
  const capacity = credit ? credit.totalCapacity + trialGrant : null
  const short = capacity !== null && total > capacity

  return (
    <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--primary-light)', border: '1px solid #f7c4bb' }}>
      <div className="text-xs font-semibold mb-3" style={{ color: 'var(--primary)' }}>{t('taskForm.costPreview')}</div>
      <div className="space-y-1.5">
        {[
          { label: `${t('taskForm.costBase')} (${maxHeralds} ${t('taskForm.costPerHerald')})`, value: `¥${base.toLocaleString()}` },
          { label: t('taskForm.costFee'), value: `¥${fee.toLocaleString()}` },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs" style={{ color: 'var(--text)' }}>
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <span>{value}</span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-bold pt-2 border-t mt-2" style={{ borderColor: '#f7c4bb', color: 'var(--text)' }}>
          <span>{t('taskForm.costTotal')}</span>
          <span style={{ color: 'var(--primary)' }}>¥{total.toLocaleString()}</span>
        </div>
        {capacity !== null && (
          <>
            <div className="flex justify-between text-xs pt-1" style={{ color: short ? 'var(--danger)' : 'var(--muted)' }}>
              <span>
                {t('taskForm.capacityLine')}
                {trialGrant > 0 && <span> · {t('taskForm.capacityTrial', { amount: trialGrant.toLocaleString() })}</span>}
              </span>
              <span className="font-semibold">¥{capacity.toLocaleString()}</span>
            </div>
            {short && (
              <div className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                {t('taskForm.capacityShort', { amount: (total - capacity).toLocaleString() })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── 邀请码任务：概率估算，按转化实时结算 ────────────────────────────
function PerformanceBudgetEstimate({ payout, codeCount, t }: {
  payout: number; codeCount: number
  t: (k: string, params?: Record<string, unknown>) => string
}) {
  if (!payout || !codeCount) return null
  const estConversions = codeCount * AVG_CONVERSIONS_PER_CODE
  const estPayout = payout * estConversions
  const estFee = Math.ceil(estPayout * PLATFORM_FEE_RATE)
  const estTotal = estPayout + estFee

  return (
    <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--primary-light)', border: '1px solid #f7c4bb' }}>
      <div className="text-xs font-semibold mb-3" style={{ color: 'var(--primary)' }}>{t('taskForm.perfEstTitle')}</div>
      <div className="space-y-1.5">
        {[
          { label: t('taskForm.perfEstCodesRow', { codes: codeCount, convs: estConversions }), value: `${estConversions} ${t('taskForm.perfEstConvUnit')}` },
          { label: t('taskForm.perfEstPayoutRow'), value: `¥${estPayout.toLocaleString()}` },
          { label: t('taskForm.costFee'), value: `¥${estFee.toLocaleString()}` },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs" style={{ color: 'var(--text)' }}>
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <span>{value}</span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-bold pt-2 border-t mt-2" style={{ borderColor: '#f7c4bb', color: 'var(--text)' }}>
          <span>{t('taskForm.perfEstTotal')}</span>
          <span style={{ color: 'var(--primary)' }}>¥{estTotal.toLocaleString()}</span>
        </div>
        <div className="text-xs pt-1" style={{ color: 'var(--muted)' }}>{t('taskForm.perfEstNote')}</div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────

interface FormState {
  title: string
  description: string
  category: string
  siteId: string
  targetCommunities: string[]
  platformRequirements: Array<{ platformId: string; minFollowers: number | ''; required: boolean }>
  reqMode: 'ALL' | 'ANY_N'
  reqMinCount: number
  // ⚠️ 小写——服务端 zod 枚举与 DB 均为小写；此前写大写 'MEDIUM' 导致从 UI 创建任务
  // 100% 被 400 拒（2026-07-26 用户报"带图保存失败"排查出，实与图片无关）
  difficulty: 'easy' | 'medium' | 'hard'
  contentType: 'photo' | 'video' | 'both'
  requirements: string
  coverImage: string
  payoutPerHerald: number | ''
  maxHeralds: number | ''
  deadline: string
  visibility: 'PUBLIC' | 'INVITE'
  mode: 'STANDARD' | 'PERFORMANCE'
  codeMode: 'auto' | 'custom'
  dataMode: 'AGGREGATE' | 'DETAIL'
  conversionRegisterLabel: string
  conversionConvert: string[]
  inviteeBenefit: string
  referralScript: string
  minImages: number | ''
  minVideoSeconds: number | ''
  maxRevisions: number
  requireProposal: boolean
  requireDraftReview: boolean
  submitDeadline: string
  customCodes: string
  sourceLang: string
}

const DEFAULT_STATE: FormState = {
  title: '', description: '', category: 'food',
  siteId: 'jp',
  targetCommunities: [], platformRequirements: [], reqMode: 'ALL', reqMinCount: 1,
  difficulty: 'medium', contentType: 'photo',
  requirements: '', coverImage: '',
  payoutPerHerald: '', maxHeralds: '',
  deadline: '', visibility: 'PUBLIC',
  mode: 'STANDARD', codeMode: 'auto', dataMode: 'AGGREGATE',
  conversionRegisterLabel: '新用户（此前未注册过）', conversionConvert: [''], inviteeBenefit: '', referralScript: '',
  minImages: '', minVideoSeconds: '', maxRevisions: 2, requireProposal: false, requireDraftReview: false, submitDeadline: '',
  customCodes: '',
  sourceLang: 'zh',
}

function parseTaskPlatformRequirements(raw: Task['platform_requirements']): FormState['platformRequirements'] {
  if (!raw) return []
  let arr: Array<{ platformId: string; minFollowers?: number | null; required?: boolean }> = []
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return [] }
  return arr.filter((r) => r.platformId).map((r) => ({
    platformId: r.platformId,
    minFollowers: r.minFollowers != null ? r.minFollowers : '',
    required: r.required !== false,
  }))
}

function taskToFormState(task: Task): FormState {
  return {
    title: task.title,
    // 简报合并（2026-07-25）：存量任务的 requirements 并入简报展示，编辑保存后只写 description
    description: task.requirements ? `${task.description}\n\n${task.requirements}` : task.description,
    category: task.category,
    siteId: (task as any).site_id || 'jp',
    targetCommunities: task.target_communities || [],
    platformRequirements: parseTaskPlatformRequirements(task.platform_requirements),
    reqMode: task.req_mode === 'ANY_N' ? 'ANY_N' : 'ALL',
    reqMinCount: task.req_min_count || 1,
    difficulty: task.difficulty,
    contentType: task.content_type === 'referral' ? 'photo' : task.content_type, // referral=邀请码占位值，表单无此选项
    requirements: task.requirements || '',
    coverImage: task.cover_image || '',
    payoutPerHerald: task.payout_per_herald,
    maxHeralds: task.max_heralds,
    deadline: task.deadline ? task.deadline.slice(0, 10) : '',
    visibility: task.visibility,
    mode: task.mode,
    codeMode: task.code_mode || 'auto',
    dataMode: task.data_mode || 'AGGREGATE',
    conversionRegisterLabel: task.conversion_criteria?.register?.label || '新用户（此前未注册过）',
    conversionConvert: task.conversion_criteria?.convert?.length ? task.conversion_criteria.convert : [''],
    inviteeBenefit: task.invitee_benefit || '',
    referralScript: task.referral_script || '',
    minImages: task.min_images || '',
    minVideoSeconds: task.min_video_seconds || '',
    maxRevisions: task.max_revisions ?? 2,
    requireProposal: !!(task.require_proposal),
    requireDraftReview: !!(task.require_draft_review),
    submitDeadline: task.submit_deadline ? task.submit_deadline.slice(0, 10) : '',
    customCodes: '',
    sourceLang: task.source_lang || 'zh',
  }
}

export default function TaskForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const fromOnboard = searchParams.get('from') === 'onboard'
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState<FormState>(DEFAULT_STATE)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState('')
  // 类型是第一分叉：创建时先整屏选类型(step 0)，选完才渲染表单；编辑/复制态跳过
  const copyId = searchParams.get('copy')
  const [typeChosen, setTypeChosen] = useState(isEdit || !!copyId)
  // 需求单提取（建议式）：识别结果在面板确认后才应用
  const [extracted, setExtracted] = useState<ExtractHit[] | null>(null)
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [langMismatch, setLangMismatch] = useState<string | null>(null) // 检测到的语言（与 sourceLang 不符时设置）
  const [pendingStatus, setPendingStatus] = useState<'draft' | 'open' | null>(null)

  const isStandard = form.mode === 'STANDARD'
  const isCustomCodes = !isStandard && form.codeMode === 'custom'
  // custom 模式：招募名额由码数量决定，表单不单独填写
  const customCodeList = isCustomCodes
    ? form.customCodes.split('\n').map((s) => s.trim()).filter(Boolean)
    : []
  const effectiveMaxHeralds = isCustomCodes ? customCodeList.length : Number(form.maxHeralds) || 0

  // 当前可发布额度（成本预览里对比展示；发布闸在服务端，这里只是预警）
  const { data: brandProfile } = useQuery({
    queryKey: ['brandProfile'],
    queryFn: () => settingsApi.profile().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const { data: brandBalance } = useQuery({
    queryKey: ['brandBalance'],
    queryFn: () => walletApi.brandBalance().then((r) => r.data),
  })

  // 两类型统一 1-5 段：简报 → 找谁 → 类型专属 → 时间线 → 报酬与质量
  const sn = { brief: 1, target: 2, spec: 3, time: 4, payout: 5 }

  // 标题占位统一用通用示例（2026-07-26 用户反馈：曾按站点×语言拼"在日华人/
  // Filipinos in Japan"等族群提示，平台社群匹配非精确承诺，整套 AUDIENCE_HINT 机制删除）

  // Meta queries
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => metaApi.categories().then((r) => r.data) })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => metaApi.sites().then((r) => r.data) })
  const { data: communities = [] } = useQuery({
    queryKey: ['communities', form.siteId],
    queryFn: () => metaApi.communities(form.siteId).then((r) => r.data),
  })

  const { data: existingTask } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!).then((r) => r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existingTask) setForm(taskToFormState(existingTask))
  }, [existingTask])

  // 新建任务：从商家 profile 的 default_lang 预填源语言
  useEffect(() => {
    if (!isEdit && !copyId && brandProfile?.default_lang) {
      setForm((prev) => ({ ...prev, sourceLang: brandProfile.default_lang! }))
    }
  }, [brandProfile, isEdit, copyId])

  // 复制任务：按白名单预填（排除日期与推广码——那些是每期不同的）
  const { data: copySource } = useQuery({
    queryKey: ['task', copyId],
    queryFn: () => tasksApi.get(copyId!).then((r) => r.data),
    enabled: !!copyId && !isEdit,
  })
  useEffect(() => {
    if (!copySource) return
    const src = taskToFormState(copySource)
    setForm({ ...src, deadline: '', submitDeadline: '', customCodes: '', codeMode: 'auto' })
  }, [copySource])

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((prev) => {
      if (key === 'siteId') return { ...prev, [key]: val, targetCommunities: [] }
      return { ...prev, [key]: val }
    })
    setError('')
  }, [])

  // 封面原始文件：dataURL(form.coverImage)仅用于本地预览，真正上传走 multipart(见 saveMut)
  const coverFileRef = useRef<File | null>(null)

  const toggleList = useCallback((key: 'targetCommunities', val: string) => {
    setForm((prev) => {
      const list = prev[key] as string[]
      return { ...prev, [key]: list.includes(val) ? list.filter((x) => x !== val) : [...list, val] }
    })
  }, [])

  // 平台要求：加入/移除 + 单项粉丝数/必须开关（2026-07-27 补——此前 chip 选完从不提交，是无效 UI）
  const togglePlatformReq = useCallback((platformId: string) => {
    setForm((prev) => {
      const exists = prev.platformRequirements.some((r) => r.platformId === platformId)
      const list = exists
        ? prev.platformRequirements.filter((r) => r.platformId !== platformId)
        : [...prev.platformRequirements, { platformId, minFollowers: '' as const, required: true }]
      const reqMinCount = prev.reqMode === 'ANY_N' ? Math.min(prev.reqMinCount, Math.max(1, list.length)) : prev.reqMinCount
      return { ...prev, platformRequirements: list, reqMinCount }
    })
  }, [])
  const updatePlatformReq = useCallback((platformId: string, patch: Partial<{ minFollowers: number | ''; required: boolean }>) => {
    setForm((prev) => ({
      ...prev,
      platformRequirements: prev.platformRequirements.map((r) => r.platformId === platformId ? { ...r, ...patch } : r),
    }))
  }, [])

  // Mutations
  const saveMut = useMutation({
    mutationFn: async (status: 'draft' | 'open') => {
      const payload: TaskFormData = {
        title: form.title,
        description: form.description,
        category: form.category,
        mode: form.mode,
        status,
        visibility: form.visibility,
        difficulty: form.difficulty,
        contentType: form.contentType,
        payoutPerHerald: Number(form.payoutPerHerald),
        maxHeralds: effectiveMaxHeralds,
        targetCommunities: form.targetCommunities,
        siteId: form.siteId,
        sourceLang: form.sourceLang,
        // dataURL 不进 JSON(413+DB膨胀双坑)；编辑态已有的服务器 URL 原样保留
        coverImage: form.coverImage && !form.coverImage.startsWith('data:') ? form.coverImage : undefined,
        deadline: form.deadline || undefined,
        codeMode: form.mode === 'PERFORMANCE' ? form.codeMode : undefined,
        dataMode: form.mode === 'PERFORMANCE' ? form.dataMode : undefined,
        conversionCriteria: form.mode === 'PERFORMANCE' ? {
          register: { label: form.conversionRegisterLabel.trim() || '新用户', required: true },
          convert: form.conversionConvert.map(c => c.trim()).filter(Boolean),
        } : undefined,
        inviteeBenefit: form.mode === 'PERFORMANCE' ? (form.inviteeBenefit.trim() || undefined) : undefined,
        referralScript: form.mode === 'PERFORMANCE' ? (form.referralScript.trim() || undefined) : undefined,
        minImages: form.minImages ? Number(form.minImages) : undefined,
        minVideoSeconds: form.minVideoSeconds ? Number(form.minVideoSeconds) : undefined,
        maxRevisions: form.maxRevisions,
        requireProposal: form.requireProposal,
        requireDraftReview: form.requireDraftReview,
        submitDeadline: form.submitDeadline || undefined,
        platformRequirements: form.platformRequirements.length
          ? form.platformRequirements.map((r) => ({
              platformId: r.platformId,
              minFollowers: r.minFollowers === '' ? undefined : Number(r.minFollowers),
              required: form.reqMode === 'ANY_N' ? true : r.required, // ANY_N 模式服务端忽略单项 required，统一传 true
            }))
          : undefined,
        reqMode: form.platformRequirements.length ? form.reqMode : undefined,
        reqMinCount: form.reqMode === 'ANY_N' ? form.reqMinCount : undefined,
      }
      const res = isEdit ? await tasksApi.update(id!, payload) : await tasksApi.create(payload)
      const taskId = isEdit ? id! : (res.data as Task).id
      if (coverFileRef.current) {
        await tasksApi.uploadCover(taskId, coverFileRef.current)
        coverFileRef.current = null
      }
      if (isCustomCodes && customCodeList.length > 0) {
        await tasksApi.uploadCustomCodes(taskId, customCodeList)
      }
      // 「发布任务」= 保存 + 走发布闸（并发/额度/审核门都在服务端 publish 端点）。
      // 此前只保存不发布——发布按钮从未真正发布过任何任务（2026-07-26 用户报编辑页点发布状态不变）
      if (status === 'open') {
        try {
          await tasksApi.publish(taskId)
        } catch (e: unknown) {
          // 内容已存为草稿；发布被拦的原因带到详情页展示（那里有完整的 402 升级引导）。
          // ⚠️ 必须返回 published:false 阻止 onSuccess 的列表页跳转覆盖这里的导航
          const resp = (e as { response?: { data?: { error?: string; code?: string } } })?.response?.data
          navigate(`/tasks/${taskId}`, { state: { publishError: resp?.error || t('taskForm.submitFailed'), publishErrorCode: resp?.code } })
          return { published: false }
        }
      }
      return { published: true }
    },
    onSuccess: (r) => {
      // staleTime 30s：状态/额度都变了，相关缓存全部失效，否则发布后点进详情30秒内仍显示草稿态
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task'] })
      qc.invalidateQueries({ queryKey: ['wallet-balance'] })
      if (r && r.published === false) return // 发布被拦：已跳详情页展示原因，别覆盖导航
      navigate(fromOnboard ? '/' : '/tasks')
    },
    onError: (e: unknown) => {
      // 透出服务端真实原因（zod details / error 字符串），不再吞成笼统文案——
      // 2026-07-26 前此处把"描述至少10字符"等校验错误全吞成"提交失败，请稍后重试"
      const resp = (e as { response?: { data?: { error?: string; details?: Array<{ message?: string }> } } })?.response?.data
      const detailMsg = resp?.details?.map((d) => d.message).filter(Boolean).join('；')
      setError(detailMsg || resp?.error || t('taskForm.submitFailed'))
    },
  })

  const validate = (status: 'draft' | 'open') => {
    if (!form.title.trim()) { setError(t('taskForm.errorTitle')); return false }
    if (form.mode === 'STANDARD' && form.description.trim().length < 10) { setError(t('taskForm.errorDesc')); return false }
    if (!form.payoutPerHerald) { setError(t('taskForm.errorPayout')); return false }
    if (!isCustomCodes && !form.maxHeralds) { setError(t('taskForm.errorMaxHeralds')); return false }
    // 发布必须有封面（服务端 publish 闸同款规则，前端先挡一道）；存草稿不强制
    if (status === 'open' && !form.coverImage && !coverFileRef.current) { setError(t('taskForm.errorCover')); return false }
    if (isCustomCodes && customCodeList.length === 0) { setError(t('taskForm.errorCustomCodes')); return false }
    if (isCustomCodes && customCodeList.length > MAX_CUSTOM_CODES) { setError(t('taskForm.errorTooManyCodes', { n: customCodeList.length, max: MAX_CUSTOM_CODES })); return false }
    return true
  }

  const handleSubmit = (status: 'draft' | 'open') => {
    if (!validate(status)) return
    // 语言一致性检测：扫描标题+正文，若与选择的 sourceLang 不符则先弹确认
    if (!langMismatch) {
      const text = `${form.title} ${form.description}`.trim()
      const detected = detectLang(text)
      if (detected && detected !== form.sourceLang) {
        setLangMismatch(detected)
        setPendingStatus(status)
        return
      }
    }
    saveMut.mutate(status)
  }

  // 封面上传块（2026-07-29 用户决策：所有任务类型发布必填）——两种任务类型共用，
  // 此前只在内容任务分支渲染，邀请码任务压根没有上传入口
  const coverField = (
    <Field label={t('taskForm.fieldCover')} hint={t('taskForm.fieldCoverHint')}>
      <div
        className="relative rounded-xl border-2 border-dashed overflow-hidden cursor-pointer transition-colors"
        style={{
          borderColor: 'var(--border)', aspectRatio: '16/7',
          background: form.coverImage ? 'transparent' : '#fafafa',
        }}
        onClick={() => document.getElementById('cover-input')?.click()}
      >
        {form.coverImage ? (
          <>
            <img src={form.coverImage} className="w-full h-full object-cover" alt="cover" />
            <button
              type="button"
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white"
              onClick={(e) => { e.stopPropagation(); set('coverImage', ''); coverFileRef.current = null }}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
            <ImagePlus size={24} />
            <span className="text-xs">{t('taskForm.coverClickUpload')}</span>
          </div>
        )}
      </div>
      <input
        id="cover-input" type="file" accept="image/*" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            coverFileRef.current = file
            const reader = new FileReader()
            reader.onload = (ev) => set('coverImage', ev.target?.result as string)
            reader.readAsDataURL(file)
          }
        }}
      />
    </Field>
  )

  const pageTitle = fromOnboard ? t('taskForm.onboardTitle') : isEdit ? t('taskForm.editTitle') : t('taskForm.createTitle')

  const currentSite = sites.find((s) => s.id === form.siteId)
  const siteName = currentSite ? t(`site.${currentSite.id}`, { defaultValue: currentSite.id }) : t(`site.${form.siteId}`, { defaultValue: form.siteId })

  // ── Step 0：类型是第一分叉，选完才进表单（2026-07-25 方案） ──
  if (!typeChosen) {
    return (
      <div className="flex flex-col min-h-screen">
        <Topbar title={pageTitle} />
        <div className="flex-1 flex items-center justify-center p-7">
          <div className="w-full max-w-[640px]">
            <div className="text-center mb-8">
              <div className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>{t('taskForm.typeStepTitle')}</div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('taskForm.typeStepHint')}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {([
                { mode: 'STANDARD' as const, icon: '📝', title: t('taskForm.modeStandard'), desc: t('taskForm.modeStandardDesc') },
                { mode: 'PERFORMANCE' as const, icon: '🔗', title: t('taskForm.modePerformance'), desc: t('taskForm.modePerformanceDesc') },
              ]).map((c) => (
                <button
                  key={c.mode}
                  type="button"
                  className="rounded-2xl p-7 text-left transition-all hover:-translate-y-0.5"
                  style={{ background: '#fff', border: '2px solid var(--border)', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }}
                  onClick={() => { set('mode', c.mode); setTypeChosen(true) }}
                >
                  <div className="text-3xl mb-3">{c.icon}</div>
                  <div className="text-base font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{c.title}</div>
                  <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{c.desc}</div>
                </button>
              ))}
            </div>
            {fromOnboard && (
              <div className="text-center mt-6">
                <button type="button" className="text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => navigate('/')}>
                  {t('taskForm.skipForNow')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={pageTitle} />

      <div className="flex-1 p-7">
        <div className="max-w-[680px] mx-auto">

          {/* Site badge */}
          <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: 'var(--muted)' }}>
            <span>📍</span>
            <span>{t('taskForm.fieldSite', '发布站点')}：</span>
            <span
              className="px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
            >
              {siteName}
            </span>
          </div>

          {/* 类型徽章（step 0 已选定；发布后类型本就不可改，创建期可返回重选） */}
          <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: 'var(--muted)' }}>
            <span>{isStandard ? '📝' : '🔗'}</span>
            <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              {isStandard ? t('taskForm.modeStandard') : t('taskForm.modePerformance')}
            </span>
            {!isEdit && (
              <button type="button" className="underline" style={{ color: 'var(--muted)' }} onClick={() => setTypeChosen(false)}>
                {t('taskForm.typeChange')}
              </button>
            )}
          </div>

          {/* SECTION 1: 任务简报（brief-first：商家的起点是手里那份需求单） */}
          <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
            <SectionHeader num={sn.brief} title={t('taskForm.secBriefTitle')} hint={t('taskForm.secBriefHint')} />

            {/* 原文语言 — 写作前确认，发布后锁定 */}
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{t('taskForm.fieldSourceLang')}：</span>
              {showLangPicker ? (
                <>
                  {LOCALE_OPTIONS.map((l) => (
                    <Chip
                      key={l.code}
                      label={l.label}
                      selected={form.sourceLang === l.code}
                      onClick={() => { set('sourceLang', l.code); setShowLangPicker(false); setLangMismatch(null); }}
                    />
                  ))}
                  <button type="button" onClick={() => setShowLangPicker(false)} style={{ color: 'var(--muted)' }}>
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="text-xs flex items-center gap-1 font-medium"
                    style={{ color: 'var(--primary)' }}
                    onClick={() => setShowLangPicker(true)}
                  >
                    {LOCALE_OPTIONS.find((l) => l.code === form.sourceLang)?.label ?? '中文'}
                    <ChevronDown size={12} />
                  </button>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{t('taskForm.fieldSourceLangHint')}</span>
                </>
              )}
            </div>

            {/* 语言不一致确认条 */}
            {langMismatch && (() => {
              const detectedLabel = LOCALE_OPTIONS.find((l) => l.code === langMismatch)?.label ?? langMismatch
              const selectedLabel = LOCALE_OPTIONS.find((l) => l.code === form.sourceLang)?.label ?? form.sourceLang
              return (
                <div className="mb-4 rounded-xl p-4 flex flex-col gap-3" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                  <p className="text-sm" style={{ color: '#92400e' }}>
                    检测到内容为 <strong>{detectedLabel}</strong>，但原文语言设置为 <strong>{selectedLabel}</strong>。源语言设置不准确将影响翻译质量，建议与内容保持一致。
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: 'var(--primary)', color: '#fff' }}
                      onClick={() => {
                        set('sourceLang', langMismatch)
                        setLangMismatch(null)
                        if (pendingStatus) saveMut.mutate(pendingStatus)
                      }}
                    >
                      切换为{detectedLabel}并继续
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg text-xs border font-medium"
                      style={{ borderColor: '#fde68a', background: '#fff', color: '#92400e' }}
                      onClick={() => {
                        setLangMismatch(null)
                        if (pendingStatus) saveMut.mutate(pendingStatus)
                      }}
                    >
                      保持{selectedLabel}继续
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ color: 'var(--muted)' }}
                      onClick={() => { setLangMismatch(null); setPendingStatus(null); }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )
            })()}

            <Field label={t('taskForm.fieldTitle')} required>
              <Input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder={t('taskForm.fieldTitlePh')}
              />
            </Field>

            <Field label={t('taskForm.fieldBrief')}>
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={7}
                placeholder={t(isStandard ? 'taskForm.fieldBriefPh' : 'taskForm.fieldBriefPhPerf')}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                  style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--primary)' }}
                  onClick={() => {
                    const hits = extractBrief(form.description, form.mode)
                    setExtracted(hits)
                  }}
                >
                  ✨ {t('taskForm.extractBtn')}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{t('taskForm.extractHint')}</span>
              </div>

              {extracted !== null && (
                <div className="mt-3 rounded-xl p-4" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                  {extracted.length === 0 ? (
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('taskForm.extractNone')}</div>
                  ) : (
                    <>
                      <div className="text-xs font-semibold mb-2" style={{ color: '#0369a1' }}>{t('taskForm.extractFound')}</div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {extracted.map((h) => (
                          <span key={h.field} className="px-2 py-1 rounded-md text-xs" style={{ background: '#fff', border: '1px solid #bae6fd', color: 'var(--text)' }}>
                            {t(h.labelKey)}{h.display ? `: ${h.display}` : ''}
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: 'var(--primary)', color: '#fff' }}
                          onClick={() => {
                            const patch = extracted.reduce((acc, h) => ({ ...acc, ...h.patch }), {})
                            setForm((prev) => ({ ...prev, ...patch }))
                            setExtracted(null)
                          }}
                        >
                          {t('taskForm.extractApply')}
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg text-xs border"
                          style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--muted)' }}
                          onClick={() => setExtracted(null)}
                        >
                          {t('taskForm.extractDismiss')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </Field>

          </div>

          {/* SECTION 2: Who do you want */}
          <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
            <SectionHeader num={sn.target} title={t('taskForm.sec2Title')} hint={t('taskForm.sec2Hint')} />

            <Field label={t('taskForm.fieldCategory')}>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={t(`category.${c.id}`, { defaultValue: c.label })}
                    selected={form.category === c.id}
                    onClick={() => set('category', c.id)}
                  />
                ))}
              </div>
            </Field>

            <Field label={t('taskForm.fieldCommunity')} hint={t('taskForm.fieldCommunityHint')}>
              <div className="flex flex-wrap gap-2">
                {communities.map((c) => (
                  <Chip
                    key={c.id}
                    label={t(`community.${c.id}`, { defaultValue: c.id })}
                    selected={form.targetCommunities.includes(c.id)}
                    onClick={() => toggleList('targetCommunities', c.id)}
                  />
                ))}
              </div>
            </Field>

            {isStandard && <Field label={t('taskForm.fieldPlatform')} hint={t('taskForm.fieldPlatformHint')}>
              <div className="flex flex-wrap gap-2 mb-3">
                {PLATFORMS.map((p) => {
                  const active = form.platformRequirements.some((r) => r.platformId === p.id)
                  return (
                    <Chip
                      key={p.id}
                      label={`${p.icon} ${p.name}`}
                      selected={active}
                      onClick={() => togglePlatformReq(p.id)}
                    />
                  )
                })}
              </div>

              {form.platformRequirements.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  {form.platformRequirements.map((r, i) => {
                    const meta = PLATFORMS.find((p) => p.id === r.platformId)
                    return (
                      <div key={r.platformId} className="flex items-center gap-3 px-3 py-2.5"
                        style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, background: '#fafafa' }}>
                        <span className="text-sm font-medium flex-shrink-0" style={{ minWidth: 92 }}>
                          {meta ? `${meta.icon} ${meta.name}` : r.platformId}
                        </span>
                        {/* 数量门槛选填：内容平台填粉丝数、联系平台填好友数；不填=只要求绑定 */}
                        <input
                          type="number" min={0}
                          placeholder={t(meta?.countLabel === 'friends' ? 'taskForm.minFriendsPlaceholder' : 'taskForm.minFollowersPlaceholder')}
                          value={r.minFollowers}
                          onChange={(e) => updatePlatformReq(r.platformId, { minFollowers: e.target.value === '' ? '' : Number(e.target.value) })}
                          className="text-sm rounded-lg"
                          style={{ width: 130, padding: '6px 10px', border: '1px solid var(--border)', background: '#fff' }}
                        />
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer flex-shrink-0" style={{ color: 'var(--muted)' }}>
                          <input type="checkbox" checked={r.required}
                            disabled={form.reqMode === 'ANY_N'}
                            onChange={(e) => updatePlatformReq(r.platformId, { required: e.target.checked })} />
                          {t('taskForm.requiredToggle')}
                        </label>
                        <button type="button" onClick={() => togglePlatformReq(r.platformId)}
                          className="ml-auto text-xs" style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          {t('common.remove')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {form.platformRequirements.length >= 2 && (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{t('taskForm.reqModeLabel')}</span>
                  <Chip label={t('taskForm.reqModeAll')} selected={form.reqMode === 'ALL'} onClick={() => set('reqMode', 'ALL')} />
                  <Chip
                    label={t('taskForm.reqModeAnyN', { n: form.reqMinCount, total: form.platformRequirements.length })}
                    selected={form.reqMode === 'ANY_N'}
                    onClick={() => set('reqMode', 'ANY_N')}
                  />
                  {form.reqMode === 'ANY_N' && (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => set('reqMinCount', Math.max(1, form.reqMinCount - 1))}
                        style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>−</button>
                      <span className="text-sm font-semibold" style={{ minWidth: 16, textAlign: 'center' }}>{form.reqMinCount}</span>
                      <button type="button" onClick={() => set('reqMinCount', Math.min(form.platformRequirements.length, form.reqMinCount + 1))}
                        style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>+</button>
                    </div>
                  )}
                </div>
              )}

              {form.platformRequirements.length > 0 && (
                <div className="mt-2.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {platformReqSummary(form, t)}
                </div>
              )}
            </Field>}

            <Field label={t('taskForm.fieldDifficulty')}>
              <div className="flex gap-3">
                {DIFFICULTIES.map((d) => (
                  <Chip
                    key={d}
                    label={t(`taskForm.diff${d[0].toUpperCase()}${d.slice(1)}`)}
                    selected={form.difficulty === d}
                    onClick={() => set('difficulty', d)}
                  />
                ))}
              </div>
            </Field>
          </div>

          {/* SECTION 3a: What they do — STANDARD only */}
          {isStandard && (
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={sn.spec} title={t('taskForm.sec3Title')} hint={t('taskForm.sec3Hint')} />

              <Field label={t('taskForm.fieldContentType')}>
                <div className="flex gap-3">
                  {[
                    { val: 'photo', label: t('taskForm.ctPhoto') },
                    { val: 'video', label: t('taskForm.ctVideo') },
                    { val: 'both', label: t('taskForm.ctBoth') },
                  ].map(({ val, label }) => (
                    <Chip
                      key={val}
                      label={label}
                      selected={form.contentType === val}
                      onClick={() => set('contentType', val as FormState['contentType'])}
                    />
                  ))}
                </div>
              </Field>

              {(form.contentType === 'photo' || form.contentType === 'both') && (
                <Field label={t('taskForm.fieldMinImages')}>
                  <Input
                    type="number" min={1}
                    value={form.minImages}
                    onChange={(e) => set('minImages', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="3"
                    style={{ maxWidth: 160 }}
                  />
                </Field>
              )}
              {(form.contentType === 'video' || form.contentType === 'both') && (
                <Field label={t('taskForm.fieldMinVideoSecs')}>
                  <Input
                    type="number" min={1}
                    value={form.minVideoSeconds}
                    onChange={(e) => set('minVideoSeconds', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="30"
                    style={{ maxWidth: 160 }}
                  />
                </Field>
              )}

              <Field label={t('taskForm.fieldRequireDraft')}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.requireDraftReview}
                    onChange={(e) => set('requireDraftReview', e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-sm" style={{ color: 'var(--text)' }}>{t('taskForm.requireDraftDesc')}</span>
                </label>
                {!!form.requireDraftReview && (
                  <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                    {t('taskForm.requireDraftHint')}
                  </div>
                )}
              </Field>

              {coverField}
            </div>
          )}

          {/* SECTION 3b: Referral code setup — PERFORMANCE only */}
          {!isStandard && (
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={sn.spec} title={t('taskForm.sec3PerfTitle')} hint={t('taskForm.sec3PerfHint')} />

              {coverField}

              {/* 合格转化条件：决定后续结算纠纷，重点引导 + 实时预览赫使视角 */}
              <Field label={t('taskForm.conversionTitle')} hint={t('taskForm.conversionHint')}>
                <div className="mb-2">
                  <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t('taskForm.registerLabel')}</div>
                  <input value={form.conversionRegisterLabel}
                    onChange={(e) => set('conversionRegisterLabel', e.target.value)}
                    className="w-full text-sm rounded-lg" style={{ padding: '8px 12px', border: '1px solid var(--border)' }} />
                </div>
                <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t('taskForm.convertLabel')}</div>
                {form.conversionConvert.map((line, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input value={line} placeholder={t('taskForm.convertPh')}
                      onChange={(e) => { const a = [...form.conversionConvert]; a[i] = e.target.value; set('conversionConvert', a) }}
                      className="flex-1 text-sm rounded-lg" style={{ padding: '8px 12px', border: '1px solid var(--border)' }} />
                    <button type="button" style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={() => { const a = form.conversionConvert.filter((_, j) => j !== i); set('conversionConvert', a.length ? a : ['']) }}>✕</button>
                  </div>
                ))}
                <button type="button" style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
                  onClick={() => set('conversionConvert', [...form.conversionConvert, ''])}>＋ {t('taskForm.convertAdd')}</button>
                <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>{t('taskForm.previewLabel')}</div>
                  <div className="text-sm">☑️ {form.conversionRegisterLabel.trim() || '新用户'}</div>
                  {form.conversionConvert.map(c => c.trim()).filter(Boolean).map((c, i) => (
                    <div key={i} className="text-sm">☑️ {c}</div>
                  ))}
                  {form.conversionConvert.map(c => c.trim()).filter(Boolean).length === 0 && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{t('taskForm.previewRegisterOnly')}</div>
                  )}
                </div>
              </Field>

              <Field label={t('taskForm.inviteeBenefitLabel')} hint={t('taskForm.inviteeBenefitHint')}>
                <input value={form.inviteeBenefit} onChange={(e) => set('inviteeBenefit', e.target.value)}
                  placeholder={t('taskForm.inviteeBenefitPh')}
                  className="w-full text-sm rounded-lg" style={{ padding: '8px 12px', border: '1px solid var(--border)' }} />
              </Field>

              <Field label={t('taskForm.referralScriptLabel')} hint={t('taskForm.referralScriptHint')}>
                <Textarea value={form.referralScript} onChange={(e) => set('referralScript', e.target.value)}
                  rows={3} placeholder={t('taskForm.referralScriptPh')} />
              </Field>

              <Field label={t('taskForm.fieldCodeSource')}>
                <div className="flex flex-col gap-2">
                  {(['auto', 'custom'] as const).map((m) => (
                    <label key={m} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio" name="codeMode" value={m}
                        checked={form.codeMode === m}
                        onChange={() => set('codeMode', m)}
                      />
                      {t(`taskForm.code${m[0].toUpperCase()}${m.slice(1)}`)}
                    </label>
                  ))}
                </div>
              </Field>

              {form.codeMode === 'custom' && (
                <Field label={t('taskForm.customCodesLabel')} hint={t('taskForm.customCodesHint')}>
                  <Textarea
                    value={form.customCodes}
                    onChange={(e) => set('customCodes', e.target.value)}
                    rows={6}
                    placeholder={t('taskForm.customCodesPh')}
                    style={{ fontFamily: 'monospace', fontSize: 13 }}
                  />
                  {customCodeList.length > 0 && (
                    <div className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                      {customCodeList.length} 个推广码
                    </div>
                  )}
                </Field>
              )}

              <Field label={t('taskForm.fieldDataMode')}>
                <div className="flex gap-3">
                  {(['AGGREGATE', 'DETAIL'] as const).map((m) => (
                    <RadioCard
                      key={m}
                      selected={form.dataMode === m}
                      onClick={() => set('dataMode', m)}
                      title={t(`taskForm.dataMode${m[0]}${m.slice(1).toLowerCase()}`)}
                      desc={t(`taskForm.dataMode${m[0]}${m.slice(1).toLowerCase()}Desc`)}
                    />
                  ))}
                </div>
              </Field>
            </div>
          )}

          {/* SECTION 4: 时间线（报名截止 + 交稿截止） */}
          <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
            <SectionHeader num={sn.time} title={t('taskForm.secTimeTitle')} hint={t('taskForm.secTimeHint')} />

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('taskForm.fieldDeadline')} hint={t('taskForm.fieldDeadlineHint')}>
                <Input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => set('deadline', e.target.value)}
                />
              </Field>
              {isStandard && (
                <Field label={t('taskForm.fieldSubmitDeadline')} hint={t('taskForm.fieldDeadlineHint')}>
                  <Input
                    type="date"
                    value={form.submitDeadline}
                    onChange={(e) => set('submitDeadline', e.target.value)}
                  />
                </Field>
              )}
            </div>
          </div>

          {/* SECTION 5: 报酬与质量 */}
          <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
            <SectionHeader num={sn.payout} title={t('taskForm.sec4Title')} hint={t('taskForm.sec4Hint')} />

            {isStandard
              ? <StandardCostPreview payout={Number(form.payoutPerHerald) || 0} maxHeralds={effectiveMaxHeralds} balance={brandBalance} t={t} />
              : <PerformanceBudgetEstimate payout={Number(form.payoutPerHerald) || 0} codeCount={effectiveMaxHeralds} t={t} />
            }

            <div className={`grid gap-4 ${isCustomCodes ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <Field label={t('taskForm.fieldPayout')} required hint={t('taskForm.fieldPayoutUnit')}>
                <Input
                  type="number"
                  min={0}
                  value={form.payoutPerHerald}
                  onChange={(e) => set('payoutPerHerald', e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                />
              </Field>
              {!isCustomCodes && (
                <Field label={t('taskForm.fieldMaxHeralds')} required>
                  <Input
                    type="number"
                    min={1}
                    value={form.maxHeralds}
                    onChange={(e) => set('maxHeralds', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="10"
                  />
                </Field>
              )}
            </div>

            {isStandard && (
              <>
                <Field label={t('taskForm.fieldMaxRevisions')}>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number" min={0} max={20}
                      value={form.maxRevisions}
                      onChange={(e) => set('maxRevisions', Number(e.target.value))}
                      style={{ maxWidth: 120 }}
                    />
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{t('taskForm.fieldMaxRevisionsUnit')}</span>
                  </div>
                  {form.maxRevisions > 2 && (
                    <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: '#fef3c7', color: '#92400e' }}>
                      {t('taskForm.warnRevisions')}
                    </div>
                  )}
                </Field>

                <Field label={t('taskForm.fieldRequireProposal')}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.requireProposal}
                      onChange={(e) => set('requireProposal', e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-sm" style={{ color: 'var(--text)' }}>{t('taskForm.requireProposalDesc')}</span>
                  </label>
                </Field>
              </>
            )}
          </div>

          {/* ADVANCED (collapsible) — visibility only */}
          <div className="rounded-2xl overflow-hidden mb-6" style={{ background: '#fff' }}>
            <button
              type="button"
              className="w-full flex items-center justify-between px-6 py-4 cursor-pointer"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
                {t('taskForm.advancedTitle')}
              </span>
              {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {advancedOpen && (
              <div className="px-6 pb-6 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="pt-5">
                  <Field label={t('taskForm.fieldVisibility')}>
                    <Select value={form.visibility} onChange={(e) => set('visibility', e.target.value as FormState['visibility'])}>
                      <option value="PUBLIC">{t('taskForm.visPublic')}</option>
                      <option value="INVITE">{t('taskForm.visInvite')}</option>
                    </Select>
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* Error + Actions */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: '#fee2e2', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end">
            {fromOnboard ? (
              <button
                type="button"
                className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors"
                style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--muted)' }}
                onClick={() => navigate('/')}
              >
                {t('taskForm.skipForNow')}
              </button>
            ) : (
              // 按钮层级（2026-07-26 用户反馈灰字像禁用）：取消=放弃动作 muted 灰，
              // 保存草稿=有效次级动作黑字黑描边，发布=主色。灰字是 disabled 的视觉语言
              <button
                type="button"
                className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors"
                style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--muted)' }}
                onClick={() => navigate('/tasks')}
              >
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors"
              style={{ borderColor: 'var(--text)', background: '#fff', color: 'var(--text)' }}
              onClick={() => handleSubmit('draft')}
              disabled={saveMut.isPending}
            >
              {t('taskForm.saveDraft')}
            </button>
            <button
              type="button"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: 'var(--primary)', color: '#fff' }}
              onClick={() => handleSubmit('open')}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? t('common.loading') : fromOnboard ? t('taskForm.publishAndEnter') : t('taskForm.publishTask')}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
