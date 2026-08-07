/**
 * 会话事件源（2026-08-07）：登录/登出/切换账号/切换语言都是跨 tab 的全局状态变化。
 * 各页面订阅 onSessionChange，变化时自行重拉数据，避免残留旧登录态的 stale UI。
 * 本模块零依赖，可被 api/i18n 任意引用而不产生循环。
 */

type SessionListener = () => void;

const listeners = new Set<SessionListener>();

export function onSessionChange(cb: SessionListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitSessionChange() {
  for (const cb of [...listeners]) {
    try { cb(); } catch { /* 单个订阅者异常不影响其他页面 */ }
  }
}
