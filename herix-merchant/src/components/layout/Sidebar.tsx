import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, ListTodo, ClipboardCheck, Wallet, Settings, LogOut, Upload, Handshake, Sparkles, FileText,
} from 'lucide-react'

const NAV_ITEMS = [
  { key: 'dashboard',  path: '/',         icon: LayoutDashboard },
  { key: 'tasks',      path: '/tasks',     icon: ListTodo },
  { key: 'reviews',    path: '/reviews',   icon: ClipboardCheck },
  { key: 'wallet',     path: '/wallet',    icon: Wallet },
  { key: 'invoices',   path: '/invoices',  icon: FileText },
  { key: 'subscribe',  path: '/subscribe', icon: Sparkles },
  { key: 'csv',        path: '/csv',       icon: Upload },
  { key: 'settings',   path: '/settings',  icon: Settings },
]

const AGENCY_NAV_ITEMS = [
  { key: 'partner', path: '/partner', icon: Handshake },
]

interface SidebarProps {
  /** 窄屏抽屉是否展开（≥md 恒定展开，此值被忽略） */
  open?: boolean
  /** 点导航后收起抽屉 */
  onNavigate?: () => void
}

export function Sidebar({ open = false, onNavigate }: SidebarProps) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside
      style={{ width: 'var(--sidebar-w)', background: 'var(--sidebar)' }}
      className={cn(
        'fixed top-0 left-0 h-screen flex flex-col z-50 transition-transform duration-200',
        // 窄屏：默认滑出屏外，展开时滑入；≥md 恒定固定在左侧
        'md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2.5">
        <img src="/merchant/logo-icon.png" alt="" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
        <div>
          <div className="text-white text-base font-bold tracking-widest leading-none">
            HER<span style={{ color: 'var(--primary)' }}>IX</span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--sidebar-text)' }}>{user?.is_agency ? '代理后台' : '商家后台'}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2">
        {[...NAV_ITEMS, ...(user?.is_agency ? AGENCY_NAV_ITEMS : [])].map(({ key, path, icon: Icon }) => (
          <NavLink
            key={key}
            to={path}
            end={path === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm mx-1 my-0.5 transition-all',
                isActive
                  ? 'text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-white/7',
              )
            }
            style={({ isActive }) => isActive ? { background: 'var(--primary)' } : {}}
          >
            <Icon size={16} />
            {t(`nav.${key}`)}
          </NavLink>
        ))}
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="text-xs mb-2 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {user?.company_name || user?.nickname || user?.email}
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-xs cursor-pointer transition-colors hover:text-white"
          style={{ color: 'rgba(255,255,255,0.35)' }}
        >
          <LogOut size={13} />
          {t('nav.logout')}
        </button>
      </div>
    </aside>
  )
}
