export const SITES = [
  { id: 'jp', labelKey: 'site.jp', country: 'JP', currency: 'JPY' },
  { id: 'au', labelKey: 'site.au', country: 'AU', currency: 'AUD' },
  { id: 'us', labelKey: 'site.us', country: 'US', currency: 'USD' },
  { id: 'ca', labelKey: 'site.ca', country: 'CA', currency: 'CAD' },
  { id: 'uk', labelKey: 'site.uk', country: 'UK', currency: 'GBP' },
  { id: 'sg', labelKey: 'site.sg', country: 'SG', currency: 'SGD' },
] as const;

export type SiteId = typeof SITES[number]['id'];
export const VALID_SITES: Set<string> = new Set(SITES.map(s => s.id));
