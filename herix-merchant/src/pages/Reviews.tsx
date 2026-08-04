import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewsApi, tasksApi, parseLinks, type Submission, type Application } from '@/lib/api'
import { HeraldDrawer } from '@/components/HeraldDrawer'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '@/components/layout/Topbar'
import { Check, X, FileText, Scale } from 'lucide-react'
import { formatDate } from '@/lib/utils'

function jarr(raw?: string | null): string[] {
  if (!raw) return []
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : [] } catch { return [] }
}

/** 评审往来时间线：/revisions 完整审计链（商家赫使同源），每轮 提交/通过/退回 + 意见 + 真图 */
function ReviewTimeline({ subId }: { subId: string }) {
  const { t } = useTranslation()
  const { data: revs = [], isLoading } = useQuery({
    queryKey: ['revisions', subId],
    queryFn: () => reviewsApi.revisions(subId).then((r) => r.data),
  })
  if (isLoading) return <div className="text-xs px-5 py-3" style={{ color: 'var(--muted)' }}>{t('common.loading')}</div>
  if (!revs.length) return <div className="text-xs px-5 py-3" style={{ color: 'var(--muted)' }}>{t('reviews.noDraft')}</div>
  let round = 0
  return (
    <div className="px-5 py-3.5 mx-5 mb-3 rounded-lg" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
      <div className="text-xs font-semibold mb-2.5" style={{ color: 'var(--muted)' }}>{t('reviews.timeline')}</div>
      <div className="flex flex-col gap-3">
        {revs.map((r, i) => {
          const isSubmit = r.kind === 'SUBMIT'
          if (isSubmit) round++
          const stage = r.stage === 'DRAFT' ? t('reviews.stageDraft') : t('reviews.stageFinal')
          const shots = jarr(r.screenshot_urls)
          const links = jarr(r.content_urls)
          const head = isSubmit
            ? t('reviews.tlSubmit', { stage, round })
            : r.action === 'APPROVED' ? t('reviews.tlApprove', { stage })
            : r.action === 'REJECTED' ? t('reviews.tlReturn')
            : r.action
          const hColor = isSubmit ? 'var(--primary)' : r.action === 'REJECTED' ? '#d97706' : '#16a34a'
          return (
            <div key={i} className="flex gap-2.5 text-xs">
              <span style={{ color: 'var(--muted)', flexShrink: 0, minWidth: 40, fontWeight: 600 }}>
                {isSubmit ? t('reviews.tlHerald') : t('reviews.tlBrand')}
              </span>
              <div className="flex-1 min-w-0">
                <div>
                  <span style={{ color: hColor, fontWeight: 600 }}>{head}</span>
                  <span className="ml-2" style={{ color: 'var(--muted)' }}>{formatDate(r.created_at)}</span>
                </div>
                {r.note && <div className="mt-0.5" style={{ color: '#92400e' }}>「{r.note}」</div>}
                {isSubmit && r.description && <div className="mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{r.description}</div>}
                {shots.length > 0 && (
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {shots.map((u, j) => (
                      <a key={j} href={u} target="_blank" rel="noreferrer">
                        <img src={u} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                      </a>
                    ))}
                  </div>
                )}
                {links.map((u, j) => (
                  <a key={j} href={u} target="_blank" rel="noreferrer" className="block mt-0.5" style={{ color: 'var(--primary)', wordBreak: 'break-all' }}>{u}</a>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 行内平台摘要：前2个平台名+粉丝数，多的折叠为 +n */
function platformSummary(app: Application, t: TFunction): string {
  let ps: Array<{ platformId: string; followers?: number | null }> = []
  try { ps = app.social_platforms ? JSON.parse(app.social_platforms) : [] } catch { /* ignore */ }
  ps = ps.filter((p) => p.platformId)
  if (!ps.length) return '—'
  const fmt = (n: number) => n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n)
  const parts = ps.slice(0, 2).map((p) => `${t(`platform.${p.platformId}`, { defaultValue: p.platformId })}${p.followers != null ? ' ' + fmt(Number(p.followers)) : ''}`)
  return parts.join(' · ') + (ps.length > 2 ? ` +${ps.length - 2}` : '')
}

export default function Reviews() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [compareId, setCompareId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const navigate = useNavigate()
  const { data: subs = [], isLoading } = useQuery({
    queryKey: ['reviews'],
    queryFn: () => reviewsApi.list().then((r) => r.data),
  })
  // 报名待审汇总（2026-07-26）：报名审核入口在任务详情申请人Tab，单靠那里用户找不到——本页一处看全两类待办。
  // 就地审核：点行开 HeraldDrawer（与任务详情同一抽屉），不再跳任务详情
  const { data: pendingApps = [] } = useQuery({
    queryKey: ['pending-apps'],
    queryFn: () => reviewsApi.pendingApplications().then((r) => r.data),
  })
  const [drawerApp, setDrawerApp] = useState<Application | null>(null)
  const [noteModal, setNoteModal] = useState<null | { type: 'reject' | 'arbitrate'; sub: Submission; note: string }>(null)
  const [creditShort, setCreditShort] = useState(false)
  const onAppReviewed = () => {
    setErr(''); setCreditShort(false); setDrawerApp(null)
    qc.invalidateQueries({ queryKey: ['pending-apps'] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
  }
  const onAppReviewErr = (e: unknown) => {
    const data = (e as { response?: { data?: { error?: string; code?: string } } })?.response?.data
    setErr(data?.error || t('reviews.actionFailed'))
    setCreditShort(data?.code === 'INSUFFICIENT_CREDIT')
    setDrawerApp(null)
  }
  const appApproveMut = useMutation({
    mutationFn: (app: Application) => tasksApi.approveApp(app.task_id, app.id),
    onSuccess: onAppReviewed, onError: onAppReviewErr,
  })
  const appRejectMut = useMutation({
    mutationFn: (app: Application) => tasksApi.rejectApp(app.task_id, app.id),
    onSuccess: onAppReviewed, onError: onAppReviewErr,
  })

  const reviewMut = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'APPROVED' | 'REJECTED'; note?: string }) =>
      reviewsApi.review(id, status, note),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['reviews'] }) },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || t('reviews.actionFailed'))
    },
  })

  const doReject = (sub: Submission) => {
    setNoteModal({ type: 'reject', sub, note: '' })
  }

  const confirmNote = () => {
    if (!noteModal) return
    const note = noteModal.note.trim()
    if (!note) { setErr(t('reviews.rejectReasonRequired')); setNoteModal(null); return }
    if (noteModal.type === 'reject') {
      reviewMut.mutate({ id: noteModal.sub.id, status: 'REJECTED', note })
    } else {
      arbMut.mutate({ id: noteModal.sub.id, reason: note })
    }
    setNoteModal(null)
  }

  const arbMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => reviewsApi.arbitrate(id, reason),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['reviews'] }) },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || t('reviews.actionFailed'))
    },
  })

  // 额度用尽后的出口：开平台仲裁案（开案期间超时计时冻结，商家直接通过则争议自动消解）
  const doArbitrate = (sub: Submission) => {
    setNoteModal({ type: 'arbitrate', sub, note: '' })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('reviews.title')} />

      <div className="p-7 flex-1">
        {err && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm flex items-center justify-between" style={{ background: '#fee2e2', color: 'var(--danger)' }}>
            <span>{err}</span>
            {creditShort && (
              <button className="text-sm font-semibold px-3 py-1 rounded-lg" style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={() => navigate('/wallet')}>
                {t('reviews.goTopup')}
              </button>
            )}
          </div>
        )}
        {pendingApps.length > 0 && (
          <div className="rounded-2xl overflow-hidden mb-6" style={{ background: '#fff' }}>
            <div className="px-5 py-3.5 text-sm font-semibold flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              🙋 {t('reviews.pendingAppsTitle', { n: pendingApps.length })}
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {[t('reviews.colTask'), t('reviews.colHerald'), t('reviews.colPlatforms'), t('reviews.colMessage'), t('reviews.colAppliedAt'), ''].map((h, i) => (
                    <th key={i} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingApps.map((app: Application) => (
                  <tr key={app.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setDrawerApp(app)}>
                    <td className="px-5 py-3 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>{app.task_title}</td>
                    <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full inline-flex items-center justify-center text-xs text-white flex-shrink-0"
                          style={{ background: 'var(--primary)', backgroundImage: app.avatar_url ? `url(${app.avatar_url})` : undefined, backgroundSize: 'cover' }}>
                          {!app.avatar_url && ((app.display_name || app.nickname || '?')[0]).toUpperCase()}
                        </span>
                        {app.display_name || app.nickname}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{platformSummary(app, t)}</td>
                    <td className="px-5 py-3 text-sm max-w-52 truncate" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{app.message || '—'}</td>
                    <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{formatDate(app.created_at)}</td>
                    <td className="px-5 py-3 text-right" style={{ borderBottom: '1px solid var(--border)' }}>
                      <button className="text-xs" style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); navigate(`/tasks/${app.task_id}`) }}>
                        {t('reviews.viewTask')} →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-1 pb-2 text-sm font-semibold">{t('reviews.submissionsTitle')}</div>
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {[t('reviews.colTask'), t('reviews.colHerald'), t('reviews.colStage'), t('reviews.colSubmittedAt'), t('reviews.colContent'), t('reviews.colActions')].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('common.loading')}</td></tr>
              )}
              {!isLoading && subs.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('reviews.empty')}</td></tr>
              )}
              {subs.map((sub) => {
                const links = parseLinks(sub)
                const isDraft = sub.stage === 'DRAFT'
                const limit = isDraft ? (sub.max_revisions ?? 2) : (sub.require_draft_review ? 2 : (sub.max_revisions ?? 2))
                const used = sub.stage_rejects ?? 0
                return (
                  <Fragment key={sub.id}>
                    <tr>
                      <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>{sub.task_title || '—'}</td>
                      <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>{sub.herald_name || '—'}</td>
                      <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                          background: isDraft ? '#eff6ff' : '#f0fdf4',
                          color: isDraft ? '#1d4ed8' : '#16a34a',
                        }}>
                          {isDraft ? t('reviews.stageDraft') : t('reviews.stageFinal')}
                        </span>
                        {sub.arbitration_open && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium ml-1" style={{ background: '#fef3c7', color: '#d97706' }}>
                            {t('reviews.arbitrationOpen')}
                          </span>
                        )}
                        <div className="text-[11px] mt-1" style={{ color: used >= limit ? 'var(--danger)' : 'var(--muted)' }}>
                          {t('reviews.rejectBudget', { used, limit })}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{sub.submitted_at ? formatDate(sub.submitted_at) : '—'}</td>
                      <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>
                        {isDraft && sub.description && (
                          <div className="text-xs mb-1 max-w-[280px] truncate" title={sub.description}>{sub.description}</div>
                        )}
                        {links.length > 0
                          ? links.map((u, i) => (
                              <a key={u} href={u} target="_blank" rel="noreferrer" className="block text-xs" style={{ color: 'var(--primary)' }}>
                                {t('reviews.linkN', { n: i + 1 })}
                              </a>
                            ))
                          : (!isDraft && <span style={{ color: 'var(--muted)' }}>—</span>)}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs mt-1 underline cursor-pointer"
                          style={{ color: 'var(--muted)' }}
                          onClick={() => setCompareId(compareId === sub.id ? null : sub.id)}
                        >
                          <FileText size={11} /> {t('reviews.viewTimeline')}
                        </button>
                      </td>
                      <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex gap-2">
                          <button
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                            style={{ background: '#dcfce7', color: '#16a34a' }}
                            onClick={() => reviewMut.mutate({ id: sub.id, status: 'APPROVED' })}
                            disabled={reviewMut.isPending}
                          >
                            <Check size={12} /> {isDraft ? t('reviews.approveDraft') : t('reviews.approve')}
                          </button>
                          {used >= limit && !sub.arbitration_open ? (
                            <button
                              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                              style={{ background: '#fef3c7', color: '#d97706' }}
                              onClick={() => doArbitrate(sub)}
                              disabled={arbMut.isPending}
                              title={t('reviews.budgetExhausted')}
                            >
                              <Scale size={12} /> {t('reviews.arbitrate')}
                            </button>
                          ) : (
                            <button
                              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                              style={{ background: '#fee2e2', color: '#dc2626', opacity: used >= limit ? 0.5 : 1 }}
                              onClick={() => doReject(sub)}
                              disabled={reviewMut.isPending || used >= limit}
                              title={used >= limit ? t('reviews.budgetExhausted') : undefined}
                            >
                              <X size={12} /> {t('reviews.reject')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {compareId === sub.id && (
                      <tr>
                        <td colSpan={6} style={{ borderBottom: '1px solid var(--border)' }}><ReviewTimeline subId={sub.id} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <HeraldDrawer
        app={drawerApp}
        taskTitle={drawerApp?.task_title}
        onClose={() => setDrawerApp(null)}
        onApprove={() => drawerApp && appApproveMut.mutate(drawerApp)}
        onReject={() => drawerApp && appRejectMut.mutate(drawerApp)}
        approving={appApproveMut.isPending}
        rejecting={appRejectMut.isPending}
      />

      {noteModal && (
        <div
          onClick={() => setNoteModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '28px 32px', width: 520, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, lineHeight: 1.5 }}>
              {t(noteModal.type === 'reject' ? 'reviews.rejectReasonPrompt' : 'reviews.arbitrateReasonPrompt')}
            </div>
            <textarea
              autoFocus
              value={noteModal.note}
              onChange={e => setNoteModal({ ...noteModal, note: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirmNote() }}
              style={{
                width: '100%', minHeight: 160, padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.6,
                resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                fontFamily: 'inherit', color: 'var(--text)',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
              <button
                onClick={() => setNoteModal(null)}
                style={{ padding: '9px 22px', borderRadius: 10, border: '1px solid var(--border)', background: '#fff', fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmNote}
                disabled={reviewMut.isPending || arbMut.isPending}
                style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (reviewMut.isPending || arbMut.isPending) ? 0.6 : 1 }}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
