import { useEffect, useState } from 'react';

// 与 styles/breakpoints.scss 的 desktop 断点保持一致
const DESKTOP_MIN_WIDTH = 768;

/**
 * 桌面视口判断，只用于 CSS 藏不掉的「组件树级」差异（如桌面侧栏 vs 底部操作栏）。
 * 优先级约定：能用 @include bp.desktop 显隐解决的，不要用这个 hook。
 *
 * weapp 端恒为 false：小程序保持手机形态（PC 微信宽窗口只享受 CSS 层的两列，
 * 不切换组件树，避免小程序端出现没测过的桌面结构）。
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (process.env.TARO_ENV !== 'h5') return false;
    return window.innerWidth >= DESKTOP_MIN_WIDTH;
  });

  useEffect(() => {
    if (process.env.TARO_ENV !== 'h5') return;
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
