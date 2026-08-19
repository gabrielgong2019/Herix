import { createContext, useContext } from 'react'

/**
 * 窄屏抽屉的"打开"回调。Topbar 用它渲染汉堡按钮 —— 各页面自己渲染 Topbar，
 * 走 context 就不用给十几个页面逐个加 prop（2026-08-18 手机端适配）。
 */
export const MobileNavContext = createContext<(() => void) | null>(null)

export const useMobileNav = () => useContext(MobileNavContext)
