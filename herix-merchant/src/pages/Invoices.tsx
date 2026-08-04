import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { invoiceApi, type Invoice } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'

type TypeFilter = 'ALL' | 'DEPOSIT' | 'MONTHLY'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function fmtMoney(n: number) {
  return `¥${n.toLocaleString('ja-JP')}`
}

function TypeBadge({ type }: { type: 'DEPOSIT' | 'MONTHLY' }) {
  const { t } = useTranslation()
  const isDeposit = type === 'DEPOSIT'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: isDeposit ? '#eff6ff' : '#f0fdf4',
      color: isDeposit ? '#1d4ed8' : '#15803d',
      border: `1px solid ${isDeposit ? '#bfdbfe' : '#bbf7d0'}`,
    }}>
      {t(`invoice.type.${type}`)}
    </span>
  )
}

function InvoiceRow({ inv, onDownload }: { inv: Invoice; onDownload: (id: string) => void }) {
  const { t } = useTranslation()
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '14px 16px', fontSize: 13 }}>
        <div style={{ fontWeight: 600, color: 'var(--fg)', fontFamily: 'ui-monospace, monospace' }}>
          {inv.invoiceNo}
        </div>
        {inv.period && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            {inv.period.replace('-', '年')}月分
          </div>
        )}
      </td>
      <td style={{ padding: '14px 16px' }}>
        <TypeBadge type={inv.type} />
      </td>
      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {fmtMoney(inv.subtotal)}
      </td>
      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {fmtMoney(inv.taxAmount)}
      </td>
      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, color: 'var(--fg)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {fmtMoney(inv.total)}
      </td>
      <td style={{ padding: '14px 16px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        {fmtDate(inv.issuedAt)}
      </td>
      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
        {inv.hasPdf ? (
          <button
            onClick={() => onDownload(inv.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '6px 12px', borderRadius: 8,
              background: 'var(--primary)', color: '#fff',
              fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            <Download size={13} />
            {t('invoice.download')}
          </button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('invoice.generating')}</span>
        )}
      </td>
    </tr>
  )
}

export default function Invoices() {
  const { t } = useTranslation()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [page, setPage] = useState(1)
  const LIMIT = 20

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['invoices', typeFilter, page],
    queryFn: () => invoiceApi.list({
      type: typeFilter === 'ALL' ? undefined : typeFilter,
      page,
      limit: LIMIT,
    }).then((r) => r.data),
  })

  const invoices = data?.invoices ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / LIMIT) || 1

  function handleDownload(id: string) {
    // Open PDF in new tab — browser will trigger download
    const url = invoiceApi.pdfUrl(id)
    window.open(url, '_blank')
  }

  const filterTabs: TypeFilter[] = ['ALL', 'DEPOSIT', 'MONTHLY']

  return (
    <div style={{ padding: '24px 28px', maxWidth: 980, margin: '0 auto' }}>
      <Topbar title={t('nav.invoices')} />

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {filterTabs.map((f) => (
          <button
            key={f}
            onClick={() => { setTypeFilter(f); setPage(1) }}
            style={{
              padding: '7px 18px',
              borderRadius: 20,
              border: '1px solid',
              fontSize: 13,
              fontWeight: typeFilter === f ? 600 : 400,
              cursor: 'pointer',
              background: typeFilter === f ? 'var(--primary)' : 'transparent',
              color: typeFilter === f ? '#fff' : 'var(--muted)',
              borderColor: typeFilter === f ? 'var(--primary)' : 'var(--border)',
              transition: 'all .15s',
            }}
          >
            {t(`invoice.filter.${f}`)}
          </button>
        ))}

        <button
          onClick={() => refetch()}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
            padding: '7px 14px', borderRadius: 20, border: '1px solid var(--border)',
            fontSize: 12, color: 'var(--muted)', background: 'transparent', cursor: 'pointer',
          }}
        >
          <RefreshCw size={13} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--card)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            {t('common.loading')}
          </div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <FileText size={36} style={{ color: 'var(--muted)', marginBottom: 12 }} />
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>{t('invoice.empty')}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--table-header, rgba(0,0,0,0.03))' }}>
                  {[
                    { key: 'invoiceNo', align: 'left' },
                    { key: 'type', align: 'left' },
                    { key: 'subtotal', align: 'right' },
                    { key: 'tax', align: 'right' },
                    { key: 'total', align: 'right' },
                    { key: 'issuedAt', align: 'center' },
                    { key: 'actions', align: 'center' },
                  ].map(({ key, align }) => (
                    <th
                      key={key}
                      style={{
                        padding: '12px 16px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--muted)',
                        textAlign: align as any,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {t(`invoice.col.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <InvoiceRow key={inv.id} inv={inv} onDownload={handleDownload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
              fontSize: 13, cursor: page <= 1 ? 'not-allowed' : 'pointer',
              background: 'transparent', color: page <= 1 ? 'var(--muted)' : 'var(--fg)',
            }}
          >
            ‹ {t('common.prev')}
          </button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--muted)' }}>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
              fontSize: 13, cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              background: 'transparent', color: page >= totalPages ? 'var(--muted)' : 'var(--fg)',
            }}
          >
            {t('common.next')} ›
          </button>
        </div>
      )}
    </div>
  )
}
