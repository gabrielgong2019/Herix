import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { walletApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { formatDate } from '@/lib/utils'

const TX_COLORS: Record<string, { bg: string; color: string; sign: string }> = {
  recharge: { bg: '#dcfce7', color: '#16a34a', sign: '+' },
  payout: { bg: '#fee2e2', color: '#dc2626', sign: '-' },
  refund: { bg: '#e0e7ff', color: '#4338ca', sign: '+' },
  fee: { bg: '#fef3c7', color: '#d97706', sign: '-' },
}

const TX_LABELS: Record<string, string> = {
  recharge: '充值', payout: '打款', refund: '退款', fee: '服务费',
}

export default function Wallet() {
  const { t } = useTranslation()

  const { data: balanceData } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => walletApi.balance().then((r) => r.data),
  })

  const { data: txData, isLoading } = useQuery({
    queryKey: ['wallet-tx'],
    queryFn: () => walletApi.transactions().then((r) => r.data),
  })

  const txs = txData?.items || []

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('wallet.title')} />

      <div className="p-7 flex-1">
        {/* Balance card */}
        <div className="rounded-2xl p-6 mb-6" style={{ background: '#fff' }}>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>{t('wallet.balance')}</div>
              <div className="text-4xl font-bold" style={{ color: 'var(--text)' }}>
                ¥{balanceData ? balanceData.credits.toLocaleString() : '—'}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                className="px-5 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--primary)', color: '#fff' }}
              >
                {t('wallet.recharge')}
              </button>
            </div>
          </div>
        </div>

        {/* Transactions */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          <div className="px-5 py-4 border-b text-sm font-semibold" style={{ borderColor: 'var(--border)' }}>
            {t('wallet.transactions')}
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['类型', '金额', '时间', '备注'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('common.loading')}</td></tr>
              )}
              {!isLoading && txs.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>暂无记录</td></tr>
              )}
              {txs.map((tx) => {
                const style = TX_COLORS[tx.type] || { bg: '#f3f4f6', color: '#6b7280', sign: '' }
                return (
                  <tr key={tx.id}>
                    <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold" style={{ background: style.bg, color: style.color }}>
                        {TX_LABELS[tx.type] || tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold" style={{ borderBottom: '1px solid var(--border)', color: style.color }}>
                      {style.sign}¥{tx.amount.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                      {formatDate(tx.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                      {tx.note || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
