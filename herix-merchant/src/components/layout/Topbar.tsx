import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { NotificationBell } from './NotificationBell'

const LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'EN' },
  { code: 'ko', label: '한국어' },
]

interface TopbarProps {
  title: string
  actions?: React.ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  const { i18n: i18nInst } = useTranslation()

  const switchLang = (code: string) => {
    i18nInst.changeLanguage(code)
    localStorage.setItem('herix-merchant-lang', code)
  }

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-7 h-15 border-b"
      style={{ background: '#fff', borderColor: 'var(--border)' }}
    >
      <h1 className="text-base font-bold" style={{ color: 'var(--text)' }}>{title}</h1>

      <div className="flex items-center gap-3">
        <NotificationBell />
        {/* Lang switcher */}
        <div
          className="flex overflow-hidden rounded-md border text-xs font-semibold"
          style={{ borderColor: 'var(--border)' }}
        >
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => switchLang(l.code)}
              className="px-2.5 py-1.5 border-0 cursor-pointer transition-colors"
              style={
                i18n.language === l.code
                  ? { background: 'var(--text)', color: '#fff' }
                  : { background: '#fff', color: 'var(--muted)' }
              }
            >
              {l.label}
            </button>
          ))}
        </div>

        {actions}
      </div>
    </header>
  )
}
