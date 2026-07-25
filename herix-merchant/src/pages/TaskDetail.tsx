import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, type Application } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { HeraldDrawer } from '@/components/HeraldDrawer'
import { ArrowLeft, Check, X, Copy, Download, ExternalLink, Upload } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type Tab = 'applicants' | 'submissions' | 'codes' | 'referrals' | 'partners'

function maskName(name: string): string {
  if (!name || name.length <= 1) return name
  return name[0] + '**'
}

// ── Publish banner ────────────────────────────────────────────────
function PublishBanner({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)

  const publishMut = useMutation({
    mutationFn: () => tasksApi.publish(taskId),
    onSuccess: () => {
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['task', taskId] })
    },
  })

  return (
    <div
      className="rounded-2xl p-5 mb-5 flex items-center justify-between gap-4"
      style={{ background: '#fffbeb', border: '1px solid #fde68a' }}
    >
      <div>
        <div className="text-sm font-semibold" style={{ color: '#92400e' }}>
          {t('status.draft')}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#a16207' }}>
          {t('taskDetail.lockedFields')}
        </div>
      </div>

      {confirm ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: '#92400e' }}>{t('taskDetail.publishConfirm')}</span>
          <button
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
            style={{ background: '#d97706' }}
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending}
          >
            {publishMut.isPending ? t('taskDetail.publishing') : t('common.confirm')}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: '#f3f4f6', color: 'var(--text)' }}
            onClick={() => setConfirm(false)}
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button
          className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity"
          style={{ background: '#d97706' }}
          onClick={() => setConfirm(true)}
        >
          {t('taskDetail.publishBtn')}
        </button>
      )}

      {publishMut.isError && (
        <div className="text-xs" style={{ color: '#dc2626' }}>{t('taskDetail.publishFailed')}</div>
      )}
    </div>
  )
}

