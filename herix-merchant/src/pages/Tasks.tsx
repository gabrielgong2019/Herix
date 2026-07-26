import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { tasksApi, walletApi, type BrandBalance } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Topbar } from '@/components/layout/Topbar'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/utils'

/** 发布能力卡（2026-07-26 与用户定稿，同日按用户反馈二改）：
 *  主指标 = 进行中任务 X/Y 常显（零余额新商户注册档也能发 3 个，旧版零态卡片
 *  只让人充值、连额度都不显示是误导）；右上角脉冲气泡吸引点击，弹层展示
 *  四级阶梯（当前档高亮）+ 认证/充值/订阅三条提升路径，订阅直达定价方案 */
function CreditBanner({ balance }: { balance: BrandBalance }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [ladderOpen, setLadderOpen] = useState(false)
  const c = balance.credit
  const pl = balance.publishLimit

  const creditLimit = c?.initialCredit || 0
  const available   = balance.available || 0
  const frozen      = balance.frozen || 0
  // 在途任务占用（共享池口径）：还可发布 = 现金 + 信用额度 − 占用，三项严格可心算
  const used        = c?.sharedUsed ?? c?.creditUsed ?? 0
  const capacity    = c?.totalCapacity ?? Math.max(0, creditLimit + available - used)
  const zeroFunds   = available === 0 && frozen === 0 && creditLimit === 0

  const unlimited   = pl?.limit === null && pl !== undefined
  const slotPct     = pl && pl.limit ? Math.min(100, Math.round(pl.current / pl.limit * 100)) : 0
  const barColor    = unlimited ? '#16a34a' : slotPct >= 100 ? '#dc2626' : slotPct >= 70 ? '#f59e0b' : '#3b82f6'
  const isLow       = !unlimited && !!pl && slotPct >= 70

  // 阶梯数据（弹层用）：当前档高亮，已达成的打✓，未达成的给行动按钮
  const tiers = pl ? [
    { key: 'BASE', label: t('credit.tierBase'), limit: String(pl.baseLimit ?? 3),
      done: true, action: null as null | { label: string; to: string } },
    { key: 'KYB', label: t('credit.tierKyb'), limit: String(pl.kybLimit ?? 10),
      done: !!pl.kybApproved, action: { label: t('credit.tierKybGo'), to: '/settings' } },
    { key: 'FUNDED', label: t('credit.tierFunded', { amount: (pl.fundedThreshold ?? 1000000).toLocaleString() }), limit: String(pl.fundedLimit ?? 20),
      done: !!pl.funded, action: { label: t('credit.tierFundedGo'), to: '/wallet' } },
    { key: 'SUBSCRIPTION', label: t('credit.tierSub'), limit: '∞',
      done: unlimited, action: { label: t('credit.viewPricing'), to: '/subscribe' } },
  ] : []
  const currentKey = pl?.tier === 'OVERRIDE' ? 'BASE' : pl?.tier

  return (
    <div
      className="rounded-2xl p-5 mb-5 relative"
      style={{ background: 'linear-gradient(135deg,#eff6ff 0%,#f0fdf4 100%)', border: `1px solid ${isLow ? '#fca5a5' : '#bfdbfe'}` }}
    >
      {/* Header row：右侧订阅徽章 或 提升气泡（脉冲吸引点击） */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold" style={{ color: '#1e40af' }}>
          {t('credit.capacityTitle')}
          {isLow && (
            <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fee2e2', color: '#dc2626' }}>
              {t('credit.slotLow')}
            </span>
          )}
        </div>
        {unlimited ? (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>
            ✨ {t('credit.subBadge', { plan: t(`subscribe.plan_${pl?.subscriptionPlan || 'basic'}`) })}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setLadderOpen(!ladderOpen)}
            className="relative text-xs font-bold px-3.5 py-1.5 rounded-full text-white cursor-pointer transition-transform hover:scale-105"
            style={{ background: 'linear-gradient(90deg,var(--primary),#7c3aed)', boxShadow: '0 2px 10px rgba(200,60,60,.35)' }}
          >
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-ping" style={{ background: '#f59e0b' }} />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} />
            🚀 {t('credit.upgradeBubble')}
          </button>
        )}
      </div>

      {/* 阶梯弹层：当前档高亮 + 三条提升路径，订阅直达定价方案 */}
      {ladderOpen && !unlimited && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setLadderOpen(false)} />
          <div className="absolute right-4 top-14 z-50 w-96 rounded-2xl p-4 shadow-xl"
            style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <div className="text-sm font-bold mb-1">{t('credit.ladderTitle')}</div>
            <div className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{t('credit.ladderSub')}</div>
            <div className="space-y-2">
              {tiers.map((tier) => {
                const isCurrent = tier.key === currentKey
                return (
                  <div key={tier.key}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={isCurrent
                      ? { background: '#eff6ff', border: '1px solid #bfdbfe' }
                      : { border: '1px solid var(--border)' }}>
                    <div className="text-lg font-bold tabular-nums w-10 text-center"
                      style={{ color: tier.key === 'SUBSCRIPTION' ? '#16a34a' : isCurrent ? '#1d4ed8' : 'var(--muted)' }}>
                      {tier.limit}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{tier.label}</div>
                      {isCurrent && <div className="text-[11px]" style={{ color: '#1d4ed8' }}>{t('credit.currentTier')}</div>}
                    </div>
                    {tier.done && !isCurrent ? (
                      <span className="text-xs" style={{ color: '#16a34a' }}>✓</span>
                    ) : tier.action && !tier.done ? (
                      <button
                        type="button"
                        onClick={() => { setLadderOpen(false); navigate(tier.action!.to) }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-opacity hover:opacity-85"
                        style={tier.key === 'SUBSCRIPTION'
                          ? { background: 'var(--primary)', color: '#fff' }
                          : { background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                        {tier.action.label}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* 主指标：进行中任务 X/Y（订阅=∞）——商家最先要知道的是还能不能发 */}
      {pl && (
        <div className="mb-1">
          <div className="text-xs mb-1" style={{ color: '#6b7280' }}>{t('credit.openTasks')}</div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: unlimited ? '#16a34a' : slotPct >= 100 ? '#dc2626' : '#1d4ed8' }}>
            {pl.current}
            <span className="text-xl font-semibold" style={{ color: '#9ca3af' }}> / {unlimited ? '∞' : pl.limit}</span>
          </div>
        </div>
      )}
      {!unlimited && pl?.limit ? (
        <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: '#e0e7ff' }}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pl.current > 0 ? Math.max(2, slotPct) : 0}%`, background: `linear-gradient(90deg,${barColor},#7c3aed)` }} />
        </div>
      ) : <div className="mb-3" />}

      {/* 资金次要信息行：还可发布额度 = 现金 + 信用 − 占用（严格等式），完整资金看钱包页 */}
      <div className="text-xs tabular-nums" style={{ color: '#6b7280' }}>
        {t('credit.capacityMain')} <span className="font-semibold" style={{ color: capacity > 0 ? '#374151' : '#dc2626' }}>¥{capacity.toLocaleString()}</span>
        <span> · {t('credit.formulaCash')} ¥{available.toLocaleString()}</span>
        {creditLimit > 0 && <> ＋ {t('credit.creditLimit')} ¥{creditLimit.toLocaleString()}</>}
        {used > 0 && <> － {t('credit.formulaUsed')} ¥{used.toLocaleString()}</>}
        {frozen > 0 && <span> · {t('credit.walletFrozen')} ¥{frozen.toLocaleString()}</span>}
      </div>

      {/* 零余额新商户：托管信任文案 + 充值入口（发布能力照常显示——注册档即可发首单，体验额度兜底） */}
      {zeroFunds && (
        <div className="mt-3 pt-3 flex items-center justify-between gap-4 flex-wrap" style={{ borderTop: '1px solid #bfdbfe' }}>
          <div className="flex gap-4 text-xs" style={{ color: '#6b7280' }}>
            {['credit.escrowTag1', 'credit.escrowTag2', 'credit.escrowTag3'].map((key) => (
              <span key={key}>✓ {t(key)}</span>
            ))}
          </div>
          <button
            onClick={() => navigate('/wallet')}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-lg text-white cursor-pointer transition-opacity hover:opacity-90"
            style={{ background: '#d97706' }}
          >
            {t('credit.topupNow')} →
          </button>
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
