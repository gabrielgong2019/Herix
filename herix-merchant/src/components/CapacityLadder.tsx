import { useTranslation } from 'react-i18next'
import type { BrandBalance } from '@/lib/api'

type PublishLimit = NonNullable<BrandBalance['publishLimit']>

/** 发布数量阶梯行（Tasks 卡弹层 与 发布被拦引导 共用）。
 *  当前档高亮；已达成打✓；未达成给行动按钮，订阅行带成交兜底副文案（订阅卖点
 *  不是"发更多任务"而是顾问+兜底，从数量入口进来的商户需要看到这层价值） */
export function LadderRows({ pl, onAction }: { pl: PublishLimit; onAction: (to: string) => void }) {
  const { t } = useTranslation()
  const unlimited = pl.limit === null
  const tiers = [
    { key: 'BASE', label: t('credit.tierBase'), sub: null as string | null, limit: String(pl.baseLimit ?? 3),
      done: true, action: null as null | { label: string; to: string } },
    { key: 'KYB', label: t('credit.tierKyb'), sub: null, limit: String(pl.kybLimit ?? 10),
      done: !!pl.kybApproved, action: { label: t('credit.tierKybGo'), to: '/settings' } },
    { key: 'FUNDED', label: t('credit.tierFunded', { amount: (pl.fundedThreshold ?? 300000).toLocaleString() }), sub: null, limit: String(pl.fundedLimit ?? 20),
      done: !!pl.funded, action: { label: t('credit.tierFundedGo'), to: '/wallet' } },
    { key: 'SUBSCRIPTION', label: t('credit.tierSub'), sub: t('credit.tierSubSub'), limit: '∞',
      done: unlimited, action: { label: t('credit.viewPricing'), to: '/subscribe' } },
  ]
  const currentKey = pl.tier === 'OVERRIDE' ? 'BASE' : pl.tier

  return (
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
              {tier.sub && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{tier.sub}</div>}
              {isCurrent && <div className="text-[11px]" style={{ color: '#1d4ed8' }}>{t('credit.currentTier')}</div>}
            </div>
            {tier.done && !isCurrent ? (
              <span className="text-xs" style={{ color: '#16a34a' }}>✓</span>
            ) : tier.action && !tier.done ? (
              <button
                type="button"
                onClick={() => onAction(tier.action!.to)}
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
  )
}
