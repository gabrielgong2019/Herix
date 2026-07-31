import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { ArrowLeft } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function PartnerTaskDetail() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const bindToken = searchParams.get('bind_token')

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!).then((r) => r.data),
    enabled: !!id,
    retry: false,
  })

  const bindMut = useMutation({
    mutationFn: () => tasksApi.bindTask(id!, bindToken!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      // remove bind_token from URL
      navigate(`/partner/${id}`, { replace: true })
    },
  })

  // Auto-bind when token is in URL
  useEffect(() => {
    if (bindToken && id && !bindMut.isSuccess && !bindMut.isPending) {
      bindMut.mutate()
    }
  }, [bindToken, id])

  if (isLoading) return null

  if (!task) {
    return (
      <div className="flex flex-col min-h-screen">
        <Topbar title={t('partner.title')} />
        <div className="p-7">
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('partner.empty')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={task.title} />

      <div className="p-7 flex-1">
        <button
          className="flex items-center gap-1.5 text-sm mb-5 cursor-pointer"
          style={{ color: 'var(--muted)' }}
          onClick={() => navigate('/partner')}
        >
          <ArrowLeft size={14} /> {t('partner.title')}
        </button>

        {/* Viewing-as banner */}
        <div
          className="rounded-2xl px-4 py-3 mb-5 text-xs font-medium"
          style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}
        >
          {t('partner.viewingAs')}
        </div>

        {/* Bind status */}
        {bindMut.isPending && (
          <div className="rounded-2xl px-4 py-3 mb-5 text-xs" style={{ background: '#f8fafc', color: 'var(--muted)' }}>
            {t('partner.binding')}
          </div>
        )}
        {bindMut.isError && (
          <div className="rounded-2xl px-4 py-3 mb-5 text-xs" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
            {t('partner.bindFailed')}
          </div>
        )}

        {/* Stats */}
        <div className="rounded-2xl p-6 mb-5" style={{ background: '#fff' }}>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: t('partner.codeHolders'), value: (task as any).code_holders ?? '—' },
              { label: t('partner.totalRegistered'), value: (task as any).total_registered ?? '—' },
              { label: t('partner.totalConverted'), value: (task as any).total_converted ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{label}</div>
                <div className="text-xl font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Task info (read-only) */}
        <div className="rounded-2xl p-6" style={{ background: '#fff' }}>
          <div className="text-sm font-semibold mb-4">{task.title}</div>
          <div className="space-y-3 text-sm" style={{ color: 'var(--text)' }}>
            {task.description && (
              <p className="leading-relaxed">{task.description}</p>
            )}
            {task.deadline && (
              <div className="flex gap-4 text-xs" style={{ color: 'var(--muted)' }}>
                <span>{t('taskForm.fieldDeadline')}: {formatDate(task.deadline)}</span>
                <span>{t('tasks.maxHeralds')}: {task.max_heralds}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
