import { useEffect, useState } from 'react'
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { WrongPortal } from './WrongPortal'
import { MobileNavContext } from './MobileNavContext'
import { useAuth } from '@/contexts/AuthContext'

export function AppLayout() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  /** 窄屏侧边栏抽屉（≥md 恒定展开，此 state 无效） */
  const [navOpen, setNavOpen] = useState(false)

  // 路由变化时收起抽屉，避免跳转后遮罩还盖着
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  // Handle ?bind_task=<id>&bind_token=<tok> deep links from agency invitations
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(location.search)
    const bindTask = params.get('bind_task')
    const bindToken = params.get('bind_token')
    if (bindTask && bindToken) {
      navigate(`/partner/${bindTask}?bind_token=${bindToken}`, { replace: true })
    }
  }, [user, location.search])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ color: 'var(--muted)' }}>
        加载中...
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // 走错端：登录接口不校验角色，纯赫使账号也能登进商家后台，看到的是半残界面。
  // 以 roles 全集判断（双角色账号两端都要能进），老账号 roles 缺失时回退单个 role。
  const roles = user.roles || (user.role ? [user.role] : [])
  if (!roles.includes('BRAND')) return <WrongPortal />

  // Gate: force onboarding if not yet completed
  if (user.brand_onboarded === false && location.pathname !== '/onboard') {
    return <Navigate to="/onboard" replace />
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />

      {/* 窄屏抽屉展开时的遮罩，点击收起 */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* 窄屏不给侧边栏让位（它是抽屉，不占文档流）；≥md 才留出 220px */}
      <main className="flex-1 flex flex-col min-h-screen min-w-0 md:ml-[var(--sidebar-w)]">
        <MobileNavContext.Provider value={() => setNavOpen(true)}>
          <Outlet />
        </MobileNavContext.Provider>
      </main>
    </div>
  )
}
