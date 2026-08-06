/**
 * API 出口 JSON 字段序列化（2026-08-06 前后端职责收口）。
 *
 * 背景：TEXT 列里存 JSON 字符串是合理的存储方式，但此前 API 原样透传字符串，
 * 前端每个消费方各自 JSON.parse + try/catch，既重复又容易漏（如旧商家端
 * 把 JSON 数组 toString 后 parse 直接抛错）。本模块是读路径的统一出口：
 * 服务端把 JSON 字段解析成结构化对象再返回，前端只消费不再 parse。
 *
 * 约定：所有函数直接原地改传入行并返回同一引用，调用方拿返回值即可。
 */

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** 任务：platform_requirements(JSON数组)、target_communities(PG text[] 或 JSON 字符串) */
export function serializeTask(r: any): any {
  if (!r) return r;
  r.platform_requirements = parseJson(r.platform_requirements, []);
  r.target_communities = parseJson(r.target_communities, []);
  return r;
}

/** 报名：social_platforms(JSON数组)、tier_snapshot(JSON对象)、proposal_links(JSON数组) */
export function serializeApplication(r: any): any {
  if (!r) return r;
  r.social_platforms = parseJson(r.social_platforms, []);
  r.tier_snapshot = parseJson(r.tier_snapshot, {});
  r.proposal_links = parseJson(r.proposal_links, []);
  return r;
}

/** 提交/修订：content_urls、screenshot_urls 均为 JSON 数组 */
export function serializeSubmission(r: any): any {
  if (!r) return r;
  r.content_urls = parseJson(r.content_urls, []);
  r.screenshot_urls = parseJson(r.screenshot_urls, []);
  return r;
}

/** 通知：metadata(JSON对象) */
export function serializeNotification(r: any): any {
  if (!r) return r;
  r.metadata = parseJson(r.metadata, {});
  return r;
}

/** 赫使档案/用户公开信息：social_platforms(数组)、specialties(数组)、bank_account(对象)、tier_snapshot(对象) */
export function serializeHeraldProfile(r: any): any {
  if (!r) return r;
  r.social_platforms = parseJson(r.social_platforms, []);
  r.specialties = parseJson(r.specialties, []);
  r.bank_account = parseJson(r.bank_account, null);
  r.tier_snapshot = parseJson(r.tier_snapshot, {});
  return r;
}

/** 收款方式：account_details(JSON对象) */
export function serializeWithdrawalMethod(r: any): any {
  if (!r) return r;
  r.account_details = parseJson(r.account_details, {});
  return r;
}
