import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usersApi } from '@/lib/api'

/**
 * 走错端引导页（2026-08-18）
 *
 * /auth/login 是赫使端与商户端共用的接口，不做角色校验 —— 任何账号在任一端都能登进来。
 * 核心操作虽有 requireRole 守卫（报名/交稿/发任务都会 403），但登进来后看到的是半残界面，
 * 用户不知道自己走错了门。故在此拦一道：没有 BRAND 角色就引导去赫使端，或就地开通商家身份。
 *
 * 放在前端而非登录接口：① 该拦的钱/数据操作后端已经拦住；② 双角色账号（BRAND+HERALD）
 * 必须两端都能进，后端硬拦要开特例，写错就把人锁在账号外；前端拦截 fail-safe。
 */
export function WrongPortal() {
  const { user, logout, refreshUser } = useAuth()
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const addBrandRole = async () => {
    setAdding(true)
    setErr('')
    try {
      const r = await usersApi.addRole('BRAND')
      // 后端换发含 BRAND 的新 token，必须立即替换，否则后续请求仍是旧角色
      if (r.data?.token) localStorage.setItem('herix-merchant-token', r.data.token)
      await refreshUser()
    } catch (e: any) {
      setErr(e?.response?.data?.error || '开通失败，请稍后重试')
      setAdding(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: '#fff' }}>
        <div className="text-4xl mb-3">🔀</div>
        <div className="text-lg font-semibold mb-2">这是赫使账号</div>
        <div className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
          {user?.email} 目前只有赫使身份，商家后台的功能（发布任务、上传数据、结算）需要商家身份。
        </div>

        <a
          href="/app/"
          className="block w-full py-2.5 rounded-xl text-sm font-semibold text-white mb-3"
          style={{ background: 'var(--primary)', textDecoration: 'none' }}
        >
          前往赫使端 →
        </a>

        <button
          type="button"
          onClick={addBrandRole}
          disabled={adding}
          className="w-full py-2.5 rounded-xl text-sm font-semibold mb-3 disabled:opacity-40"
          style={{ border: '1px solid var(--border)', background: '#fff', color: '#374151' }}
        >
          {adding ? '开通中…' : '我要同时成为商家（在此账号开通商家身份）'}
        </button>

        {err && <div className="text-sm mb-3" style={{ color: '#dc2626' }}>{err}</div>}

        <button type="button" onClick={logout} className="text-xs" style={{ color: 'var(--muted)' }}>
          退出登录，换个账号
        </button>
      </div>
    </div>
  )
}
