import type { LocaleCode } from './locales';

type CommunityEntry = Readonly<{ id: string; labelKey: string; region: string; locale: LocaleCode }>;

// satisfies 确保 locale 值合法，as const 保留字面量类型（供 CommunityId 派生）
export const COMMUNITIES = [
  { id: 'cn-in-jp', labelKey: 'community.cn-in-jp', region: 'JP', locale: 'zh' },
  { id: 'vn-in-jp', labelKey: 'community.vn-in-jp', region: 'JP', locale: 'vi' },
  { id: 'kr-in-jp', labelKey: 'community.kr-in-jp', region: 'JP', locale: 'ko' },
  { id: 'ph-in-jp', labelKey: 'community.ph-in-jp', region: 'JP', locale: 'en' },
  { id: 'cn-in-au', labelKey: 'community.cn-in-au', region: 'AU', locale: 'zh' },
  { id: 'cn-in-us', labelKey: 'community.cn-in-us', region: 'US', locale: 'zh' },
  { id: 'cn-in-ca', labelKey: 'community.cn-in-ca', region: 'CA', locale: 'zh' },
  { id: 'cn-in-uk', labelKey: 'community.cn-in-uk', region: 'UK', locale: 'zh' },
  { id: 'cn-in-sg', labelKey: 'community.cn-in-sg', region: 'SG', locale: 'zh' },
] as const satisfies readonly CommunityEntry[];

export type CommunityId = typeof COMMUNITIES[number]['id'];
export const VALID_COMMUNITIES: Set<string> = new Set(COMMUNITIES.map(c => c.id));

/** 从 community id 推导站点 id（region 小写），找不到返回 null */
export function communityToSite(communityId: string): string | null {
  const c = COMMUNITIES.find(x => x.id === communityId);
  return c ? c.region.toLowerCase() : null;
}

/** 返回属于指定站点的所有社群 */
export function getCommunitiesBySite(siteId: string) {
  return COMMUNITIES.filter(c => c.region.toLowerCase() === siteId.toLowerCase());
}

/** 根据社群 id 列表推导需要翻译的目标 locale 集合（去重）。空列表返回空数组。 */
export function getLocalesForCommunities(communityIds: string[]): string[] {
  const locales = new Set<string>();
  for (const id of communityIds) {
    const c = COMMUNITIES.find(x => x.id === id);
    if (c) locales.add(c.locale);
  }
  return Array.from(locales);
}
