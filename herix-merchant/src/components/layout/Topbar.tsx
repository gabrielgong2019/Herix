import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import i18n from '@/i18n'
import { NotificationBell } from './NotificationBell'
import { useMobileNav } from './MobileNavContext'

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
  const openNav = useMobileNav()

  const switchLang = (code: string) => {
    i18nInst.changeLanguage(code)
    localStorage.setItem('herix-merchant-lang', code)
  }

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 md:px-7 h-15 border-b"
      style={{ background: '#fff', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* 汉堡：只在窄屏出现，桌面端侧边栏常驻不需要 */}
        {openNav && (
          <button
            onClick={openNav}
            aria-label="menu"
            className="md:hidden shrink-0 p-1.5 -ml-1 rounded-md cursor-pointer"
            style={{ background: 'transparent', border: 0, color: 'var(--text)' }}
          >
            <Menu size={20} />
          </button>
        )}
        <h1 className="text-base font-bold truncate" style={{ color: 'var(--text)' }}>{title}</h1>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <NotificationBell />
        {/* Lang switcher：窄屏隐藏（语言在「账号设置」里也能改），优先保住标题和通知 */}
        <div
          className="hidden sm:flex overflow-hidden rounded-md border text-xs font-semibold"
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
