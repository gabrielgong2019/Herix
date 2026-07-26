import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { notificationsApi, type Notification } from '@/lib/api'
import { Bell, CheckCheck } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import i18n from '@/i18n'

/** 通知类型 → 点击跳转目标（metadata.taskId 兜底跳任务详情） */
function targetOf(n: Notification, meta: Record<string, any>): string | null {
  switch (n.type) {
    case 'REVIEW_REMINDER': return '/reviews'
    case 'SETTLEMENT_BLOCKED': return '/wallet'
    case 'KYB_APPROVED':
    case 'KYB_REJECTED': return '/settings'
    default:
      if (n.type.startsWith('SUBSCRIPTION_')) return '/subscribe'
      return meta.taskId ? `/tasks/${meta.taskId}` : null
  }
}

const TYPE_ICON: Record<string, string> = {
  REVIEW_REMINDER: '⏰',
  SETTLEMENT_BLOCKED: '⚠️',
  ARBITRATION_OPENED: '⚖️',
  ARBITRATION_RESOLVED: '⚖️',
  TASK_REVIEW_APPROVED: '✅',
  TASK_REVIEW_REJECTED: '❌',
  KYB_APPROVED: '🏢',
  KYB_REJECTED: '❌',
  SUBSCRIPTION_ACTIVATED: '✨',
  SUBSCRIPTION_RENEWED: '✨',
  SUBSCRIPTION_RENEWAL_DUE: '⏰',
  SUBSCRIPTION_PAST_DUE: '⚠️',
  SUBSCRIPTION_EXPIRED: '📅',
}

/** 无参模板类型：没有 taskTitle 也可以按当前语言渲染 */
const PARAMLESS = new Set([
  'KYB_APPROVED', 'KYB_REJECTED',
  'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_RENEWAL_DUE',
  'SUBSCRIPTION_PAST_DUE', 'SUBSCRIPTION_EXPIRED',
])

function parseMeta(n: Notification): Record<string, any> {
  try { return n.metadata ? JSON.parse(n.metadata) : {} } catch { return {} }
}

export function NotificationBell() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then((r) => r.data),
    refetchInterval: 60_000,
  })
  const unread = data?.unread ?? 0
  const notifs = data?.notifications ?? []

  const readMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const readAllMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // 与小程序消息页同一策略：词典有该 type 模板且参数齐 → 按当前语言渲染；
  // 否则(老数据/未知类型)兜底展示落库时的中文 title/body
  const renderText = (n: Notification) => {
    const meta = parseMeta(n)
    const titleKey = `notif.${n.type}.title`
    const canTranslate = i18n.exists(titleKey) && (PARAMLESS.has(n.type) || !!meta.taskTitle)
    if (!canTranslate) return { title: n.title, body: n.body, meta }
    const params = { taskTitle: meta.taskTitle, needed: meta.needed, available: meta.available, code: meta.code }
    let body = t(`notif.${n.type}.body`, params)
    if (meta.note) body += ' ' + t('notifBell.reason', { note: meta.note })
    return { title: t(titleKey, params), body, meta }
  }

  const onClick = (n: Notification) => {
    if (!n.is_read) readMut.mutate(n.id)
    const target = targetOf(n, parseMeta(n))
    if (target) { setOpen(false); navigate(target) }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer"
        style={{ borderColor: 'var(--border)', background: '#fff', color: 'var(--muted)' }}
        onClick={() => setOpen(!open)}
        aria-label={t('notifBell.title')}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-2 w-96 max-h-[70vh] overflow-y-auto rounded-xl border shadow-lg z-50"
            style={{ background: '#fff', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-semibold">{t('notifBell.title')}</span>
              {unread > 0 && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs cursor-pointer"
                  style={{ color: 'var(--primary)' }}
                  onClick={() => readAllMut.mutate()}
                  disabled={readAllMut.isPending}
                >
                  <CheckCheck size={12} /> {t('notifBell.markAll')}
                </button>
              )}
            </div>
            {notifs.length === 0 && (
              <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>{t('notifBell.empty')}</div>
            )}
            {notifs.map((n) => {
              const { title, body } = renderText(n)
              return (
                <button
                  key={n.id}
                  type="button"
                  className="w-full text-left px-4 py-3 border-b cursor-pointer flex gap-3"
                  style={{ borderColor: 'var(--border)', background: n.is_read ? '#fff' : '#f0f7ff' }}
                  onClick={() => onClick(n)}
                >
                  <span className="text-base leading-6">{TYPE_ICON[n.type] || '💬'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{title}</span>
                    <span className="block text-xs mt-0.5 line-clamp-2 whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{body}</span>
                    <span className="block text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{formatDate(n.created_at)}</span>
                  </span>
                  {!n.is_read && <span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: 'var(--primary)' }} />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
