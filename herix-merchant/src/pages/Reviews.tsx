import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Check, X } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function Reviews() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ['reviews'],
    queryFn: () => reviewsApi.list().then((r) => r.data),
  })

  const approveMut = useMutation({
    mutationFn: reviewsApi.approve,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  })
  const rejectMut = useMutation({
    mutationFn: (id: string) => reviewsApi.reject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  })

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('reviews.title')} />

      <div className="p-7 flex-1">
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['任务', '赫使', '提交时间', '内容', '操作'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('common.loading')}</td></tr>
              )}
              {!isLoading && subs.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('reviews.empty')}</td></tr>
              )}
              {subs.map((sub) => (
                <tr key={sub.id}>
                  <td className="px-5 py-3.5 text-sm font-medium" style={{ borderBottom: '1px solid var(--border)' }}>{sub.task?.title || '—'}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>{sub.herald?.name || sub.user_id}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{formatDate(sub.created_at)}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--primary)' }}>
                    {sub.content_url ? <a href={sub.content_url} target="_blank" rel="noreferrer">查看</a> : '—'}
                  </td>
                  <td className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex gap-2">
                      <button
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                        style={{ background: '#dcfce7', color: '#16a34a' }}
                        onClick={() => approveMut.mutate(sub.id)}
                        disabled={approveMut.isPending}
                      >
                        <Check size={12} /> {t('reviews.approve')}
                      </button>
                      <button
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                        style={{ background: '#fee2e2', color: '#dc2626' }}
                        onClick={() => rejectMut.mutate(sub.id)}
                        disabled={rejectMut.isPending}
                      >
                        <X size={12} /> {t('reviews.reject')}
                      </button>
                    </div>
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
