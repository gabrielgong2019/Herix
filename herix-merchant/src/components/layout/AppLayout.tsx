import { useEffect } from 'react'
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { WrongPortal } from './WrongPortal'
import { useAuth } from '@/contexts/AuthContext'

export function AppLayout() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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
      <Sidebar />
      <main
        className="flex-1 flex flex-col min-h-screen min-w-0"
        style={{ marginLeft: 'var(--sidebar-w)' }}
      >
        <Outlet />
      </main>
    </div>
  )
}