// ── Share section ─────────────────────────────────────────────────
function ShareSection({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const h5Url = `${window.location.origin}/app/#/pages/landing/index?task=${taskId}`

  const { data: weappLink } = useQuery({
    queryKey: ['weapp-link', taskId],
    queryFn: () => tasksApi.getWeappLink(taskId).then((r) => r.data),
  })

  const qrUrl = tasksApi.getWeappQrUrl(taskId)

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    })
  }

  return (
    <div className="rounded-2xl p-6 mb-5" style={{ background: '#fff' }}>
      <div className="text-sm font-semibold mb-4">{t('taskDetail.shareTitle')}</div>

      <div className="space-y-3">
        {/* H5 link */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium w-28 shrink-0" style={{ color: 'var(--muted)' }}>
            {t('taskDetail.h5Link')}
          </div>
          <div
            className="flex-1 text-xs px-3 py-2 rounded-xl font-mono truncate"
            style={{ background: '#f8fafc', border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            {h5Url}
          </div>
          <button
            className="shrink-0 flex items-center gap-1 text-xs px-3 py-2 rounded-xl font-medium transition-colors"
            style={{ background: '#f3f4f6', color: 'var(--text)' }}
            onClick={() => copy(h5Url, 'h5')}
          >
            <Copy size={12} />
            {copiedKey === 'h5' ? t('taskDetail.copied') : t('taskDetail.copy')}
          </button>
          <a
            href={h5Url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center gap-1 text-xs px-3 py-2 rounded-xl font-medium"
            style={{ background: '#f3f4f6', color: 'var(--text)' }}
          >
            <ExternalLink size={12} />
          </a>
        </div>

        {/* WeApp link */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium w-28 shrink-0" style={{ color: 'var(--muted)' }}>
            {t('taskDetail.weappLink')}
          </div>
          {weappLink?.available && weappLink.link ? (
            <>
              <div
                className="flex-1 text-xs px-3 py-2 rounded-xl font-mono truncate"
                style={{ background: '#f8fafc', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                {weappLink.link}
              </div>
              <button
                className="shrink-0 flex items-center gap-1 text-xs px-3 py-2 rounded-xl font-medium"
                style={{ background: '#f3f4f6', color: 'var(--text)' }}
                onClick={() => copy(weappLink.link!, 'weapp')}
              >
                <Copy size={12} />
                {copiedKey === 'weapp' ? t('taskDetail.copied') : t('taskDetail.copy')}
              </button>
            </>
          ) : (
            <div className="flex-1 text-xs px-3 py-2 rounded-xl" style={{ background: '#f8fafc', border: '1px solid var(--border)', color: 'var(--muted)' }}>
              {t('taskDetail.weappLinkNA')}
            </div>
          )}
        </div>

        {/* WeApp QR */}
        <div className="flex items-start gap-2">
          <div className="text-xs font-medium w-28 shrink-0 pt-2" style={{ color: 'var(--muted)' }}>
            {t('taskDetail.weappQr')}
          </div>
          {weappLink?.available ? (
            <div className="flex items-center gap-2">
              <img
                src={qrUrl}
                alt="WeApp QR"
                className="w-24 h-24 rounded-xl border"
                style={{ borderColor: 'var(--border)' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              <a
                href={qrUrl}
                download={`task-${taskId}-qr.png`}
                className="flex items-center gap-1 text-xs px-3 py-2 rounded-xl font-medium"
                style={{ background: '#f3f4f6', color: 'var(--text)' }}
              >
                <Download size={12} /> {t('taskDetail.download')}
              </a>
            </div>
          ) : (
            <div className="text-xs pt-2" style={{ color: 'var(--muted)' }}>
              {t('taskDetail.weappLinkNA')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Code pool tab ─────────────────────────────────────────────────
function CodesTab({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const [codesText, setCodesText] = useState('')
  const [uploadMsg, setUploadMsg] = useState('')

  const { data: pool, refetch } = useQuery({
    queryKey: ['code-pool', taskId],
    queryFn: () => tasksApi.getCodePool(taskId).then((r) => r.data),
  })

  const uploadMut = useMutation({
    mutationFn: (codes: string[]) => tasksApi.uploadCustomCodes(taskId, codes),
    onSuccess: (res) => {
      setCodesText('')
      setUploadMsg(t('taskDetail.uploadSuccess', { added: res.data.added, skipped: res.data.skipped }))
      refetch()
    },
    onError: () => setUploadMsg(t('taskDetail.saveFailed')),
  })

  function handleUpload() {
    const codes = codesText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (codes.length === 0) return
    setUploadMsg('')
    uploadMut.mutate(codes)
  }

  return (
    <div className="p-6 space-y-5">
      {/* Pool stats */}
      {pool && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('taskDetail.codeTotal'), value: pool.total },
            { label: t('taskDetail.codeAssigned'), value: pool.assigned },
            { label: t('taskDetail.codeAvailable'), value: pool.available },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{label}</div>
              <div className="text-xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}

      {pool?.samples && pool.samples.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>{t('taskDetail.codeSamples')}</div>
          <div className="flex flex-wrap gap-1.5">
            {pool.samples.map((code) => (
              <span key={code} className="text-xs px-2 py-0.5 rounded-lg font-mono" style={{ background: '#f3f4f6', color: 'var(--text)' }}>
                {code}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Upload codes */}
      <div>
        <div className="text-sm font-medium mb-2">{t('taskDetail.uploadCodes')}</div>
        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>{t('taskDetail.uploadCodesHint')}</div>
        <textarea
          value={codesText}
          onChange={(e) => setCodesText(e.target.value)}
          rows={6}
          placeholder={t('taskDetail.codesPlaceholder')}
          className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none resize-y"
          style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--primary)' }}
            onClick={handleUpload}
            disabled={uploadMut.isPending || !codesText.trim()}
          >
            <Upload size={14} />
            {uploadMut.isPending ? t('taskDetail.uploading') : t('taskDetail.uploadCodes')}
          </button>
          {uploadMsg && (
            <span className="text-xs" style={{ color: uploadMut.isError ? '#dc2626' : 'var(--success)' }}>
              {uploadMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Referrals tab ─────────────────────────────────────────────────
function ReferralsTab({ taskId }: { taskId: string }) {
  const { t } = useTranslation()

  const { data: referrals } = useQuery({
    queryKey: ['referrals', taskId],
    queryFn: () => tasksApi.getReferrals(taskId).then((r) => r.data),
  })

  const records = referrals?.records || []

  return (
    <table className="w-full">
      <thead>
        <tr style={{ background: '#fafafa' }}>
          {[
            t('taskDetail.refCode'),
            t('taskDetail.refHerald'),
            t('taskDetail.refUser'),
            t('taskDetail.refRegistered'),
            t('taskDetail.refConverted'),
            t('taskDetail.refSettled'),
          ].map((h) => (
            <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.length === 0 && (
          <tr>
            <td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
              {t('taskDetail.emptyReferrals')}
            </td>
          </tr>
        )}
        {records.map((rec) => (
          <tr key={rec.id}>
            <td className="px-5 py-3.5 text-xs font-mono" style={{ borderBottom: '1px solid var(--border)' }}>{rec.code}</td>
            <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>{rec.herald_name}</td>
            <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{rec.user_masked}</td>
            <td className="px-5 py-3.5 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{rec.registered_at ? formatDate(rec.registered_at) : '—'}</td>
            <td className="px-5 py-3.5 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{rec.converted_at ? formatDate(rec.converted_at) : '—'}</td>
            <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: rec.settled ? '#dcfce7' : '#f3f4f6',
                  color: rec.settled ? '#16a34a' : 'var(--muted)',
                }}
              >
                {rec.settled ? t('taskDetail.refYes') : t('taskDetail.refNo')}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Partners tab ──────────────────────────────────────────────────
function PartnersTab({ taskId, parties }: { taskId: string; parties: Array<{ user_id: string; nickname: string; email: string; bound_at: string }> }) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const unbindMut = useMutation({
    mutationFn: (userId: string) => tasksApi.unbindBrand(taskId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId] }),
  })

  return (
    <div className="p-6">
      <div className="text-sm font-semibold mb-4">{t('taskDetail.brandParties')}</div>
      {parties.length === 0 ? (
        <div className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>—</div>
      ) : (
        <div className="space-y-3">
          {parties.map((party) => (
            <div
              key={party.user_id}
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: '#f8fafc', border: '1px solid var(--border)' }}
            >
              <div>
                <div className="text-sm font-medium">{party.nickname || party.email}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t('taskDetail.boundAt')} {formatDate(party.bound_at)}
                </div>
              </div>
              <button
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: '#fee2e2', color: '#dc2626' }}
                onClick={() => {
                  if (window.confirm(t('taskDetail.unbindConfirm'))) {
                    unbindMut.mutate(party.user_id)
                  }
                }}
                disabled={unbindMut.isPending}
              >
                {t('taskDetail.unbind')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────
export default function TaskDetail() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('applicants')
  const [drawerApp, setDrawerApp] = useState<Application | null>(null)

  const { data: task } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!).then((r) => r.data),
    enabled: !!id,
  })

  const { data: applications = [] } = useQuery({
    queryKey: ['task-apps', id],
    queryFn: () => tasksApi.applications(id!).then((r) => r.data),
    enabled: !!id && tab === 'applicants',
  })

  const { data: submissions = [] } = useQuery({
    queryKey: ['task-subs', id],
    queryFn: () => tasksApi.submissions(id!).then((r) => r.data),
    enabled: !!id && tab === 'submissions',
  })

  const approveMut = useMutation({
    mutationFn: (appId: string) => tasksApi.approveApp(id!, appId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-apps', id] })
      qc.invalidateQueries({ queryKey: ['task', id] })
      setDrawerApp(null)
    },
  })
  const rejectMut = useMutation({
    mutationFn: (appId: string) => tasksApi.rejectApp(id!, appId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-apps', id] })
      setDrawerApp(null)
    },
  })

  if (!task) return null

  const isDraft = task.status.toUpperCase() === 'DRAFT'
  const isPerformance = task.mode === 'PERFORMANCE'
  const parties = task.brand_parties || []

  const tabs = (
    [
      { key: 'applicants' as Tab, label: `${t('tasks.applicants')} (${applications.length})` },
      { key: 'submissions' as Tab, label: `${t('tasks.submissions')} (${submissions.length})` },
      { key: 'codes' as Tab, label: t('taskDetail.tabCodes'), show: isPerformance },
      { key: 'referrals' as Tab, label: t('taskDetail.tabReferrals'), show: isPerformance },
      { key: 'partners' as Tab, label: `${t('taskDetail.tabPartners')} (${parties.length})` },
    ] satisfies Array<{ key: Tab; label: string; show?: boolean }>
  ).filter((tb) => tb.show !== false)

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar
        title={task.title}
        actions={
          <div className="flex items-center gap-2">
            {/* 复制为新任务：按类型白名单预填（排除日期/推广码），投放是重复性工作 */}
            <button
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              onClick={() => navigate(`/tasks/new?copy=${id}`)}
            >
              {t('taskDetail.duplicate')}
            </button>
            {isDraft ? (
              <button
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => navigate(`/tasks/${id}/edit`)}
              >
                {t('common.edit')}
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => navigate(`/tasks/${id}/meta`)}
              >
                {t('taskDetail.metaEditTitle')}
              </button>
            )}
          </div>
        }
      />

      <div className="p-7 flex-1">
        <button
          className="flex items-center gap-1.5 text-sm mb-5 cursor-pointer"
          style={{ color: 'var(--muted)' }}
          onClick={() => navigate('/tasks')}
        >
          <ArrowLeft size={14} /> {t('tasks.title')}
        </button>

        {/* Publish banner */}
        {isDraft && <PublishBanner taskId={id!} />}

        {/* Share section */}
        {!isDraft && <ShareSection taskId={id!} />}

        {/* Task summary */}
        <div className="rounded-2xl p-6 mb-5" style={{ background: '#fff' }}>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: t('tasks.status'), value: t(`status.${task.status.toLowerCase()}`) },
              { label: t('tasks.payout'), value: `¥${task.payout_per_herald}` },
              { label: t('tasks.maxHeralds'), value: task.max_heralds },
              { label: t('tasks.approved'), value: task.approved_count || 0 },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{label}</div>
                <div className="text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-1 rounded-xl w-fit" style={{ background: 'var(--border)' }}>
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
              style={
                tab === tb.key
                  ? { background: '#fff', color: 'var(--text)', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }
                  : { background: 'transparent', color: 'var(--muted)' }
              }
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          {tab === 'applicants' && (
            <table className="w-full">
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {[t('tasks.herald'), t('tasks.appliedAt'), t('tasks.status'), t('common.confirm')].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('tasks.emptyApplicants')}</td></tr>
                )}
                {applications.map((app) => (
                  <tr
                    key={app.id}
                    onClick={() => setDrawerApp(app)}
                    style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-2.5">
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: 'var(--primary)', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 12, color: '#fff',
                          backgroundImage: app.avatar_url ? `url(${app.avatar_url})` : undefined,
                          backgroundSize: 'cover',
                        }}>
                          {!app.avatar_url && ((app.display_name || app.nickname || '?')[0]).toUpperCase()}
                        </div>
                        {maskName(app.display_name || app.nickname || app.herald?.name || app.user_id || '')}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                      {formatDate(app.created_at)}
                    </td>
                    <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        background: app.status === 'approved' ? '#dcfce7' : app.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                        color: app.status === 'approved' ? '#16a34a' : app.status === 'rejected' ? '#dc2626' : '#d97706',
                      }}>
                        {t(`status.${app.status}`)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                      {app.status === 'pending' && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={12} style={{ color: '#16a34a' }} /> / <X size={12} style={{ color: '#dc2626' }} />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'submissions' && (
            <table className="w-full">
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {[t('tasks.herald'), t('tasks.submittedAt'), t('tasks.status'), t('tasks.content')].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('tasks.emptySubmissions')}</td></tr>
                )}
                {submissions.map((sub) => (
                  <tr key={sub.id}>
                    <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>{maskName(sub.nickname || sub.herald?.name || sub.user_id || '')}</td>
                    <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{formatDate(sub.created_at)}</td>
                    <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        background: sub.status === 'approved' ? '#dcfce7' : sub.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                        color: sub.status === 'approved' ? '#16a34a' : sub.status === 'rejected' ? '#dc2626' : '#d97706',
                      }}>
                        {t(`status.${sub.status}`)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--primary)' }}>
                      {sub.content_url ? <a href={sub.content_url} target="_blank" rel="noreferrer">{t('tasks.viewContent')}</a> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'codes' && isPerformance && <CodesTab taskId={id!} />}
          {tab === 'referrals' && isPerformance && <ReferralsTab taskId={id!} />}
          {tab === 'partners' && <PartnersTab taskId={id!} parties={parties} />}
        </div>
      </div>

      <HeraldDrawer
        app={drawerApp}
        onClose={() => setDrawerApp(null)}
        onApprove={(appId) => approveMut.mutate(appId)}
        onReject={(appId) => rejectMut.mutate(appId)}
        approving={approveMut.isPending}
        rejecting={rejectMut.isPending}
      />
    </div>
  )
}
