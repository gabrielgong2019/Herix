import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  subscriptionsApi, type SubscriptionPlanInfo, type MerchantSubscription, type SubscriptionInvoice,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Topbar } from '@/components/layout/Topbar'
import { Check, Minus, Sparkles, Crown, Building2, ArrowRight, ReceiptText, ClipboardList, Banknote, Zap, Rocket, Download } from 'lucide-react'
import { formatDate } from '@/lib/utils'

import { CYCLE_MONTHS, BILLING_CYCLES, type BillingCycle as Cycle } from '@contracts'

const PLAN_LABEL: Record<string, string> = { basic: '基础版', premium: '高级版', custom: '定制版' }
const CYCLE_LABEL: Record<string, string> = { monthly: '月付', quarterly: '季付', annual: '年付' }

function printInvoice(
  inv: SubscriptionInvoice,
  sub: MerchantSubscription,
  companyName: string,
  contactName: string,
) {
  const issueDate = new Date(inv.created_at).toLocaleDateString('zh-CN')
  const periodStart = sub.current_period_start ? new Date(sub.current_period_start).toLocaleDateString('zh-CN') : '—'
  const periodEnd   = sub.current_period_end   ? new Date(sub.current_period_end).toLocaleDateString('zh-CN')   : '—'
  const planLabel   = PLAN_LABEL[sub.plan_code] ?? sub.plan_code
  const cycleLabel  = CYCLE_LABEL[sub.billing_cycle] ?? sub.billing_cycle
  const statusLabel = inv.status === 'PAID' ? '已支付' : inv.status === 'VOID' ? '已作废' : '待支付'

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">
<title>请求书 ${inv.invoice_no}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Hiragino Sans", "Noto Sans CJK SC", sans-serif; color: #111; padding: 48px; max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: 2px; }
  .brand-sub { font-size: 11px; color: #666; margin-top: 2px; }
  .doc-title { font-size: 28px; font-weight: 700; text-align: right; }
  .doc-no { font-size: 12px; color: #666; text-align: right; margin-top: 4px; }
  .divider { border: none; border-top: 2px solid #111; margin: 0 0 32px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 36px; }
  .meta-block dt { font-size: 11px; color: #888; margin-bottom: 4px; }
  .meta-block dd { font-size: 13px; font-weight: 500; }
  .bill-to { margin-bottom: 32px; }
  .bill-to .label { font-size: 11px; color: #888; margin-bottom: 6px; }
  .bill-to .name { font-size: 16px; font-weight: 600; }
  .bill-to .contact { font-size: 13px; color: #555; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  th { background: #f4f4f4; font-size: 11px; text-align: left; padding: 10px 12px; border-bottom: 1px solid #ddd; }
  td { font-size: 13px; padding: 14px 12px; border-bottom: 1px solid #eee; vertical-align: top; }
  .amount-row td { font-weight: 700; font-size: 15px; background: #fafafa; }
  .total-block { text-align: right; margin-bottom: 40px; }
  .total-label { font-size: 12px; color: #888; }
  .total-amount { font-size: 36px; font-weight: 700; margin-top: 4px; }
  .status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
    background: ${inv.status === 'PAID' ? '#dcfce7' : '#fef3c7'}; color: ${inv.status === 'PAID' ? '#15803d' : '#b45309'}; }
  .footer { border-top: 1px solid #eee; padding-top: 20px; font-size: 11px; color: #999; line-height: 1.8; }
  @media print { body { padding: 24px; } }
</style></head><body>
<div class="header">
  <div><div class="brand">HERIX</div><div class="brand-sub">花学科技 / Huaxue Technology Co., Ltd.</div></div>
  <div><div class="doc-title">請求書</div><div class="doc-no">${inv.invoice_no}</div></div>
</div>
<hr class="divider">
<div class="meta">
  <dl class="meta-block"><dt>発行日</dt><dd>${issueDate}</dd></dl>
  <dl class="meta-block"><dt>ステータス</dt><dd><span class="status-badge">${statusLabel}</span></dd></dl>
</div>
<div class="bill-to">
  <div class="label">請求先</div>
  <div class="name">${companyName || '—'}</div>
  ${contactName ? `<div class="contact">${contactName} 様</div>` : ''}
</div>
<table>
  <thead><tr><th>内容</th><th>期間</th><th style="text-align:right">金額</th></tr></thead>
  <tbody>
    <tr>
      <td>${planLabel}（${cycleLabel}）<br><span style="font-size:11px;color:#888">Herix 营销顾问订阅服务</span></td>
      <td style="font-size:12px;color:#555">${periodStart}<br>〜 ${periodEnd}</td>
      <td style="text-align:right">¥${inv.amount.toLocaleString()}</td>
    </tr>
    <tr class="amount-row"><td colspan="2">合計（税込）</td><td style="text-align:right">¥${inv.amount.toLocaleString()}</td></tr>
  </tbody>
</table>
<div class="footer">
  お支払いは Herix プラットフォーム残高よりお引き落とし。残高到账后自动生效，无需再操作。<br>
  お問い合わせ：support@huaxuex.com
</div>
<script>window.onload = function(){ window.print(); }<\/script>
</body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}

const PLAN_ICON: Record<string, typeof Sparkles> = { basic: Sparkles, premium: Crown, custom: Building2 }

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  PENDING_PAYMENT: { bg: '#fef3c7', color: '#d97706' },
  ACTIVE: { bg: '#dcfce7', color: '#16a34a' },
  PAST_DUE: { bg: '#fee2e2', color: '#dc2626' },
  EXPIRED: { bg: '#f3f4f6', color: '#6b7280' },
  CANCELED: { bg: '#f3f4f6', color: '#6b7280' },
}

/** 方案权益清单：按档位组装（顺序即卖点排序） */
function planFeatures(t: (k: string, p?: Record<string, unknown>) => string, p: SubscriptionPlanInfo): string[] {
  if (p.code === 'custom') {
    return ['fCustomAll', 'fCustomAdvisor', 'fCustomSla', 'fCustomContract'].map((k) => t(`subscribe.${k}`))
  }
  const list = [
    t('subscribe.fUnlimited'),
    t('subscribe.fGuaranteed', { n: p.benefits.guaranteedTasks ?? 0 }),
    p.code === 'premium' ? t('subscribe.fAdvisorDedicated') : t('subscribe.fAdvisorShared'),
    t('subscribe.fPlan'),
  ]
  if (p.benefits.commissionDiscount) {
    list.push(t('subscribe.fCommission', { n: Math.round(p.benefits.commissionDiscount * 100) }))
  }
  if (p.code === 'premium') list.push(t('subscribe.fPriority'))
  return list
}

// ── 当前订阅面板（有订阅记录时置顶展示）────────────────────────────
function CurrentSubscription({ sub, invoices, walletAvailable }: {
  sub: MerchantSubscription; invoices: SubscriptionInvoice[]; walletAvailable: number
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [err, setErr] = useState('')

  const renewMut = useMutation({
    mutationFn: (v: boolean) => subscriptionsApi.setAutoRenew(sub.id, v),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['mySubscription'] }) },
    onError: () => setErr(t('subscribe.actionFailed')),
  })
  const cancelMut = useMutation({
    mutationFn: () => subscriptionsApi.cancel(sub.id),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['mySubscription'] }) },
    onError: () => setErr(t('subscribe.actionFailed')),
  })

  const pendingInvoice = invoices.find((i) => i.status === 'PENDING')
  const shortfall = pendingInvoice ? Math.max(0, pendingInvoice.amount - walletAvailable) : 0
  const st = STATUS_STYLE[sub.status] || STATUS_STYLE.EXPIRED
  const terminal = sub.status === 'EXPIRED' || sub.status === 'CANCELED'

  return (
    <div className="rounded-2xl p-6 mb-8" style={{ background: '#fff', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold">{t(`subscribe.plan_${sub.plan_code}`)}</span>
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: st.bg, color: st.color }}>
            {t(`subscribe.st${sub.status}`)}
          </span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {t(`subscribe.cycle${sub.billing_cycle}`)} · ¥{sub.price_snapshot.toLocaleString()}
            {sub.current_period_end && sub.status !== 'PENDING_PAYMENT' && (
              <> · {t('subscribe.periodUntil', { date: formatDate(sub.current_period_end) })}</>
            )}
          </span>
        </div>
        {!terminal && (
          <div className="flex items-center gap-3">
            {sub.status !== 'PENDING_PAYMENT' && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
                <input
                  type="checkbox"
                  checked={!!sub.auto_renew}
                  onChange={(e) => renewMut.mutate(e.target.checked)}
                  disabled={renewMut.isPending}
                />
                {t('subscribe.autoRenew')}
              </label>
            )}
            <button
              type="button"
              className="text-xs cursor-pointer underline"
              style={{ color: 'var(--muted)' }}
              onClick={() => { if (window.confirm(t('subscribe.cancelConfirm'))) cancelMut.mutate() }}
            >
              {sub.status === 'PENDING_PAYMENT' ? t('subscribe.cancelOrder') : t('subscribe.cancelSub')}
            </button>
          </div>
        )}
      </div>

      {/* 待付款：请求书 + 差额引导（充值到账后自动生效，无需再操作） */}
      {sub.status === 'PENDING_PAYMENT' && pendingInvoice && (
        <div className="mt-4 rounded-xl p-4" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#92400e' }}>
              <ReceiptText size={15} /> {t('subscribe.invoiceTitle')}
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs"
              style={{ color: '#b45309' }}
              onClick={() => printInvoice(pendingInvoice, sub, user?.company_name ?? user?.brand_name ?? '', user?.contact_name ?? '')}
            >
              <Download size={13} /> 下载 PDF
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm mb-3">
            <div>
              <div className="text-xs mb-0.5" style={{ color: '#b45309' }}>{t('subscribe.invoiceNo')}</div>
              <div className="font-mono">{pendingInvoice.invoice_no}</div>
            </div>
            <div>
              <div className="text-xs mb-0.5" style={{ color: '#b45309' }}>{t('subscribe.invoiceAmount')}</div>
              <div className="font-bold tabular-nums">¥{pendingInvoice.amount.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs mb-0.5" style={{ color: '#b45309' }}>{t('subscribe.walletNow')}</div>
              <div className="tabular-nums">¥{walletAvailable.toLocaleString()}</div>
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs" style={{ color: '#92400e' }}>
              {shortfall > 0 ? t('subscribe.shortfallHint', { amount: shortfall.toLocaleString() }) : t('subscribe.activatingSoon')}
            </div>
            {shortfall > 0 && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl font-semibold text-white cursor-pointer"
                style={{ background: '#d97706' }}
                onClick={() => navigate('/wallet')}
              >
                {t('subscribe.goTopup')} <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {sub.status === 'PAST_DUE' && (
        <div className="mt-4 rounded-xl p-4 text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
          {t('subscribe.pastDueHint', { amount: sub.price_snapshot.toLocaleString() })}
        </div>
      )}

      {/* 发票历史 */}
      {invoices.length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--muted)' }}>{t('subscribe.invoiceHistory')}</div>
          <div className="space-y-1">
            {invoices.slice(0, 6).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                <span className="font-mono">{inv.invoice_no}</span>
                <span className="tabular-nums">¥{inv.amount.toLocaleString()}</span>
                <span>{formatDate(inv.paid_at || inv.created_at)}</span>
                <span style={{ color: inv.status === 'PAID' ? '#16a34a' : inv.status === 'PENDING' ? '#d97706' : '#9ca3af' }}>
                  {t(`subscribe.inv${inv.status}`)}
                </span>
                <button
                  type="button"
                  className="flex items-center gap-1"
                  style={{ color: 'var(--primary)' }}
                  onClick={() => printInvoice(inv, sub, user?.company_name ?? user?.brand_name ?? '', user?.contact_name ?? '')}
                >
                  <Download size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <div className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{err}</div>}
    </div>
  )
}

// ── 定制版洽谈表单（公司/联系人平台已有，只收营销需求与目标）──────────
function InquiryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [goals, setGoals] = useState('')
  const [budgetRange, setBudgetRange] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const mut = useMutation({
    mutationFn: () => subscriptionsApi.submitInquiry({ goals: goals.trim(), budgetRange: budgetRange || undefined, note: note.trim() || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['myInquiry'] }),
    onError: () => setErr(t('subscribe.actionFailed')),
  })

  const submit = () => {
    if (!goals.trim()) { setErr(t('subscribe.inqGoalsRequired')); return }
    setErr(''); mut.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.4)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl p-6" style={{ background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        {mut.isSuccess ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">✅</div>
            <div className="text-base font-bold mb-2">{t('subscribe.inqDoneTitle')}</div>
            <div className="text-sm mb-6" style={{ color: 'var(--muted)' }}>{t('subscribe.inqDoneDesc')}</div>
            <button type="button" onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer"
              style={{ background: 'var(--text)' }}>
              {t('common.confirm')}
            </button>
          </div>
        ) : (
          <>
            <div className="text-base font-bold mb-1">{t('subscribe.inqTitle')}</div>
            <div className="text-xs mb-5" style={{ color: 'var(--muted)' }}>{t('subscribe.inqSub')}</div>

            <label className="block text-xs font-medium mb-1.5">{t('subscribe.inqGoals')} *</label>
            <textarea
              className="w-full rounded-xl p-3 text-sm mb-4"
              style={{ border: '1px solid var(--border)', minHeight: 96, resize: 'vertical' }}
              placeholder={t('subscribe.inqGoalsPh')}
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              maxLength={1000}
            />

            <label className="block text-xs font-medium mb-1.5">{t('subscribe.inqBudget')}</label>
            <div className="flex gap-2 flex-wrap mb-4">
              {['<¥300k', '¥300k-1M', '¥1M-3M', '>¥3M'].map((b) => (
                <button key={b} type="button"
                  onClick={() => setBudgetRange(budgetRange === b ? '' : b)}
                  className="text-xs px-3 py-1.5 rounded-full cursor-pointer"
                  style={budgetRange === b
                    ? { background: 'var(--text)', color: '#fff' }
                    : { background: '#fff', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  {b}{t('subscribe.inqPerMonth')}
                </button>
              ))}
            </div>

            <label className="block text-xs font-medium mb-1.5">{t('subscribe.inqNote')}</label>
            <textarea
              className="w-full rounded-xl p-3 text-sm mb-2"
              style={{ border: '1px solid var(--border)', minHeight: 60, resize: 'vertical' }}
              placeholder={t('subscribe.inqNotePh')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <div className="text-[11px] mb-4" style={{ color: 'var(--muted)' }}>{t('subscribe.inqContactHint')}</div>

            {err && <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{err}</div>}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm cursor-pointer"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                {t('common.cancel')}
              </button>
              <button type="button" onClick={submit} disabled={mut.isPending}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--primary)' }}>
                {t('subscribe.inqSubmit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 主页面 ─────────────────────────────────────────────────────────
export default function Subscribe() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [cycle, setCycle] = useState<Cycle>('MONTHLY')
  const [err, setErr] = useState('')
  const [inquiryOpen, setInquiryOpen] = useState(false)

  const { data: myInq } = useQuery({
    queryKey: ['myInquiry'],
    queryFn: () => subscriptionsApi.myInquiry().then((r) => r.data),
  })
  const inquiryPending = myInq?.inquiry?.status === 'NEW'

  const { data: plansData } = useQuery({
    queryKey: ['subscriptionPlans'],
    queryFn: () => subscriptionsApi.plans().then((r) => r.data),
  })
  const { data: mine } = useQuery({
    queryKey: ['mySubscription'],
    queryFn: () => subscriptionsApi.mine().then((r) => r.data),
  })

  const subscribeMut = useMutation({
    mutationFn: (planCode: string) => subscriptionsApi.subscribe(planCode, cycle),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['mySubscription'] }) },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || t('subscribe.actionFailed'))
    },
  })

  const plans = plansData?.plans ?? []
  const discounts = plansData?.discounts ?? { quarterly: 0.95, annual: 0.88 }
  const sub = mine?.subscription ?? null
  const hasLive = !!sub && ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE'].includes(sub.status)

  const savePct = (d: number) => Math.round((1 - d) * 100)

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('subscribe.title')} />
      <div className="p-7 flex-1 max-w-5xl mx-auto w-full">

        {sub && <CurrentSubscription sub={sub} invoices={mine?.invoices ?? []} walletAvailable={mine?.walletAvailable ?? 0} />}

        {/* 头部主张 */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold mb-2">{t('subscribe.heroTitle')}</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('subscribe.heroSub')}</p>
        </div>

        {/* 周期切换（业内惯例：省额徽章挂在切换器上） */}
        <div className="flex justify-center mb-8">
          <div className="flex p-1 rounded-xl" style={{ background: 'var(--border)' }}>
            {BILLING_CYCLES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className="px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer"
                style={cycle === c
                  ? { background: '#fff', color: 'var(--text)', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }
                  : { background: 'transparent', color: 'var(--muted)' }}
              >
                {t(`subscribe.cycle${c}`)}
                {c !== 'MONTHLY' && (
                  <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: '#dcfce7', color: '#16a34a' }}>
                    -{savePct(c === 'QUARTERLY' ? discounts.quarterly : discounts.annual)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 三栏方案卡（premium 高亮=业内"最受欢迎"锚点） */}
        <div className="grid grid-cols-3 gap-5 items-stretch mb-8">
          {plans.map((p) => {
            const Icon = PLAN_ICON[p.code] || Sparkles
            const highlight = p.code === 'premium'
            const total = p.pricing ? p.pricing[cycle] : null
            const perMonth = total !== null ? Math.round(total / CYCLE_MONTHS[cycle]) : null
            const isCurrent = hasLive && sub?.plan_code === p.code
            return (
              <div
                key={p.code}
                className="rounded-2xl p-6 flex flex-col relative"
                style={{
                  background: '#fff',
                  border: highlight ? '2px solid var(--primary)' : '1px solid var(--border)',
                  boxShadow: highlight ? '0 8px 24px rgba(200,60,60,.12)' : 'none',
                }}
              >
                {highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-3 py-1 rounded-full text-white"
                    style={{ background: 'var(--primary)' }}>
                    {t('subscribe.mostPopular')}
                  </span>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={18} style={{ color: highlight ? 'var(--primary)' : 'var(--muted)' }} />
                  <span className="text-base font-bold">{t(`subscribe.plan_${p.code}`)}</span>
                </div>
                <div className="text-xs mb-4" style={{ color: 'var(--muted)' }}>{t(`subscribe.plan_${p.code}_desc`)}</div>

                {perMonth !== null ? (
                  <div className="mb-4">
                    <span className="text-3xl font-bold tabular-nums">¥{perMonth.toLocaleString()}</span>
                    <span className="text-sm" style={{ color: 'var(--muted)' }}> / {t('subscribe.perMonth')}</span>
                    {cycle !== 'MONTHLY' && total !== null && (
                      <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                        {t('subscribe.billedAs', { amount: total.toLocaleString(), cycle: t(`subscribe.cycle${cycle}`) })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mb-4">
                    <span className="text-3xl font-bold">{t('subscribe.customPrice')}</span>
                    <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t('subscribe.customPriceSub')}</div>
                  </div>
                )}

                <ul className="space-y-2.5 mb-6 flex-1">
                  {planFeatures(t, p).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={15} className="mt-0.5 shrink-0" style={{ color: '#16a34a' }} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {p.code === 'custom' ? (
                  <button
                    type="button"
                    onClick={() => !inquiryPending && setInquiryOpen(true)}
                    disabled={inquiryPending}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-100"
                    style={inquiryPending
                      ? { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
                      : { background: '#fff', color: 'var(--text)', border: '1px solid var(--text)' }}>
                    {inquiryPending ? `✓ ${t('subscribe.inqPendingBadge')}` : t('subscribe.contactUs')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={hasLive || subscribeMut.isPending}
                    onClick={() => subscribeMut.mutate(p.code)}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={highlight
                      ? { background: 'var(--primary)', color: '#fff' }
                      : { background: 'var(--text)', color: '#fff' }}
                  >
                    {isCurrent ? t('subscribe.currentPlan') : hasLive ? t('subscribe.hasLiveHint') : t('subscribe.subscribeCta')}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {err && (
          <div className="mb-6 px-4 py-3 rounded-lg text-sm text-center" style={{ background: '#fee2e2', color: 'var(--danger)' }}>{err}</div>
        )}

        {/* 运作流程：商户第一次接触"营销顾问服务"，四步讲清怎么开始 */}
        <div className="rounded-2xl p-6 mb-8" style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <div className="text-sm font-bold mb-5 text-center">{t('subscribe.howTitle')}</div>
          <div className="grid grid-cols-4 gap-4">
            {([
              { icon: ClipboardList, k: 'how1' },
              { icon: Banknote, k: 'how2' },
              { icon: Zap, k: 'how3' },
              { icon: Rocket, k: 'how4' },
            ] as const).map(({ icon: Icon, k }, i) => (
              <div key={k} className="text-center">
                <div className="w-10 h-10 rounded-full mx-auto mb-2.5 flex items-center justify-center"
                  style={{ background: 'var(--primary-light, #fdeceb)', color: 'var(--primary)' }}>
                  <Icon size={18} />
                </div>
                <div className="text-sm font-semibold mb-1">{i + 1}. {t(`subscribe.${k}Title`)}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{t(`subscribe.${k}Desc`)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 权益逐项对比表（行=权益，列=档位） */}
        <div className="rounded-2xl overflow-hidden mb-8" style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <div className="text-sm font-bold px-6 pt-5 pb-3">{t('subscribe.compareTitle')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th className="text-left px-6 py-2.5 text-xs font-medium" style={{ color: 'var(--muted)', width: '34%' }}>{t('subscribe.cmpFeature')}</th>
                  {(['basic', 'premium', 'custom'] as const).map((c) => (
                    <th key={c} className="px-4 py-2.5 text-xs font-semibold text-center"
                      style={{ color: c === 'premium' ? 'var(--primary)' : 'var(--text)' }}>
                      {t(`subscribe.plan_${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const byCode = Object.fromEntries(plans.map((p) => [p.code, p]))
                  const yes = <Check size={15} className="inline" style={{ color: '#16a34a' }} />
                  const no = <Minus size={15} className="inline" style={{ color: '#d1d5db' }} />
                  const rows: Array<{ label: string; cells: [React.ReactNode, React.ReactNode, React.ReactNode] }> = [
                    { label: t('subscribe.cmpPrice'), cells: [
                      byCode.basic?.monthlyPrice != null ? `¥${byCode.basic.monthlyPrice.toLocaleString()}` : '—',
                      byCode.premium?.monthlyPrice != null ? `¥${byCode.premium.monthlyPrice.toLocaleString()}` : '—',
                      t('subscribe.customPrice')] },
                    { label: t('subscribe.cmpUnlimited'), cells: [yes, yes, yes] },
                    { label: t('subscribe.cmpGuaranteed'), cells: [
                      String(byCode.basic?.benefits.guaranteedTasks ?? 0),
                      String(byCode.premium?.benefits.guaranteedTasks ?? 0),
                      t('subscribe.cmpCustomVal')] },
                    { label: t('subscribe.cmpAdvisor'), cells: [
                      t('subscribe.cmpAdvisorShared'), t('subscribe.cmpAdvisorDedicated'), t('subscribe.cmpAdvisorTeam')] },
                    { label: t('subscribe.cmpPlanning'), cells: [yes, yes, yes] },
                    { label: t('subscribe.cmpCommission'), cells: [
                      byCode.basic?.benefits.commissionDiscount ? `-${Math.round((byCode.basic.benefits.commissionDiscount) * 100)}pt` : no,
                      byCode.premium?.benefits.commissionDiscount ? `-${Math.round((byCode.premium.benefits.commissionDiscount) * 100)}pt` : no,
                      t('subscribe.cmpCustomVal')] },
                    { label: t('subscribe.cmpPriority'), cells: [no, yes, yes] },
                    { label: t('subscribe.cmpSla'), cells: [no, no, yes] },
                    { label: t('subscribe.cmpBilling'), cells: [
                      t('subscribe.cmpBillingSelf'), t('subscribe.cmpBillingSelf'), t('subscribe.cmpBillingContract')] },
                  ]
                  return rows.map((r) => (
                    <tr key={r.label}>
                      <td className="px-6 py-2.5 text-xs" style={{ color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>{r.label}</td>
                      {r.cells.map((cell, i) => (
                        <td key={i} className="px-4 py-2.5 text-center text-xs"
                          style={{ borderTop: '1px solid var(--border)', background: i === 1 ? '#fff8f7' : undefined }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {inquiryOpen && <InquiryModal onClose={() => setInquiryOpen(false)} />}

        {/* 说明（扣款方式/宽限/取消政策，合规明示） */}
        <div className="text-xs leading-relaxed space-y-1 pb-8" style={{ color: 'var(--muted)' }}>
          <p>· {t('subscribe.noteBilling')}</p>
          <p>· {t('subscribe.noteGrace')}</p>
          <p>· {t('subscribe.noteCancel')}</p>
        </div>
      </div>
    </div>
  )
}
