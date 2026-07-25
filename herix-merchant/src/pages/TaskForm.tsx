import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, metaApi, type TaskFormData, type Task } from '@/lib/api'
import { extractBrief, type ExtractHit } from '@/lib/extract'
import { Topbar } from '@/components/layout/Topbar'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, ImagePlus, X } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────

const PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书', icon: '📕' },
  { id: 'instagram', name: 'Instagram', icon: '📸' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'youtube', name: 'YouTube', icon: '▶️' },
  { id: 'twitter', name: 'X/Twitter', icon: '𝕏' },
  { id: 'facebook', name: 'Facebook', icon: '📘' },
]

const PLATFORM_FEE_RATE = 0.2

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

function CostPreview({ payout, maxHeralds, t }: { payout: number; maxHeralds: number; t: (k: string) => string }) {
  const base = payout * maxHeralds
  const fee = Math.ceil(base * PLATFORM_FEE_RATE)
  const total = base + fee

  if (!payout || !maxHeralds) return null

  return (
    <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--primary-light)', border: '1px solid #f7c4bb' }}>
      <div className="text-xs font-semibold mb-3" style={{ color: 'var(--primary)' }}>
        {t('taskForm.costPreview')}
      </div>
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
  platforms: string[]
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
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
  minImages: number | ''
  minVideoSeconds: number | ''
  maxRevisions: number
  requireProposal: boolean
  submitDeadline: string
  customCodes: string
}

const DEFAULT_STATE: FormState = {
  title: '', description: '', category: 'food',
  siteId: 'jp',
  targetCommunities: [], platforms: [],
  difficulty: 'MEDIUM', contentType: 'photo',
  requirements: '', coverImage: '',
  payoutPerHerald: '', maxHeralds: '',
  deadline: '', visibility: 'PUBLIC',
  mode: 'STANDARD', codeMode: 'auto', dataMode: 'AGGREGATE',
  minImages: '', minVideoSeconds: '', maxRevisions: 2, requireProposal: false, submitDeadline: '',
  customCodes: '',
}

function taskToFormState(task: Task): FormState {
  return {
    title: task.title,
    // 简报合并（2026-07-25）：存量任务的 requirements 并入简报展示，编辑保存后只写 description
    description: task.requirements ? `${task.description}\n\n${task.requirements}` : task.description,
    category: task.category,
    siteId: (task as any).site_id || 'jp',
    targetCommunities: task.target_communities || [],
    platforms: [],
    difficulty: task.difficulty,
    contentType: task.content_type,
    requirements: task.requirements || '',
    coverImage: task.cover_image || '',
    payoutPerHerald: task.payout_per_herald,
    maxHeralds: task.max_heralds,
    deadline: task.deadline ? task.deadline.slice(0, 10) : '',
    visibility: task.visibility,
    mode: task.mode,
    codeMode: task.code_mode || 'auto',
    dataMode: task.data_mode || 'AGGREGATE',
    minImages: task.min_images || '',
    minVideoSeconds: task.min_video_seconds || '',
    maxRevisions: task.max_revisions ?? 2,
    requireProposal: !!(task.require_proposal),
    submitDeadline: task.submit_deadline ? task.submit_deadline.slice(0, 10) : '',
    customCodes: '',
  }
}

