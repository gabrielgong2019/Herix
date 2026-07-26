import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { walletApi, type BrandBalance, type TopupRequest, type WalletEntry } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'

// ── helpers ──────────────────────────────────────────────────────
function getPeriodRange(period: string): { from: string; to: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`

  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    return { from: fmt(from), to: to.toISOString() }
  }
  if (period === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    return { from: fmt(from), to: to.toISOString() }
  }
  if (period === '7d') {
    const from = new Date(Date.now() - 7 * 86400000)
    return { from: fmt(from), to: new Date().toISOString() }
  }
  if (period === '30d') {
    const from = new Date(Date.now() - 30 * 86400000)
    return { from: fmt(from), to: new Date().toISOString() }
  }
  return { from: '2020-01-01T00:00:00.000Z', to: new Date().toISOString() }
}

function genTopupRef() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
  return `TP${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${rand}`
}

function fmtLocal(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── Balance card ─────────────────────────────────────────────────
function BalanceCard({ data }: { data: BrandBalance }) {
  const { t } = useTranslation()
  const cur = data.currency || 'JPY'
  const total  = (data.available || 0) + (data.frozen || 0)
  const frozen = data.frozen || 0
  const avail  = data.available || 0

  const stat = (label: string, val: number, color: string, sub: string) => (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        ¥{val.toLocaleString()} {cur}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{sub}</div>
    </div>
  )

  return (
    <div style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#1a4731 100%)', borderRadius: 14, padding: '18px 20px', marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'rgba(255,255,255,0.85)', marginBottom: 14 }}>{t('wallet.accountBalance')}</div>
      <div className="grid grid-cols-3 gap-3">
        {stat(t('wallet.totalBalance'), total, '#fff', t('wallet.totalSub'))}
        {stat(t('wallet.frozen'), frozen, frozen > 0 ? '#fbbf24' : 'rgba(255,255,255,0.4)', t('wallet.frozenSub'))}
        {stat(t('wallet.available'), avail, avail < 0 ? '#f87171' : avail > 0 ? '#6ee7b7' : 'rgba(255,255,255,0.4)', t('wallet.availableSub'))}
      </div>
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────
function StepIndicator({ step }: { step: number }) {
  const { t } = useTranslation()
  const labels = [t('wallet.step1'), t('wallet.step2'), t('wallet.step3'), t('wallet.step4')]
  return (
    <div className="flex items-center justify-center mb-8">
      {labels.map((label, i) => {
        const n = i + 1
        const active = n === step
        const done   = n < step
        return (
          <>
            <div key={n} className="flex flex-col items-center gap-1.5" style={{ minWidth: 56 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: done ? '#16a34a' : active ? 'var(--primary)' : '#e5e7eb',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}>
                {done ? '✓' : n}
              </div>
              <div style={{
                fontSize: 11, whiteSpace: 'nowrap',
                color: active ? 'var(--primary)' : done ? '#16a34a' : '#9ca3af',
                fontWeight: active ? 600 : 400,
              }}>{label}</div>
            </div>
            {i < labels.length - 1 && (
              <div key={`line-${i}`} style={{ flex: 1, height: 2, background: n < step ? '#16a34a' : '#e5e7eb', margin: '0 4px', marginBottom: 22 }} />
            )}
          </>
        )
      })}
    </div>
  )
}

// 共享按钮样式（2026-07-27 修复：此前 className="btn btn-primary/outline" 引用的全局 CSS
// 类在本 Tailwind 项目里从未定义过，Preflight 清空了 button 默认样式，渲染成裸文本无边框）
const BTN_PRIMARY: React.CSSProperties = {
  padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none',
  background: 'var(--primary)', color: '#fff', cursor: 'pointer',
}
const BTN_OUTLINE: React.CSSProperties = {
  padding: '10px 20px', fontSize: 14, fontWeight: 500, borderRadius: 10,
  border: '1px solid var(--border)', background: '#fff', color: 'var(--text)', cursor: 'pointer',
}

// ── Step 1 ────────────────────────────────────────────────────────
const PRESETS = [1000, 3000, 5000, 10000, 30000, 50000]

function Step1({ amount, setAmount, onNext }: { amount: number; setAmount: (n: number) => void; onNext: () => void }) {
  const { t } = useTranslation()
  const ok = amount >= 1000
  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <div className="text-center text-sm mb-4" style={{ color: 'var(--muted)' }}>{t('wallet.amountLabel')}</div>

      <div className="flex justify-center mb-1.5">
        <div className="inline-flex items-center gap-1.5" style={{ borderBottom: '2px solid var(--primary)', padding: '0 4px 8px' }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: '#111' }}>¥</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={amount > 0 ? amount : ''}
            onChange={e => {
              const v = parseFloat(e.target.value)
              setAmount(isNaN(v) || v < 0 ? 0 : v)
            }}
            style={{ fontSize: 40, fontWeight: 800, color: '#111', border: 'none', outline: 'none', width: 200, background: 'transparent', padding: 0 }}
          />
        </div>
      </div>

      <div className="text-center mb-6">
        <span
          onClick={() => setAmount(0)}
          style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
        >{t('wallet.clear')}</span>
      </div>

      <div className="text-sm mb-2.5" style={{ color: 'var(--muted)' }}>{t('wallet.clickToAdd')}</div>
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        {PRESETS.map(p => (
          <div
            key={p}
            onClick={() => setAmount((amount || 0) + p)}
            className="text-center font-semibold cursor-pointer transition-all hover:border-gray-400"
            style={{ padding: '14px 8px', borderRadius: 10, border: '2px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 15 }}
          >
            +¥{p.toLocaleString()}
          </div>
        ))}
      </div>

      <div className="text-center">
        <button
          style={{ minWidth: 160, padding: '12px 24px', fontSize: 15, fontWeight: 600, borderRadius: 10, border: 'none',
            background: 'var(--primary)', color: '#fff', cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.5 }}
          onClick={() => ok && onNext()}
          disabled={!ok}
        >{t('wallet.nextBtn')}</button>
        {!ok && <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{t('wallet.minAmount')}</div>}
      </div>
    </div>
  )
}

// ── Step 2 ────────────────────────────────────────────────────────
function Step2({ amount, onBack, onNext }: { amount: number; onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation()
  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      <div className="text-center mb-5">
        <div className="text-sm mb-1" style={{ color: 'var(--muted)' }}>{t('wallet.topupAmount')}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#111' }}>¥{amount.toLocaleString()}</div>
      </div>

      <div style={{ border: '2px solid var(--primary)', borderRadius: 14, padding: '18px 20px', marginBottom: 24, background: '#eff6ff' }}>
        <div className="flex items-center gap-4">
          <div style={{ fontSize: 32, width: 48, textAlign: 'center' }}>🏦</div>
          <div className="flex-1">
            <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{t('wallet.bankTransfer')}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t('wallet.bankTransferFee')}</div>
          </div>
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--primary)', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
          </div>
        </div>
      </div>

      <div className="flex gap-2.5 justify-center">
        <button style={BTN_OUTLINE} onClick={onBack}>{t('wallet.backBtn')}</button>
        <button style={{ ...BTN_PRIMARY, minWidth: 120 }} onClick={onNext}>{t('wallet.nextBtn')}</button>
      </div>
    </div>
  )
}

// ── Step 3 ────────────────────────────────────────────────────────
function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function BankRow({ label, value, highlight, copyable, copyLabel }: {
  label: string; value: string; highlight?: boolean; copyable?: boolean; copyLabel?: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid #f3f4f6', background: highlight ? '#fffbeb' : 'transparent' }}>
      <span style={{ fontSize: 12, color: highlight ? '#92400e' : 'var(--muted)', fontWeight: highlight ? 700 : 400, minWidth: 90 }}>{label}</span>
      <div className="flex items-center gap-2">
        <span style={{ fontSize: highlight ? 14 : 13, fontWeight: highlight ? 800 : 500, color: highlight ? '#b45309' : '#111', letterSpacing: highlight ? '.5px' : undefined }}>{value}</span>
        {copyable && (
          <button
            onClick={() => copyText(value)}
            style={{ fontSize: 10, padding: '2px 8px', border: `1px solid ${highlight ? '#f59e0b' : '#e5e7eb'}`, borderRadius: 4, cursor: 'pointer', color: highlight ? '#92400e' : 'var(--muted)', background: '#f9fafb', fontWeight: highlight ? 600 : 400 }}
          >{copyLabel}</button>
        )}
      </div>
    </div>
  )
}

function Step3({ amount, topupRef, onBack, onSubmit, submitting }: {
  amount: number; topupRef: string; onBack: () => void; onSubmit: () => void; submitting: boolean
}) {
  const { t } = useTranslation()
  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 16, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#166534', marginBottom: 4 }}>{t('wallet.transferInstructions')}</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#15803d' }}>¥{amount.toLocaleString()}</div>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <BankRow label={t('wallet.bankPayee')} value="カ）アフターワークスタジオ" copyLabel={t('wallet.copyBtn')} />
        <BankRow label={t('wallet.bankName')} value="みずほ銀行" copyable copyLabel={t('wallet.copyBtn')} />
        <BankRow label={t('wallet.bankBranch')} value="渋谷支店（支店番号 210）" copyLabel={t('wallet.copyBtn')} />
        <BankRow label={t('wallet.bankAcctType')} value="普通預金" copyLabel={t('wallet.copyBtn')} />
        <BankRow label={t('wallet.bankAcctNum')} value="3214958" copyLabel={t('wallet.copyBtn')} />
        <BankRow label={t('wallet.bankRef')} value={topupRef} highlight copyable copyLabel={t('wallet.copyBtn')} />
      </div>

      <div style={{ background: '#fff8e1', borderLeft: '4px solid #f59e0b', borderRadius: '0 10px 10px 0', padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>{t('wallet.refWarningTitle')}</div>
        <div
          style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: t('wallet.refWarningBody').replace('{{ref}}', `<b>${topupRef}</b>`) }}
        />
      </div>

      <div className="flex gap-5 justify-center mb-6">
        {[t('wallet.safePayment'), t('wallet.opConfirm'), t('wallet.notification')].map(s => (
          <div key={s} style={{ fontSize: 11, color: 'var(--muted)' }}>{s}</div>
        ))}
      </div>

      <div className="flex gap-2.5 justify-center">
        <button style={BTN_OUTLINE} onClick={onBack}>{t('wallet.backBtn')}</button>
        <button
          style={{ ...BTN_PRIMARY, padding: '12px 28px', fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? t('wallet.submitting') : t('wallet.submitTransfer')}
        </button>
      </div>
    </div>
  )
}

// ── Step 4 ────────────────────────────────────────────────────────
function Step4({ amount, topupRef, onReset }: { amount: number; topupRef: string; onReset: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="text-center" style={{ padding: '8px 0' }}>
      <div style={{ width: 70, height: 70, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 32 }}>✅</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t('wallet.submittedTitle')}</div>
      <div className="text-sm mb-6" style={{ color: 'var(--muted)' }}>{t('wallet.submittedSub')}</div>

      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 14, padding: 20, maxWidth: 300, margin: '0 auto 24px' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{t('wallet.refNum')}</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1, color: '#111', marginBottom: 12 }}>{topupRef}</div>
        <div className="flex justify-between text-sm" style={{ padding: '8px 0', borderTop: '1px solid #e5e7eb' }}>
          <span style={{ color: 'var(--muted)' }}>{t('wallet.topupAmount')}</span><b>¥{amount.toLocaleString()}</b>
        </div>
        <div className="flex justify-between text-sm" style={{ padding: '8px 0', borderTop: '1px solid #e5e7eb' }}>
          <span style={{ color: 'var(--muted)' }}>{t('wallet.estimatedArrivalLabel')}</span><b>{t('wallet.estimatedArrival')}</b>
        </div>
      </div>

      <div className="text-xs mb-6" style={{ color: 'var(--muted)' }}>{t('wallet.supportEmail')}</div>
      <button style={BTN_OUTLINE} onClick={onReset}>{t('wallet.backToWallet')}</button>
    </div>
  )
}

// ── Topup Wizard ──────────────────────────────────────────────────
function TopupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep]           = useState(1)
  const [amount, setAmount]       = useState(0)
  const [topupRef, setTopupRef]   = useState('')
  const { mutateAsync, isPending } = useMutation({ mutationFn: ({ amount, note }: { amount: number; note: string }) => walletApi.submitTopup(amount, note) })
  const qc = useQueryClient()

  const goNext = () => {
    if (step === 1) setStep(2)
    if (step === 2) { setTopupRef(genTopupRef()); setStep(3) }
  }

  const handleSubmit = async () => {
    try {
      await mutateAsync({ amount, note: topupRef })
      setStep(4)
      qc.invalidateQueries({ queryKey: ['wallet-balance'] })
      qc.invalidateQueries({ queryKey: ['topup-history'] })
    } catch { /* error silently handled */ }
  }

  const reset = () => { setStep(1); setAmount(0); setTopupRef(''); onDone() }

  return (
    <div className="rounded-2xl p-8 mb-5" style={{ background: '#fff' }}>
      <StepIndicator step={step} />
      {step === 1 && <Step1 amount={amount} setAmount={setAmount} onNext={goNext} />}
      {step === 2 && <Step2 amount={amount} onBack={() => setStep(1)} onNext={goNext} />}
      {step === 3 && <Step3 amount={amount} topupRef={topupRef} onBack={() => setStep(2)} onSubmit={handleSubmit} submitting={isPending} />}
      {step === 4 && <Step4 amount={amount} topupRef={topupRef} onReset={reset} />}
    </div>
  )
}

// ── Pending topups ────────────────────────────────────────────────
function PendingTopups({ data }: { data: TopupRequest[] }) {
  const { t } = useTranslation()
  const pending = data.filter(r => r.status !== 'confirmed')
  if (!pending.length) return null

  const statusColor: Record<string, string> = { pending: '#f59e0b', rejected: '#ef4444' }
  const statusLabelKey: Record<string, string> = { pending: 'wallet.statusPending', rejected: 'wallet.statusRejected' }

  return (
    <div className="rounded-2xl overflow-hidden mb-5" style={{ background: '#fff' }}>
      <div className="px-5 py-4 font-semibold text-sm" style={{ borderBottom: '1px solid var(--border)' }}>{t('wallet.topupApplications')}</div>
      <table className="w-full">
        <thead>
          <tr style={{ background: '#fafafa' }}>
            {[t('wallet.colRef'), t('wallet.colAmount'), t('wallet.colTime'), t('wallet.colStatus')].map(h => (
              <th key={h} className="px-5 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pending.map(r => (
            <tr key={r.id}>
              <td className="px-5 py-3 text-xs font-mono" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{r.note || '—'}</td>
              <td className="px-5 py-3 font-semibold text-sm" style={{ borderBottom: '1px solid var(--border)' }}>¥{Number(r.amount).toLocaleString()} {r.currency}</td>
              <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{fmtLocal(r.created_at)}</td>
              <td className="px-5 py-3 text-sm font-semibold" style={{ borderBottom: '1px solid var(--border)', color: statusColor[r.status] || '#6b7280' }}>
                {statusLabelKey[r.status] ? t(statusLabelKey[r.status]) : r.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Wallet ledger ─────────────────────────────────────────────────
const PERIOD_KEYS = [
  { key: 'month', labelKey: 'wallet.periodMonth' },
  { key: 'last_month', labelKey: 'wallet.periodLastMonth' },
  { key: '7d', labelKey: 'wallet.period7d' },
  { key: '30d', labelKey: 'wallet.period30d' },
  { key: 'all', labelKey: 'wallet.periodAll' },
]

function WalletLedger({ period, onPeriodChange }: { period: string; onPeriodChange: (p: string) => void }) {
  const { t } = useTranslation()
  const range = getPeriodRange(period)
  const { data, isLoading } = useQuery({
    queryKey: ['wallet-ledger', period],
    queryFn: () => walletApi.transactions(range).then(r => r.data),
  })

  const rows: WalletEntry[] = data?.transactions || []

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
      <div className="flex items-center justify-between px-5 py-4 flex-wrap gap-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="font-semibold text-sm">{t('wallet.ledgerTitle')}</div>
        <div className="flex gap-1.5 flex-wrap">
          {PERIOD_KEYS.map(p => (
            <div
              key={p.key}
              onClick={() => onPeriodChange(p.key)}
              className="cursor-pointer"
              style={{ padding: '5px 12px', borderRadius: 16, fontSize: 12, background: period === p.key ? '#111' : '#f3f4f6', color: period === p.key ? '#fff' : '#555' }}
            >
              {t(p.labelKey)}
            </div>
          ))}
        </div>
      </div>

      {data && (
        <div className="flex gap-6 px-5 py-3" style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('wallet.periodInflow')}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>+¥{(data.periodInflow || 0).toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('wallet.periodOutflow')}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626' }}>-¥{(data.periodOutflow || 0).toLocaleString()}</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>{t('common.loading')}</div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>{t('wallet.ledgerEmpty')}</div>
      )}

      {rows.length > 0 && (
        <table className="w-full">
          <thead>
            <tr style={{ background: '#fafafa' }}>
              {[t('wallet.colTime'), t('wallet.colType'), t('wallet.colNote'), t('wallet.colAmount')].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-5 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{fmtLocal(r.created_at)}</td>
                <td className="px-5 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>{t(`wallet.entryType.${r.type}`, r.type)}</td>
                <td className="px-5 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{r.note || '—'}</td>
                <td className="px-5 py-3 text-sm font-semibold" style={{ borderBottom: '1px solid var(--border)', color: r.direction === 'out' ? '#dc2626' : '#16a34a' }}>
                  {r.direction === 'out' ? '-' : '+'}¥{Math.abs(Number(r.amount)).toLocaleString()} {r.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function Wallet() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState('month')
  const qc = useQueryClient()

  const { data: balanceData } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => walletApi.brandBalance().then(r => r.data),
  })

  const { data: topupHistory } = useQuery({
    queryKey: ['topup-history'],
    queryFn: () => walletApi.topupHistory().then(r => r.data),
  })

  const handleTopupDone = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['wallet-balance'] })
    qc.invalidateQueries({ queryKey: ['wallet-ledger'] })
    qc.invalidateQueries({ queryKey: ['topup-history'] })
  }, [qc])

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('wallet.title')} />

      <div className="p-7 flex-1">
        {balanceData && <BalanceCard data={balanceData} />}

        <TopupWizard onDone={handleTopupDone} />

        {topupHistory && <PendingTopups data={topupHistory} />}

        <WalletLedger period={period} onPeriodChange={setPeriod} />
      </div>
    </div>
  )
}
