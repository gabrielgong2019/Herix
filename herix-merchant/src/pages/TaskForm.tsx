import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, metaApi, type TaskFormData, type Task } from '@/lib/api'
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
}

function taskToFormState(task: Task): FormState {
  return {
    title: task.title,
    description: task.description,
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

  // Meta queries
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => metaApi.categories().then((r) => r.data) })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => metaApi.sites().then((r) => r.data) })
  // Communities filtered by selected site — re-fetch when site changes
  const { data: communities = [] } = useQuery({
    queryKey: ['communities', form.siteId],
    queryFn: () => metaApi.communities(form.siteId).then((r) => r.data),
  })

  // Edit mode: load existing task
  const { data: existingTask } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!).then((r) => r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existingTask) setForm(taskToFormState(existingTask))
  }, [existingTask])

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((prev) => {
      // 切换站点时清空社群选择（旧站点的社群在新站点无效）
      if (key === 'siteId') return { ...prev, [key]: val, targetCommunities: [] }
      return { ...prev, [key]: val }
    })
    setError('')
  }, [])

  const toggleList = useCallback((key: 'targetCommunities' | 'platforms', val: string) => {
    setForm((prev) => {
      const list = prev[key] as string[]
      return { ...prev, [key]: list.includes(val) ? list.filter((x) => x !== val) : [...list, val] }
    })
  }, [])

  // Mutations
  const saveMut = useMutation({
    mutationFn: (status: 'draft' | 'open') => {
      const payload: TaskFormData = {
        title: form.title,
        description: form.description,
        requirements: form.requirements || undefined,
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
        coverImage: form.coverImage || undefined,
        deadline: form.deadline || undefined,
        codeMode: form.mode === 'PERFORMANCE' ? form.codeMode : undefined,
        dataMode: form.mode === 'PERFORMANCE' ? form.dataMode : undefined,
        minImages: form.minImages ? Number(form.minImages) : undefined,
        minVideoSeconds: form.minVideoSeconds ? Number(form.minVideoSeconds) : undefined,
        maxRevisions: form.maxRevisions,
        requireProposal: form.requireProposal,
        submitDeadline: form.submitDeadline || undefined,
      }
      return isEdit ? tasksApi.update(id!, payload) : tasksApi.create(payload)
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
    return true
  }

  const handleSubmit = (status: 'draft' | 'open') => {
    if (!validate()) return
    saveMut.mutate(status)
  }

  const pageTitle = fromOnboard ? t('taskForm.onboardTitle') : isEdit ? t('taskForm.editTitle') : t('taskForm.createTitle')

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={pageTitle} />

      <div className="flex-1 p-7">
        <div className="flex gap-6 items-start max-w-[1100px] mx-auto">

          {/* ── Form ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* SECTION 1: What is the task */}
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={1} title={t('taskForm.sec1Title')} hint={t('taskForm.sec1Hint')} />

              <Field label={t('taskForm.fieldTitle')} required>
                <Input
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder={t('taskForm.fieldTitlePh')}
                />
              </Field>

              <Field label={t('taskForm.fieldDesc')}>
                <Textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  rows={3}
                  placeholder={t('taskForm.fieldDescPh')}
                />
              </Field>

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
            </div>

            {/* SECTION 2: Who do you want */}
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={2} title={t('taskForm.sec2Title')} hint={t('taskForm.sec2Hint')} />

              <Field label={t('taskForm.fieldSite', '发布站点')} required hint={t('taskForm.fieldSiteHint', '赫使按站点过滤任务')}>
                <div className="flex flex-wrap gap-2">
                  {sites.map((s) => (
                    <Chip
                      key={s.id}
                      label={t(`site.${s.id}`, { defaultValue: s.id })}
                      selected={form.siteId === s.id}
                      onClick={() => set('siteId', s.id)}
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

            {/* SECTION 3: What they do */}
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={3} title={t('taskForm.sec3Title')} hint={t('taskForm.sec3Hint')} />

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

              <Field label={t('taskForm.fieldRequirements')}>
                <Textarea
                  value={form.requirements}
                  onChange={(e) => set('requirements', e.target.value)}
                  rows={4}
                  placeholder={t('taskForm.fieldRequirementsPh')}
                />
              </Field>

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
                        onClick={(e) => { e.stopPropagation(); set('coverImage', '') }}
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
                      const reader = new FileReader()
                      reader.onload = (ev) => set('coverImage', ev.target?.result as string)
                      reader.readAsDataURL(file)
                    }
                  }}
                />
              </Field>
            </div>

            {/* SECTION 4: Payout & Schedule */}
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={4} title={t('taskForm.sec4Title')} hint={t('taskForm.sec4Hint')} />

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

              <Field label={t('taskForm.fieldDeadline')} hint={t('taskForm.fieldDeadlineHint')}>
                <Input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => set('deadline', e.target.value)}
                  style={{ maxWidth: 220 }}
                />
              </Field>
            </div>

            {/* SECTION 5: 合作规则 */}
            <div className="rounded-2xl p-6 mb-4" style={{ background: '#fff' }}>
              <SectionHeader num={5} title={t('taskForm.sec5Title')} hint={t('taskForm.sec5Hint')} />

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

              <Field label={t('taskForm.fieldSubmitDeadline')} hint={t('taskForm.fieldDeadlineHint')}>
                <Input
                  type="date"
                  value={form.submitDeadline}
                  onChange={(e) => set('submitDeadline', e.target.value)}
                  style={{ maxWidth: 220 }}
                />
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
            </div>

            {/* ADVANCED (collapsible) */}
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
                  <div className="pt-5 mb-5">
                    <div className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>
                      {t('taskForm.fieldMode')}
                    </div>
                    <div className="flex gap-3">
                      <RadioCard
                        selected={form.mode === 'STANDARD'}
                        onClick={() => set('mode', 'STANDARD')}
                        title={t('taskForm.modeStandard')}
                        desc={t('taskForm.modeStandardDesc')}
                      />
                      <RadioCard
                        selected={form.mode === 'PERFORMANCE'}
                        onClick={() => set('mode', 'PERFORMANCE')}
                        title={t('taskForm.modePerformance')}
                        desc={t('taskForm.modePerformanceDesc')}
                      />
                    </div>
                  </div>

                  <Field label={t('taskForm.fieldVisibility')}>
                    <Select value={form.visibility} onChange={(e) => set('visibility', e.target.value as FormState['visibility'])}>
                      <option value="PUBLIC">{t('taskForm.visPublic')}</option>
                      <option value="INVITE">{t('taskForm.visInvite')}</option>
                    </Select>
                  </Field>

                  {form.mode === 'PERFORMANCE' && (
                    <>
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
                    </>
                  )}
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

          {/* ── Sticky Preview Panel ─────────────────────────────── */}
          <div className="w-72 flex-shrink-0 sticky top-20">
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--muted)' }}>
              {t('taskForm.previewTitle')}
            </div>
            <div className="rounded-2xl overflow-hidden shadow-md" style={{ background: '#fff' }}>
              {form.coverImage && (
                <img src={form.coverImage} className="w-full object-cover" style={{ aspectRatio: '16/9' }} alt="" />
              )}
              <div className="p-4">
                <div className="text-xs mb-2">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-medium mr-1"
                    style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                  >
                    {t(`category.${form.category}`, { defaultValue: form.category })}
                  </span>
                  <span className="text-gray-400">
                    {form.difficulty === 'EASY' ? t('taskForm.diffEasy') : form.difficulty === 'MEDIUM' ? t('taskForm.diffMedium') : t('taskForm.diffHard')}
                  </span>
                </div>
                <div className="text-sm font-semibold mb-1.5 leading-snug" style={{ color: 'var(--text)' }}>
                  {form.title || '任务标题'}
                </div>
                {form.description && (
                  <div className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {form.description}
                  </div>
                )}
                {form.targetCommunities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {form.targetCommunities.map((cid) => (
                      <span key={cid} className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f0f9ff', color: '#0369a1' }}>
                        {t(`community.${cid}`, { defaultValue: cid })}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className="flex items-center justify-between pt-3 border-t"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div>
                    <div className="text-base font-bold" style={{ color: 'var(--primary)' }}>
                      {form.payoutPerHerald ? `¥${Number(form.payoutPerHerald).toLocaleString()}` : '¥--'}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>/ 人</div>
                  </div>
                  <div
                    className="px-4 py-2 rounded-full text-xs font-semibold"
                    style={{ background: 'var(--primary)', color: '#fff' }}
                  >
                    立即报名
                  </div>
                </div>
              </div>
            </div>
            {form.maxHeralds && form.payoutPerHerald && (
              <div className="mt-3 text-xs text-center" style={{ color: 'var(--muted)' }}>
                总预算 ¥{(Number(form.payoutPerHerald) * Number(form.maxHeralds) * 1.2).toLocaleString()}（含服务费）
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
