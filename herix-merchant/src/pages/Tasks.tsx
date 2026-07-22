import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { tasksApi, walletApi, type BrandBalance } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/utils'

function CreditBanner({ balance }: { balance: BrandBalance }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const c = balance.credit
  if (!c || !c.initialCredit) return null

  const creditLimit  = c.initialCredit
  const walletAmt    = balance.available || 0
  const taskCapacity = creditLimit + walletAmt
  const used         = c.creditUsed || 0
  const pct          = taskCapacity > 0 ? Math.min(100, Math.round(used / taskCapacity * 100)) : 0
  const hasToppedUp  = !!c.hasToppedUp
  const barColor     = pct >= 90 ? '#dc2626' : pct >= 60 ? '#a78bfa' : '#3b82f6'

  return (
    <div
      className="rounded-2xl p-5 mb-5"
      style={{ background: 'linear-gradient(135deg,#eff6ff 0%,#f0fdf4 100%)', border: '1px solid #bfdbfe' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-semibold mb-0.5" style={{ color: '#1e40af' }}>
            {t('credit.bannerTitle')}
            {!hasToppedUp && <span className="ml-1.5 text-xs font-normal" style={{ color: '#6366f1' }}>· {t('credit.trialTag')}</span>}
          </div>
          <div className="text-xs leading-relaxed" style={{ color: '#3b82f6' }}>
            {t('credit.bannerSub')}
          </div>
        </div>
        {!hasToppedUp && (
          <button
            onClick={() => navigate('/wallet')}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white flex-shrink-0 ml-3 transition-opacity hover:opacity-90"
            style={{ background: 'var(--primary)' }}
          >
            {t('credit.topupNow')} →
          </button>
        )}
      </div>

      {/* 3-column formula */}
      <div className="grid items-center mb-3" style={{ gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 8 }}>
        <div>
          <div className="text-xs mb-1" style={{ color: '#6b7280' }}>{t('credit.creditLimit')}</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: '#1d4ed8' }}>¥{creditLimit.toLocaleString()}</div>
        </div>
        <div className="text-lg self-end pb-0.5" style={{ color: '#9ca3af', padding: '0 4px' }}>+</div>
        <div>
          <div className="text-xs mb-1" style={{ color: '#6b7280' }}>{t('credit.depositAmount')}</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: walletAmt > 0 ? '#16a34a' : '#9ca3af' }}>¥{walletAmt.toLocaleString()}</div>
        </div>
        <div className="text-lg self-end pb-0.5" style={{ color: '#9ca3af', padding: '0 4px' }}>=</div>
        <div>
          <div className="text-xs mb-1" style={{ color: '#6b7280' }}>{t('credit.taskCapacity')}</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: '#7c3aed' }}>¥{taskCapacity.toLocaleString()}</div>
        </div>
      </div>

      {/* Progress bar + usage */}
      {used > 0 && (
        <>
          <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: '#e0e7ff' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg,${barColor},#7c3aed)` }}
            />
          </div>
          <div className="text-xs" style={{ color: '#6b7280' }}>
            {t('credit.committed', { used: used.toLocaleString(), left: Math.max(0, taskCapacity - used).toLocaleString() })}
          </div>
        </>
      )}

      {/* Topup benefit message */}
      {!hasToppedUp && (
        <div className="text-xs leading-relaxed mt-2.5" style={{ color: '#4338ca' }}>
          {t('credit.topupBenefit')}
        </div>
      )}
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation()
  const key = status.toLowerCase()
  const map: Record<string, { bg: string; color: string }> = {
    open: { bg: '#dcfce7', color: '#16a34a' },
    draft: { bg: '#fef3c7', color: '#d97706' },
    completed: { bg: '#e0e7ff', color: '#4338ca' },
    cancelled: { bg: '#fee2e2', color: '#dc2626' },
  }
  const s = map[key] || { bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {t(`status.${key}`, { defaultValue: status })}
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
  const { data: balance } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => walletApi.brandBalance().then((r) => r.data),
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
        {/* Credit banner */}
        {balance && <CreditBanner balance={balance} />}

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
