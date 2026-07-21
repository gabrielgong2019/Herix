import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import i18n from '@/i18n'

const LANGS = [
  { code: 'zh', label: '中' },
  { code: 'ja', label: '日' },
  { code: 'en', label: 'EN' },
  { code: 'ko', label: '한국어' },
]

export default function Login() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch {
      setError(t('auth.errorInvalid'))
    } finally {
      setLoading(false)
    }
  }

  const switchLang = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('herix-merchant-lang', code)
  }

  return (
    <div
      style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}
    >
      <div style={{ width: 380, background: '#fff', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.09)', padding: '32px 32px 28px', boxSizing: 'border-box' }}>

        {/* Lang switcher — inside card, top */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24, gap: 0 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => switchLang(l.code)}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  borderLeft: l.code !== 'zh' ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer',
                  background: i18n.language === l.code ? 'var(--text)' : '#fff',
                  color: i18n.language === l.code ? '#fff' : 'var(--muted)',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="/merchant/logo-icon.png"
            alt="Herix"
            style={{ display: 'block', margin: '0 auto 12px', width: 64, height: 64, borderRadius: 14, objectFit: 'cover' }}
          />
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Herix</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginTop: 6 }}>{t('auth.loginHeadline')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{t('auth.loginSubline')}</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
              {t('auth.email')}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="brand@company.com"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                background: '#fafafa',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
              {t('auth.password')}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.password')}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                background: '#fafafa',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: 'var(--danger)', marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--primary)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.75 : 1,
            }}
          >
            {loading ? t('auth.loggingIn') : t('auth.loginBtn')}
          </button>
        </form>
      </div>
    </div>
  )
}
