import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, ListTodo, ClipboardCheck, Wallet, Settings, LogOut,
} from 'lucide-react'

const NAV_ITEMS = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'tasks', path: '/tasks', icon: ListTodo },
  { key: 'reviews', path: '/reviews', icon: ClipboardCheck },
  { key: 'wallet', path: '/wallet', icon: Wallet },
  { key: 'settings', path: '/settings', icon: Settings },
]

export function Sidebar() {
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
      className="fixed top-0 left-0 h-screen flex flex-col z-50"
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <span className="text-white text-base font-bold tracking-widest">
          HER<span style={{ color: 'var(--primary)' }}>IX</span>
        </span>
        <div className="text-xs mt-0.5" style={{ color: 'var(--sidebar-text)' }}>商家后台</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2">
        {NAV_ITEMS.map(({ key, path, icon: Icon }) => (
          <NavLink
            key={key}
            to={path}
            end={path === '/'}
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
