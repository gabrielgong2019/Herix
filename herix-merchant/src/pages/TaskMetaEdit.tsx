import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { ArrowLeft, ImagePlus, X } from 'lucide-react'

export default function TaskMetaEdit() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [deadline, setDeadline] = useState('')
  const [maxHeralds, setMaxHeralds] = useState('')
  // PERFORMANCE 展示字段（OPEN 后可改）
  const [serviceName, setServiceName] = useState('')
  const [registerLabel, setRegisterLabel] = useState('')
  const [convert, setConvert] = useState<string[]>([''])
  const [inviteeBenefit, setInviteeBenefit] = useState('')
  const [referralScript, setReferralScript] = useState('')
  const [saved, setSaved] = useState(false)

  const coverFileRef = useRef<File | null>(null)

  const { data: task } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!).then((r) => r.data),
    enabled: !!id,
  })

  useEffect(() => {
    if (!task) return
    setTitle(task.title || '')
    setDescription(task.description || '')
    setCoverImage(task.cover_image || '')
    setDeadline(task.deadline ? task.deadline.slice(0, 10) : '')
    setMaxHeralds(String(task.max_heralds || ''))
    setServiceName((task as any).service_name || '')
    setRegisterLabel(task.conversion_criteria?.register?.label || '新用户（此前未注册过）')
    setConvert(task.conversion_criteria?.convert?.length ? task.conversion_criteria.convert : [''])
    setInviteeBenefit(task.invitee_benefit || '')
    setReferralScript(task.referral_script || '')
  }, [task])

  const isPublished = ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(task?.status ?? '')

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description,
        coverImage: coverImage && !coverImage.startsWith('data:') ? coverImage : undefined,
        deadline: deadline || undefined,
        maxHeralds: maxHeralds ? Number(maxHeralds) : undefined,
        ...(task?.mode === 'PERFORMANCE' ? {
          serviceName: serviceName.trim() || undefined,
          conversionCriteria: { register: { label: registerLabel.trim() || '新用户' }, convert: convert.map((c) => c.trim()).filter(Boolean) },
          inviteeBenefit: inviteeBenefit.trim(),
          referralScript: referralScript.trim(),
        } : {}),
      }
      const res = isPublished ? await tasksApi.updateMeta(id!, payload) : await tasksApi.update(id!, payload)
      if (coverFileRef.current) {
        await tasksApi.uploadCover(id!, coverFileRef.current)
        coverFileRef.current = null
      }
      return res
    },
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      qc.invalidateQueries({ queryKey: ['task', id] })
    },
  })

  if (!task) return null

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('taskDetail.metaEditTitle')} />

      <div className="p-7 flex-1">
        <button
          className="flex items-center gap-1.5 text-sm mb-5 cursor-pointer"
          style={{ color: 'var(--muted)' }}
          onClick={() => navigate(`/tasks/${id}`)}
        >
          <ArrowLeft size={14} /> {task.title}
        </button>

        <div className="max-w-2xl">
          {isPublished && (
            <div
              className="rounded-2xl px-4 py-3 mb-5 text-xs"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
            >
              {t('taskDetail.lockedFields')}
            </div>
          )}

          <div className="rounded-2xl p-6" style={{ background: '#fff' }}>
            <div className="space-y-5">

              {/* 标题 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('taskForm.fieldTitle')}
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                />
              </div>

              {/* 封面图 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('taskForm.fieldCover')}
                </label>
                <div
                  className="relative rounded-xl border-2 border-dashed overflow-hidden cursor-pointer transition-colors"
                  style={{ borderColor: 'var(--border)', aspectRatio: '16/7', background: coverImage ? 'transparent' : '#fafafa' }}
                  onClick={() => document.getElementById('meta-cover-input')?.click()}
                >
                  {coverImage ? (
                    <>
                      <img src={coverImage} className="w-full h-full object-cover" alt="cover" />
                      <button
                        type="button"
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white"
                        onClick={(e) => { e.stopPropagation(); setCoverImage(''); coverFileRef.current = null }}
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
                  id="meta-cover-input" type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      coverFileRef.current = file
                      const reader = new FileReader()
                      reader.onload = (ev) => setCoverImage(ev.target?.result as string)
                      reader.readAsDataURL(file)
                    }
                  }}
                />
              </div>

              {/* 简报正文 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('taskForm.fieldBrief')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-y"
                  style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                    {t('taskForm.fieldDeadline')}
                    <span className="font-normal ml-1" style={{ color: 'var(--muted)' }}>({t('common.optional')})</span>
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                    {t('taskForm.fieldMaxHeralds')}
                    {isPublished && <span className="font-normal ml-1" style={{ color: 'var(--muted)' }}>({t('taskDetail.maxHeraldsTip')})</span>}
                  </label>
                  <input
                    type="number"
                    value={maxHeralds}
                    onChange={(e) => setMaxHeralds(e.target.value)}
                    min={task.max_heralds}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                  />
                </div>
              </div>

              {task.mode === 'PERFORMANCE' && (
                <>
                  {/* 产品/服务名称 */}
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                      {t('taskForm.fieldServiceName')}
                      <span className="font-normal ml-1" style={{ color: 'var(--muted)' }}>({t('common.optional')})</span>
                    </label>
                    <input
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                      placeholder={t('taskForm.fieldServiceNamePh')}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                      {t('taskForm.conversionTitle')}
                    </label>
                    <input value={registerLabel} onChange={(e) => setRegisterLabel(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2"
                      style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }} />
                    {convert.map((line, i) => (
                      <div key={i} className="flex gap-2 mb-1.5">
                        <input value={line} onChange={(e) => { const a = [...convert]; a[i] = e.target.value; setConvert(a) }}
                          placeholder={t('taskForm.convertPh')}
                          className="flex-1 px-3 py-2 rounded-xl text-sm outline-none" style={{ border: '1px solid var(--border)' }} />
                        <button type="button" onClick={() => { const a = convert.filter((_, j) => j !== i); setConvert(a.length ? a : ['']) }}
                          style={{ color: 'var(--muted)' }}>✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setConvert([...convert, ''])} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>
                      ＋ {t('taskForm.convertAdd')}
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                      {t('taskForm.inviteeBenefitLabel')}
                    </label>
                    <input value={inviteeBenefit} onChange={(e) => setInviteeBenefit(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }} />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                      {t('taskForm.referralScriptLabel')}
                    </label>
                    <textarea value={referralScript} onChange={(e) => setReferralScript(e.target.value)} rows={3}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-y"
                      style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }} />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--primary)' }}
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? t('taskDetail.saving') : t('taskDetail.saveChanges')}
              </button>
              {saveMut.isError && (
                <span className="text-xs" style={{ color: '#dc2626' }}>{t('taskDetail.saveFailed')}</span>
              )}
              {saved && (
                <span className="text-xs" style={{ color: 'var(--success)' }}>{t('taskDetail.saveSuccess')}</span>
              )}
              <button
                className="ml-auto px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: '#f3f4f6', color: 'var(--text)' }}
                onClick={() => navigate(`/tasks/${id}`)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