export default function TaskForm() {
  const { t, i18n } = useTranslation()
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

  const isStandard = form.mode === 'STANDARD'
  // 两类型统一 1-5 段：简报 → 找谁 → 类型专属 → 时间线 → 报酬与质量
  const sn = { brief: 1, target: 2, spec: 3, time: 4, payout: 5 }

  // Dynamic title placeholder: siteId × UI language → primary audience hint
  const AUDIENCE_HINT: Record<string, Record<string, string>> = {
    jp: { zh: '在日华人', en: 'Filipinos in Japan', ja: '在日外国人', ko: '재일 한국인' },
    au: { zh: '在澳华人', en: 'Chinese in Australia', ja: '在豪外国人', ko: '호주 한인' },
    us: { zh: '在美华人', en: 'Chinese in the US',   ja: '在米外国人', ko: '미주 한인' },
    ca: { zh: '加拿大华人', en: 'Chinese in Canada', ja: '在カナダ外国人', ko: '캐나다 한인' },
    uk: { zh: '英国华人', en: 'Chinese in the UK',   ja: '在英外国人', ko: 'UK 한인' },
    sg: { zh: '新加坡华人', en: 'Chinese in Singapore', ja: '在シンガポール外国人', ko: '싱가포르 한인' },
  }
  const lang = i18n.language?.split('-')[0] || 'zh'
  const audienceHint = AUDIENCE_HINT[form.siteId]?.[lang]
  const titlePlaceholder = audienceHint
    ? t('taskForm.fieldTitlePhDynamic', { audience: audienceHint })
    : t('taskForm.fieldTitlePh')

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

  const toggleList = useCallback((key: 'targetCommunities' | 'platforms', val: string) => {
    setForm((prev) => {
      const list = prev[key] as string[]
      return { ...prev, [key]: list.includes(val) ? list.filter((x) => x !== val) : [...list, val] }
    })
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
        maxHeralds: Number(form.maxHeralds),
        targetCommunities: form.targetCommunities,
        siteId: form.siteId,
        // dataURL 不进 JSON(413+DB膨胀双坑)；编辑态已有的服务器 URL 原样保留
        coverImage: form.coverImage && !form.coverImage.startsWith('data:') ? form.coverImage : undefined,
        deadline: form.deadline || undefined,
        codeMode: form.mode === 'PERFORMANCE' ? form.codeMode : undefined,
        dataMode: form.mode === 'PERFORMANCE' ? form.dataMode : undefined,
        minImages: form.minImages ? Number(form.minImages) : undefined,
        minVideoSeconds: form.minVideoSeconds ? Number(form.minVideoSeconds) : undefined,
        maxRevisions: form.maxRevisions,
        requireProposal: form.requireProposal,
        submitDeadline: form.submitDeadline || undefined,
      }
      const res = isEdit ? await tasksApi.update(id!, payload) : await tasksApi.create(payload)
      if (coverFileRef.current) {
        const taskIdForCover = isEdit ? id! : (res.data as Task).id
        await tasksApi.uploadCover(taskIdForCover, coverFileRef.current)
        coverFileRef.current = null
      }
      if (form.mode === 'PERFORMANCE' && form.codeMode === 'custom') {
        const codes = form.customCodes.split('\n').map((s) => s.trim()).filter(Boolean)
        if (codes.length > 0) {
          const taskId = isEdit ? id! : (res.data as Task).id
          await tasksApi.uploadCustomCodes(taskId, codes)
        }
      }
      return res
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      navigate(fromOnboard ? '/' : '/tasks')
    },
    onError: () => setError('提交失败，请稍后重试'),
  })

  const validate = () => {
    if (!form.title.trim()) { setError(t('taskForm.errorTitle')); return false }
    if (!form.payoutPerHerald) { setError(t('taskForm.errorPayout')); return false }
    if (!form.maxHeralds) { setError(t('taskForm.errorMaxHeralds')); return false }
    if (form.mode === 'PERFORMANCE' && form.codeMode === 'custom') {
      const codes = form.customCodes.split('\n').map((s) => s.trim()).filter(Boolean)
      if (codes.length === 0) { setError(t('taskForm.errorCustomCodes')); return false }
    }
    return true
  }

  const handleSubmit = (status: 'draft' | 'open') => {
    if (!validate()) return
    saveMut.mutate(status)
  }

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

            <Field label={t('taskForm.fieldTitle')} required>
              <Input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder={titlePlaceholder}
              />
            </Field>

            <Field label={t('taskForm.fieldBrief')}>
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={7}
                placeholder={t('taskForm.fieldBriefPh')}
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

            <Field label={t('taskForm.fieldPlatform')}>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <Chip
                    key={p.id}
                    label={`${p.icon} ${p.name}`}
                    selected={form.platforms.includes(p.id)}
                    onClick={() => toggleList('platforms', p.id)}
                  />
                ))}
              </div>
            </Field>

            <Field label={t('taskForm.fieldDifficulty')}>
              <div className="flex gap-3">
                {(['EASY', 'MEDIUM', 'HARD'] as const).map((d) => (
                  <Chip
                    key={d}
                    label={t(`taskForm.diff${d[0]}${d.slice(1).toLowerCase()}`)}
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
                      <span className="text-xs">点击上传封面图</span>
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
            </div>
          )}

          {/* SECTION 3b: Referral code setup — PERFORMANCE only */}
          {!isStandard && (
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={sn.spec} title={t('taskForm.sec3PerfTitle')} hint={t('taskForm.sec3PerfHint')} />

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
                  {form.customCodes.trim() && (
                    <div className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                      {form.customCodes.split('\n').map((s) => s.trim()).filter(Boolean).length} 个推广码
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

            <CostPreview
              payout={Number(form.payoutPerHerald) || 0}
              maxHeralds={Number(form.maxHeralds) || 0}
              t={t}
            />

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('taskForm.fieldPayout')} required hint={t('taskForm.fieldPayoutUnit')}>
                <Input
                  type="number"
                  min={0}
                  value={form.payoutPerHerald}
                  onChange={(e) => set('payoutPerHerald', e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                />
              </Field>
              <Field label={t('taskForm.fieldMaxHeralds')} required>
                <Input
                  type="number"
                  min={1}
                  value={form.maxHeralds}
                  onChange={(e) => set('maxHeralds', e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="10"
                />
              </Field>
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
              <button
                type="button"
                className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors"
                style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--text)' }}
                onClick={() => navigate('/tasks')}
              >
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors"
              style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--muted)' }}
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
