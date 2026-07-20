import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { tasksApi, walletApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { useNavigate } from 'react-router-dom'
import { formatDate } from '@/lib/utils'

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: '#fff' }}>
      <div className="text-2xl font-bold mb-1" style={{ color: color || 'var(--text)' }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    open: { bg: '#dcfce7', color: '#16a34a' },
    draft: { bg: '#fef3c7', color: '#d97706' },
    completed: { bg: '#e0e7ff', color: '#4338ca' },
    cancelled: { bg: '#fee2e2', color: '#dc2626' },
  }
  const s = map[status] || { bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: tasksData } = useQuery({
    queryKey: ['tasks', 'dashboard'],
    queryFn: () => tasksApi.list({ page: 1 }).then((r) => r.data),
  })
  const { data: walletData } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => walletApi.balance().then((r) => r.data),
  })

  const tasks = tasksData?.tasks || []
  const openCount = tasks.filter((t) => t.status === 'open').length
  const totalApplicants = tasks.reduce((s, t) => s + (t.applicant_count || 0), 0)

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('dashboard.title')} />

      <div className="p-7 flex-1">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label={t('dashboard.statTasks')} value={openCount} color="var(--primary)" />
          <StatCard label={t('dashboard.statApplicants')} value={totalApplicants} />
          <StatCard label={t('dashboard.statSubmissions')} value="—" />
          <StatCard label={t('dashboard.statCredits')} value={walletData ? `¥${walletData.credits.toLocaleString()}` : '—'} />
        </div>

        {/* Recent tasks */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold">{t('dashboard.recentTasks')}</span>
            <button
              className="text-xs font-semibold cursor-pointer"
              style={{ color: 'var(--primary)' }}
              onClick={() => navigate('/tasks')}
            >
              {t('tasks.title')} →
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {[t('tasks.colTask'), t('tasks.colStatus'), t('tasks.colApplicants'), t('tasks.colCreated')].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, 5).map((task) => (
                <tr
                  key={task.id}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <td className="px-5 py-3 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>{task.title}</td>
                  <td className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}><StatusTag status={task.status} /></td>
                  <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{task.applicant_count || 0}</td>
                  <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{formatDate(task.created_at)}</td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('tasks.empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
