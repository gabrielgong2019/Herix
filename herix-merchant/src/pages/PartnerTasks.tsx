import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { formatDate } from '@/lib/utils'

export default function PartnerTasks() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: tasks = [] } = useQuery({
    queryKey: ['partner-tasks'],
    queryFn: () => tasksApi.partnerList().then((r) => r.data),
  })

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('partner.title')} />

      <div className="p-7 flex-1">
        {tasks.length === 0 ? (
          <div className="text-sm text-center py-16" style={{ color: 'var(--muted)' }}>
            {t('partner.empty')}
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {[
                    t('tasks.colTask'),
                    t('partner.codeHolders'),
                    t('partner.totalRegistered'),
                    t('partner.totalConverted'),
                    t('tasks.colCreated'),
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-medium"
                      style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr
                    key={task.id}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => navigate(`/partner/${task.id}`)}
                  >
                    <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div>{task.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{task.agency_name}</div>
                    </td>
                    <td className="px-5 py-3.5 text-sm tabular-nums" style={{ borderBottom: '1px solid var(--border)' }}>
                      {task.code_holders}
                    </td>
                    <td className="px-5 py-3.5 text-sm tabular-nums" style={{ borderBottom: '1px solid var(--border)' }}>
                      {task.total_registered}
                    </td>
                    <td className="px-5 py-3.5 text-sm tabular-nums" style={{ borderBottom: '1px solid var(--border)' }}>
                      {task.total_converted}
                    </td>
                    <td className="px-5 py-3.5 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                      {formatDate(task.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
