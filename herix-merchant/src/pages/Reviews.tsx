import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewsApi, parseLinks, type Submission, type SubmissionRevision } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Check, X, FileText } from 'lucide-react'
import { formatDate } from '@/lib/utils'

/** 草稿定稿对照：从审计链取最后一版草稿内容（草稿通过前的最后一次 SUBMIT 即定稿版本） */
function approvedDraftOf(revs: SubmissionRevision[]): SubmissionRevision | null {
  const draftSubmits = revs.filter((r) => r.stage === 'DRAFT' && r.kind === 'SUBMIT')
  return draftSubmits.length ? draftSubmits[draftSubmits.length - 1] : null
}

function DraftCompare({ subId }: { subId: string }) {
  const { t } = useTranslation()
  const { data: revs = [], isLoading } = useQuery({
    queryKey: ['revisions', subId],
    queryFn: () => reviewsApi.revisions(subId).then((r) => r.data),
  })
  if (isLoading) return <div className="text-xs px-5 py-3" style={{ color: 'var(--muted)' }}>{t('common.loading')}</div>
  const draft = approvedDraftOf(revs)
  if (!draft) return <div className="text-xs px-5 py-3" style={{ color: 'var(--muted)' }}>{t('reviews.noDraft')}</div>
  let shots: string[] = []
  try { shots = draft.screenshot_urls ? JSON.parse(draft.screenshot_urls) : [] } catch { /* ignore */ }
  return (
    <div className="px-5 py-3 rounded-lg mx-5 mb-3" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
      <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>{t('reviews.approvedDraft')}</div>
      {draft.description && <div className="text-sm whitespace-pre-wrap mb-1.5">{draft.description}</div>}
      {shots.length > 0 && (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          {t('reviews.draftImages', { n: shots.length })}
        </div>
      )}
    </div>
  )
}

export default function Reviews() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [compareId, setCompareId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ['reviews'],
    queryFn: () => reviewsApi.list().then((r) => r.data),
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
    // 拒绝理由服务端必填（REASON_REQUIRED）：不填直接不发请求
    const note = window.prompt(t('reviews.rejectReasonPrompt'))
    if (note === null) return
    if (!note.trim()) { setErr(t('reviews.rejectReasonRequired')); return }
    reviewMut.mutate({ id: sub.id, status: 'REJECTED', note: note.trim() })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('reviews.title')} />

      <div className="p-7 flex-1">
        {err && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: '#fee2e2', color: 'var(--danger)' }}>{err}</div>
        )}
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
                        {!isDraft && !!sub.require_draft_review && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs mt-1 underline cursor-pointer"
                            style={{ color: 'var(--muted)' }}
                            onClick={() => setCompareId(compareId === sub.id ? null : sub.id)}
                          >
                            <FileText size={11} /> {t('reviews.compareDraft')}
                          </button>
                        )}
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
                          <button
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                            style={{ background: '#fee2e2', color: '#dc2626', opacity: used >= limit ? 0.5 : 1 }}
                            onClick={() => doReject(sub)}
                            disabled={reviewMut.isPending || used >= limit}
                            title={used >= limit ? t('reviews.budgetExhausted') : undefined}
                          >
                            <X size={12} /> {t('reviews.reject')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {compareId === sub.id && (
                      <tr>
                        <td colSpan={6} style={{ borderBottom: '1px solid var(--border)' }}><DraftCompare subId={sub.id} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
