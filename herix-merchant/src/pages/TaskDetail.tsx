import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { ArrowLeft, Check, X } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type Tab = 'applicants' | 'submissions'

export default function TaskDetail() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('applicants')

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-apps', id] }),
  })
  const rejectMut = useMutation({
    mutationFn: (appId: string) => tasksApi.rejectApp(id!, appId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-apps', id] }),
  })

  if (!task) return null

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar
        title={task.title}
        actions={
          <button
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={() => navigate(`/tasks/${id}/edit`)}
          >
            {t('common.edit')}
          </button>
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

        {/* Task summary */}
        <div className="rounded-2xl p-6 mb-5" style={{ background: '#fff' }}>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '状态', value: task.status },
              { label: '每人报酬', value: `¥${task.payout_per_herald}` },
              { label: '最大人数', value: task.max_heralds },
              { label: '已通过', value: task.approved_count || 0 },
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
          {(['applicants', 'submissions'] as Tab[]).map((t_) => (
            <button
              key={t_}
              onClick={() => setTab(t_)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
              style={
                tab === t_
                  ? { background: '#fff', color: 'var(--text)', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }
                  : { background: 'transparent', color: 'var(--muted)' }
              }
            >
              {t_ === 'applicants' ? `申请人 (${applications.length})` : `提交 (${submissions.length})`}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          {tab === 'applicants' && (
            <table className="w-full">
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {['赫使', '申请时间', '状态', '操作'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>暂无申请</td></tr>
                )}
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>
                      {app.herald?.name || app.user_id}
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
                    <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      {app.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                            style={{ background: '#dcfce7', color: '#16a34a' }}
                            onClick={() => approveMut.mutate(app.id)}
                          >
                            <Check size={12} /> {t('reviews.approve')}
                          </button>
                          <button
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                            style={{ background: '#fee2e2', color: '#dc2626' }}
                            onClick={() => rejectMut.mutate(app.id)}
                          >
                            <X size={12} /> {t('reviews.reject')}
                          </button>
                        </div>
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
                  {['赫使', '提交时间', '状态', '内容'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>暂无提交</td></tr>
                )}
                {submissions.map((sub) => (
                  <tr key={sub.id}>
                    <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>{sub.herald?.name || sub.user_id}</td>
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
                      {sub.content_url ? <a href={sub.content_url} target="_blank" rel="noreferrer">查看内容</a> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
