/**
 * 赫使 profile（/auth/me）的轻量缓存 — 从 herix.html 的 loadProfile() 移植。
 * 30 秒 TTL + 请求去重（并发调用只发一次请求），避免任务/钱包/详情/我的
 * 几个页面各自重复请求 profile。写操作后调用 invalidate()。
 *
 * 有意不用类/不用第三方库：这就是一个模块级闭包，跟项目现有规模匹配。
 */

import { auth } from './api';

const TTL_MS = 30000;

let cachedProfile: any = null;
let fetchedAt = 0;
let pending: Promise<any> | null = null;

export async function getAmbassadorProfile(opts?: { force?: boolean }): Promise<any> {
  const force = opts?.force ?? false;

  if (!force && cachedProfile && Date.now() - fetchedAt < TTL_MS) {
    return cachedProfile;
  }

  if (pending) {
    return pending;
  }

  pending = auth
    .me()
    .then(profile => {
      cachedProfile = profile;
      fetchedAt = Date.now();
      return profile;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** 档案 PATCH/onboard 等写操作成功后调用，强制下次读取重新拉取 */
export function invalidateProfileCache() {
  fetchedAt = 0;
}

/** 写操作成功后，如果后端直接返回了最新数据，可以用这个同步进缓存，省一次重新请求 */
export function applyProfilePatch(serverRow: any) {
  if (!serverRow || serverRow.error) return;
  cachedProfile = { ...cachedProfile, ...serverRow };
  fetchedAt = Date.now();
}
