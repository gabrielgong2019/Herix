/**
 * 社交平台账号条目构造 + 校验 —— 档案编辑 / 新手引导 / 报名补录 三入口唯一来源。
 * 收敛前三处各写一遍且都有"联系类数字硬编码 null 存不进"的同款 bug（2026-07-29）。
 *
 * 规则：账号非空；微信走 validateWechatOrPhone 规范化；数量必填
 *      （内容平台=粉丝数、联系平台=好友数，都落 followers 字段，语义由平台 countLabel 决定）。
 */
import { platformById } from './platforms';
import { validateWechatOrPhone } from '../components/WechatOrPhoneInput';
import { t } from './i18n';

export interface BuiltEntry {
  platformId: string;
  accountId: string | null;
  url: string | null;
  followers: number | null;
}
export type MakeResult = { ok: true; entry: BuiltEntry } | { ok: false; error: string };

/** 联系类默认好友数（UI 预填，降低填写摩擦；赫使可改） */
export const DEFAULT_FRIEND_COUNT = 50;

export function makePlatformEntry(platformId: string, rawValue: string, countText: string): MakeResult {
  const p = platformById(platformId);
  const raw = (rawValue || '').trim();
  if (!raw) return { ok: false, error: t('pai.errAccount', { name: p.name }) };

  let accountId: string | null = null;
  let url: string | null = null;
  if (platformId === 'wechat') {
    const check = validateWechatOrPhone(raw);
    if (!check.ok) return { ok: false, error: check.msg! };
    accountId = check.saved!;
  } else if (p.inputType === 'id') {
    accountId = raw;
  } else {
    // url 类平台（IG/小红书/TikTok…）：必须是主页链接，防"1111"这类死链混入、被商家审核时点开
    let u = raw;
    if (!/^https?:\/\//i.test(u)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(u)) u = 'https://' + u; // 像域名就补协议
      else return { ok: false, error: t('pai.errUrl', { name: p.name }) };
    }
    url = u;
  }

  // 数量必填（粉丝/好友），允许 0（真新人）；负数/非数字拒绝
  const countStr = (countText || '').trim();
  if (countStr === '') {
    return { ok: false, error: t(p.countLabel === 'friends' ? 'pai.errFriends' : 'pai.errFollowers', { name: p.name }) };
  }
  const n = parseInt(countStr, 10);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: t('pai.errCountNum') };

  return { ok: true, entry: { platformId, accountId, url, followers: n } };
}
