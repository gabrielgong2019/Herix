import { useTranslation } from 'react-i18next'
import { X, ExternalLink } from 'lucide-react'
import type { Application } from '@/lib/api'
import { formatDate } from '@/lib/utils'

interface Props {
  app: Application | null
  onClose: () => void
  onApprove: (appId: string) => void
  onReject: (appId: string) => void
  approving?: boolean
  rejecting?: boolean
  /** 审核队列上下文显示所属任务；任务详情内不传（上下文自明） */
  taskTitle?: string
}

interface SocialPlatform {
  platformId: string
  followers?: number | null
  url?: string | null
  accountId?: string | null
}

function parsePlatforms(raw?: string): SocialPlatform[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

function parseTiers(raw?: string): Record<string, string> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function isValidUrl(u?: string | null): u is string {
  return !!u && /^https?:\/\//i.test(u)
}

function fmtFollowers(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const TIER_COLORS: Record<string, { bg: string; color: string }> = {
  Nano:  { bg: '#f0fdf4', color: '#16a34a' },
  Micro: { bg: '#eff6ff', color: '#2563eb' },
  Mid:   { bg: '#faf5ff', color: '#7c3aed' },
  Macro: { bg: '#fff7ed', color: '#ea580c' },
  Mega:  { bg: '#fef2f2', color: '#dc2626' },
}

function parseProposalLinks(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export function HeraldDrawer({ app, onClose, onApprove, onReject, approving, rejecting, taskTitle }: Props) {
  const { t } = useTranslation()

  if (!app) return null

  const platforms = parsePlatforms(app.social_platforms)
  const tiers = parseTiers(app.tier_snapshot)
  const name = app.display_name || app.nickname || app.user_id || ''
  const completedTasks = Number(app.completed_tasks || 0)
  const goodRate = app.good_rate != null ? Math.round(Number(app.good_rate) * 100) : null
  const isPending = app.status.toLowerCase() === 'pending' // 服务端大写 PENDING，归一后比较

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200,
          animation: 'fadeIn 0.15s ease',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 360,
        background: 'var(--card)', zIndex: 201, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        animation: 'slideInRight 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{t('herald.drawerTitle')}</span>
            {taskTitle && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{taskTitle}</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
              background: 'var(--primary)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 20, color: '#fff',
              backgroundImage: app.avatar_url ? `url(${app.avatar_url})` : undefined,
              backgroundSize: 'cover', backgroundPosition: 'center',
            }}>
              {!app.avatar_url && (name[0] || '?').toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {t('herald.joinedAt', { date: formatDate(app.created_at) })}
              </div>
              {app.bio && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                  {app.bio}
                </div>
              )}
            </div>
          </div>

          {/* Platforms */}
          <Section label={t('herald.platforms')}>
            {platforms.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('herald.noPlatforms')}</div>
            ) : (
              platforms.filter(p => p.platformId).map(p => {
                const tier = tiers[p.platformId]
                const tierStyle = tier ? TIER_COLORS[tier] || TIER_COLORS.Nano : null
                const platformName = t(`platform.${p.platformId}`, p.platformId)
                return (
                  <div key={p.platformId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 0', borderBottom: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {isValidUrl(p.url) ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 13, fontWeight: 500, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                          {platformName}
                          <ExternalLink size={11} style={{ flexShrink: 0 }} />
                        </a>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{platformName}</span>
                      )}
                      {p.accountId && (
                        <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                          {p.accountId}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {p.followers != null && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {t('herald.followers', { n: fmtFollowers(Number(p.followers)) })}
                        </span>
                      )}
                      {tierStyle && tier && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                          background: tierStyle.bg, color: tierStyle.color,
                        }}>
                          {tier}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </Section>

          {/* Herix record */}
          <Section label={t('herald.record')}>
            <div style={{ display: 'flex', gap: 16 }}>
              <StatBox
                label={t('herald.completedTasks')}
                value={completedTasks > 0 ? t('herald.tasks', { n: completedTasks }) : t('herald.noRecord')}
              />
              <StatBox
                label={t('herald.goodRate')}
                value={goodRate != null ? `${goodRate}%` : t('herald.noRecord')}
                highlight={goodRate != null && goodRate >= 80}
              />
            </div>
          </Section>

          {/* Community */}
          {app.community && (
            <Section label={t('herald.community')}>
              <div style={{ fontSize: 13 }}>
                {t(`community.${app.community}`, app.community)}
              </div>
            </Section>
          )}

          {/* Specialty tags */}
          {app.specialty_tags && app.specialty_tags.length > 0 && (
            <Section label={t('herald.specialties')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {app.specialty_tags.map((tagId: string) => (
                  <span key={tagId} style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    background: 'var(--primary-light, #eff6ff)', color: 'var(--primary)',
                  }}>
                    {t(`specialty.${tagId}`, tagId)}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {app.message && (
            <Section label={t('herald.applyMessage')}>
              <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                {app.message}
              </p>
            </Section>
          )}

          {(app.proposal_text || (app.proposal_links && parseProposalLinks(app.proposal_links).length > 0)) && (
            <Section label={t('herald.proposal')}>
              {app.proposal_text && (
                <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
                  {app.proposal_text}
                </p>
              )}
              {app.proposal_links && parseProposalLinks(app.proposal_links).length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {parseProposalLinks(app.proposal_links).map((link, i) => (
                    <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 13, color: 'var(--primary)', wordBreak: 'break-all' }}>
                      {link}
                    </a>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>

        {/* Footer actions — only for pending */}
        {isPending && (
          <div style={{
            padding: '16px 20px', borderTop: '1px solid var(--border)',
            display: 'flex', gap: 10,
          }}>
            <button
              onClick={() => onReject(app.id)}
              disabled={rejecting}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)',
                background: '#fff', color: 'var(--text)', fontSize: 14, fontWeight: 500,
                cursor: rejecting ? 'not-allowed' : 'pointer', opacity: rejecting ? 0.6 : 1,
              }}
            >
              {t('tasks.reject')}
            </button>
            <button
              onClick={() => onApprove(app.id)}
              disabled={approving}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: approving ? 'not-allowed' : 'pointer', opacity: approving ? 0.6 : 1,
              }}
            >
              {t('tasks.approve')}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '12px 14px', borderRadius: 10,
      background: 'var(--bg)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: highlight ? '#16a34a' : 'var(--text)' }}>{value}</div>
    </div>
  )
}
