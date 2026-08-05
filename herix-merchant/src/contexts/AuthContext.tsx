import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { authApi, type MerchantUser } from '@/lib/api'

interface AuthContextValue {
  user: MerchantUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MerchantUser | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMe = async () => {
    const r = await authApi.me()
    const data = r.data as MerchantUser & { _refreshedToken?: string }
    if (data._refreshedToken) {
      localStorage.setItem('herix-merchant-token', data._refreshedToken)
      delete data._refreshedToken
    }
    setUser(data)
    return data
  }

  useEffect(() => {
    const token = localStorage.getItem('herix-merchant-token')
    if (!token) { setLoading(false); return }
    fetchMe()
      .catch(() => localStorage.removeItem('herix-merchant-token'))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const { data } = await authApi.login(email, password)
    localStorage.setItem('herix-merchant-token', data.token)
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('herix-merchant-token')
    setUser(null)
  }

  const refreshUser = async () => {
    await fetchMe()
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
