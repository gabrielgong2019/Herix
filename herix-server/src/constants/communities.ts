export const COMMUNITIES = [
  { id: 'cn-in-jp', labelKey: 'community.cn-in-jp', region: 'JP' },
  { id: 'vn-in-jp', labelKey: 'community.vn-in-jp', region: 'JP' },
  { id: 'kr-in-jp', labelKey: 'community.kr-in-jp', region: 'JP' },
  { id: 'ph-in-jp', labelKey: 'community.ph-in-jp', region: 'JP' },
  { id: 'cn-in-au', labelKey: 'community.cn-in-au', region: 'AU' },
  { id: 'cn-in-us', labelKey: 'community.cn-in-us', region: 'US' },
  { id: 'cn-in-ca', labelKey: 'community.cn-in-ca', region: 'CA' },
  { id: 'cn-in-uk', labelKey: 'community.cn-in-uk', region: 'UK' },
  { id: 'cn-in-sg', labelKey: 'community.cn-in-sg', region: 'SG' },
] as const;

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
