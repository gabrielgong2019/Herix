import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { authApi } from '@/lib/api'
import i18n from '@/i18n'

const LANGS = [
  { code: 'zh', label: '中' },
  { code: 'ja', label: '日' },
  { code: 'en', label: 'EN' },
  { code: 'ko', label: '한국어' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  background: '#fafafa',
}

export default function Register() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const startCountdown = () => {
    setCountdown(60)
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0 }
        return c - 1
      })
    }, 1000)
  }

  const handleSendCode = async () => {
    if (!email.trim()) { setError(t('auth.errorEmailRequired')); return }
    setSendingCode(true)
    setError('')
    try {
      await authApi.sendCode(email.trim())
      setCodeSent(true)
      startCountdown()
    } catch (err: any) {
      const code = err?.response?.data?.code
      if (code === 'ACCOUNT_TAKEN') setError(t('auth.errorEmailTaken'))
      else if (code === 'CODE_TOO_FREQUENT') setError(t('auth.errorCodeFrequent'))
      else setError(err?.response?.data?.error || t('auth.errorSendCode'))
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) { setError(t('auth.errorCodeRequired')); return }
    setError('')
    setLoading(true)
    try {
      await authApi.register({ email: email.trim(), password, code: code.trim() })
      await login(email.trim(), password)
      navigate('/onboard', { replace: true })
    } catch (err: any) {
      const errCode = err?.response?.data?.code
      if (errCode === 'ACCOUNT_TAKEN') setError(t('auth.errorEmailTaken'))
      else if (errCode === 'CODE_INVALID') setError(t('auth.errorCodeInvalid'))
      else if (errCode === 'CODE_EXPIRED') setError(t('auth.errorCodeExpired'))
      else setError(err?.response?.data?.error || t('auth.errorRegister'))
    } finally {
      setLoading(false)
    }
  }

  const switchLang = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('herix-merchant-lang', code)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 380, background: '#fff', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.09)', padding: '32px 32px 28px', boxSizing: 'border-box' }}>

        {/* Lang switcher */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24, gap: 0 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => switchLang(l.code)}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 600, border: 'none',
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
          <img src="/merchant/logo-icon.png" alt="Herix" style={{ display: 'block', margin: '0 auto 12px', width: 64, height: 64, borderRadius: 14, objectFit: 'cover' }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Herix</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginTop: 6 }}>{t('auth.registerTitle')}</div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Email + send code */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
              {t('auth.email')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="brand@company.com"
                style={{ ...inputStyle, flex: 1 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendingCode || countdown > 0}
                style={{
                  padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)',
                  fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                  background: countdown > 0 ? '#f3f4f6' : 'var(--primary)', color: countdown > 0 ? 'var(--muted)' : '#fff',
                  opacity: sendingCode ? 0.7 : 1, flexShrink: 0,
                }}
              >
                {countdown > 0 ? `${countdown}s` : t('auth.sendCode')}
              </button>
            </div>
            {codeSent && (
              <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>{t('auth.codeSent')}</div>
            )}
          </div>

          {/* Verification code */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
              {t('auth.verifyCode')}
            </label>
            <input
              type="text" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="6位数字"
              maxLength={6}
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
              {t('auth.password')}
            </label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordHint')}
              style={inputStyle}
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
              width: '100%', padding: '12px', borderRadius: 10, border: 'none',
              background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.75 : 1,
            }}
          >
            {loading ? t('auth.registering') : t('auth.registerBtn')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('auth.haveAccount')}</span>
          {' '}
          <a href="/merchant/login" style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
            {t('auth.loginLink')}
          </a>
        </div>
      </div>
    </div>
  )
}
