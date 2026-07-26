import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { tasksApi, walletApi, type BrandBalance } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Topbar } from '@/components/layout/Topbar'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { LadderRows } from '@/components/CapacityLadder'

/** 可发布任务细条（2026-07-26 三改，用户反馈"卡片喧宾夺主"）：
 *  单行工具条 = 可发布任务 X/Y + 迷你进度 + 可用预算 + 提升入口(+零余额充值)。
 *  列表页主角是列表——托管信任标签移出本页（属于付款时刻的信任背书，归钱包/发布确认），
 *  高度 ~180px→~48px。阶梯弹层交互不变 */
function CreditBanner({ balance }: { balance: BrandBalance }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [ladderOpen, setLadderOpen] = useState(false)
  const c = balance.credit
  const pl = balance.publishLimit

  const creditLimit = c?.initialCredit || 0
  const available   = balance.available || 0
  const frozen      = balance.frozen || 0
  const used        = c?.sharedUsed ?? c?.creditUsed ?? 0
  const capacity    = c?.totalCapacity ?? Math.max(0, creditLimit + available - used)
  const zeroFunds   = available === 0 && frozen === 0 && creditLimit === 0

  const unlimited   = pl?.limit === null && pl !== undefined
  const slotPct     = pl && pl.limit ? Math.min(100, Math.round(pl.current / pl.limit * 100)) : 0
  const barColor    = unlimited ? '#16a34a' : slotPct >= 100 ? '#dc2626' : slotPct >= 70 ? '#f59e0b' : '#3b82f6'
  const isLow       = !unlimited && !!pl && slotPct >= 70

  return (
    <div
      className="rounded-xl px-4 py-2.5 mb-5 flex items-center gap-4 flex-wrap relative"
      style={{ background: '#fff', border: `1px solid ${isLow ? '#fca5a5' : 'var(--border)'}` }}
    >
      {/* 可发布任务 X/Y + 迷你进度条 */}
      <div className="flex items-center gap-2.5">
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{t('credit.capacityTitle')}</span>
        <span className="text-base font-bold tabular-nums" style={{ color: unlimited ? '#16a34a' : slotPct >= 100 ? '#dc2626' : '#1d4ed8' }}>
          {pl?.current ?? 0}<span className="text-sm font-semibold" style={{ color: '#9ca3af' }}> / {unlimited ? '∞' : pl?.limit ?? '—'}</span>
        </span>
        {!unlimited && pl?.limit ? (
          <span className="inline-block h-1.5 w-20 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
            <span className="block h-full rounded-full transition-all"
              style={{ width: `${pl.current > 0 ? Math.max(4, slotPct) : 0}%`, background: barColor }} />
          </span>
        ) : null}
      </div>

      <span style={{ color: 'var(--border)' }}>|</span>

      {/* 可用预算（点击进钱包看明细） */}
      <button
        type="button"
        onClick={() => navigate('/wallet')}
        className="text-xs cursor-pointer tabular-nums bg-transparent"
        style={{ color: 'var(--muted)' }}
        title={`${t('credit.formulaCash')} ¥${available.toLocaleString()}${creditLimit > 0 ? ` ＋ ${t('credit.creditLimit')} ¥${creditLimit.toLocaleString()}` : ''}${used > 0 ? ` － ${t('credit.formulaUsed')} ¥${used.toLocaleString()}` : ''}`}
      >
        {t('credit.budget')} <span className="font-semibold" style={{ color: capacity > 0 ? 'var(--text)' : '#dc2626' }}>¥{capacity.toLocaleString()}</span>
      </button>

      <div className="flex-1" />

      {/* 右侧动作区：订阅徽章 或 提升按钮（+零余额充值） */}
      {unlimited ? (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>
          ✨ {t('credit.subBadge', { plan: t(`subscribe.plan_${pl?.subscriptionPlan || 'basic'}`) })}
        </span>
      ) : (
        <>
          {isLow && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fee2e2', color: '#dc2626' }}>
              {t('credit.slotLow')}
            </span>
          )}
          <button
            type="button"
            onClick={() => setLadderOpen(!ladderOpen)}
            className="relative text-xs font-bold px-3 py-1.5 rounded-full text-white cursor-pointer transition-transform hover:scale-105"
            style={{ background: 'linear-gradient(90deg,var(--primary),#7c3aed)' }}
          >
            {isLow && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-ping" style={{ background: '#f59e0b' }} />}
            🚀 {t('credit.upgradeBubble')}
          </button>
          {zeroFunds && (
            <button
              type="button"
              onClick={() => navigate('/wallet')}
              className="text-xs font-semibold px-3 py-1.5 rounded-full text-white cursor-pointer transition-opacity hover:opacity-90"
              style={{ background: '#d97706' }}
            >
              {t('credit.topupNow')} →
            </button>
          )}
        </>
      )}

      {/* 阶梯弹层（交互不变） */}
      {ladderOpen && !unlimited && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setLadderOpen(false)} />
          <div className="absolute right-2 top-12 z-50 w-96 rounded-2xl p-4 shadow-xl"
            style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <div className="text-sm font-bold mb-1">{t('credit.ladderTitle')}</div>
            <div className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{t('credit.ladderSub')}</div>
            <LadderRows pl={pl!} onAction={(to) => { setLadderOpen(false); navigate(to) }} />
          </div>
        </>
      )}
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation()
  // PENDING_REVIEW 是真状态（2026-07-26 状态机补齐，见 contracts.ts TASK_STATUSES），直接映射词条
  const key = status.toLowerCase()
  const map: Record<string, { bg: string; color: string }> = {
    open: { bg: '#dcfce7', color: '#16a34a' },
    pending_review: { bg: '#fef3c7', color: '#d97706' },
    draft: { bg: '#f3f4f6', color: '#6b7280' },
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

  const { user } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter, user?.id],
    // creator 必传：不传时服务端返回全平台公开任务列表（「我的任务」曾误显示他人任务）
    queryFn: () => tasksApi.list({ status: statusFilter || undefined, creator: user?.id }).then((r) => r.data),
    enabled: !!user?.id,
  })
  const { data: balance } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => walletApi.brandBalance().then((r) => r.data),
  })

  const tasks = data?.tasks || []
  // val 传给服务端做精确匹配，须与 DB 状态值大小写一致（此前小写 'open' 恒查空）
  const filters = [
    { val: '', label: t('tasks.filterAll') },
    { val: 'OPEN', label: t('tasks.filterOpen') },
    { val: 'PENDING_REVIEW', label: t('status.pending_review') },
    { val: 'DRAFT', label: t('tasks.filterDraft') },
  ]

  return (
    <div className="flex flex-col min-h-screen">
      {/* 主 CTA 已移入内容区筛选行（一个页面一个主按钮，紧挨其作用的列表） */}
      <Topbar title={t('tasks.title')} />

      <div className="p-7 flex-1">
        {/* Credit banner */}
        {balance && <CreditBanner balance={balance} />}

        {/* Filter + 主CTA：创建按钮紧挨列表（此前在 Topbar 右上角离内容太远） */}
        <div className="flex gap-2 mb-5 items-center">
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
          <div className="flex-1" />
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90"
            style={{ background: 'var(--primary)', color: '#fff' }}
            onClick={() => navigate('/tasks/new')}
          >
            <Plus size={15} />
            {t('tasks.createTask')}
          </button>
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
                <tr><td colSpan={5} className="px-5 py-12 text-center">
                  <div className="text-sm mb-4" style={{ color: 'var(--muted)' }}>{t('tasks.emptyTitle')}</div>
                  {/* 空态中央 CTA：此前文案让人"点击创建任务"但按钮在屏幕对角 */}
                  <button
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-opacity hover:opacity-90"
                    style={{ background: 'var(--primary)' }}
                    onClick={() => navigate('/tasks/new')}
                  >
                    <Plus size={15} /> {t('tasks.emptyCta')}
                  </button>
                </td></tr>
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
