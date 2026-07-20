import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/utils'

function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string; color: string }> = {
    open: { bg: '#dcfce7', color: '#16a34a' },
    draft: { bg: '#fef3c7', color: '#d97706' },
    completed: { bg: '#e0e7ff', color: '#4338ca' },
    cancelled: { bg: '#fee2e2', color: '#dc2626' },
  }
  const s = map[status] || { bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  )
}

export default function Tasks() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter],
    queryFn: () => tasksApi.list({ status: statusFilter || undefined }).then((r) => r.data),
  })

  const tasks = data?.tasks || []
  const filters = [
    { val: '', label: t('tasks.filterAll') },
    { val: 'open', label: t('tasks.filterOpen') },
    { val: 'draft', label: t('tasks.filterDraft') },
  ]

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar
        title={t('tasks.title')}
        actions={
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--primary)', color: '#fff' }}
            onClick={() => navigate('/tasks/new')}
          >
            <Plus size={15} />
            {t('tasks.createTask')}
          </button>
        }
      />

      <div className="p-7 flex-1">
        {/* Filter */}
        <div className="flex gap-2 mb-5">
          {filters.map((f) => (
            <button
              key={f.val}
              onClick={() => setStatusFilter(f.val)}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer"
              style={
                statusFilter === f.val
                  ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }
                  : { background: '#fff', color: 'var(--muted)', borderColor: 'var(--border)' }
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {[t('tasks.colTask'), t('tasks.colStatus'), t('tasks.colApplicants'), t('tasks.colCreated'), t('tasks.colActions')].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('common.loading')}</td></tr>
              )}
              {!isLoading && tasks.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('tasks.empty')}</td></tr>
              )}
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="text-sm font-medium">{task.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      ¥{task.payout_per_herald} / 人 · 最多 {task.max_heralds} 人
                    </div>
                  </td>
                  <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <StatusTag status={task.status} />
                  </td>
                  <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                    {task.applicant_count || 0}
                  </td>
                  <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                    {formatDate(task.created_at)}
                  </td>
                  <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/tasks/${task.id}/edit`) }}
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
