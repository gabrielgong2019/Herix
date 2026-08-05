/**
 * Herix 社交平台注册表 — Taro/小程序端
 *
 * 权威元数据（id / countLabel / inputType）来自 @herix/shared 契约；
 * 这里只叠加 UI 专属字段（name / icon / placeholder）。加平台只改契约，
 * 本端自动跟随，不再有镜像漂移。
 */

import { SOCIAL_PLATFORMS, type SocialPlatformId, type CountLabel } from '@herix/shared';

export interface Platform {
  id: SocialPlatformId;
  name: string;
  icon: string;
  inputType: 'id' | 'url';
  placeholder: string;
  countLabel: CountLabel; // 数量门槛叫法：内容平台=粉丝数，联系平台=好友数
}

const UI_META: Record<SocialPlatformId, { name: string; icon: string; placeholder: string }> = {
  wechat:      { name: '微信',        icon: '💬', placeholder: '微信号 或手机号' },
  instagram:   { name: 'Instagram',   icon: '📸', placeholder: 'https://instagram.com/你的账号' },
  xiaohongshu: { name: '小红书',       icon: '📕', placeholder: 'https://www.xiaohongshu.com/user/profile/...' },
  tiktok:      { name: 'TikTok',      icon: '🎵', placeholder: 'https://tiktok.com/@你的账号' },
  line:        { name: 'LINE',        icon: '💚', placeholder: 'LINE ID（例：your_line_id）' },
  zalo:        { name: 'Zalo',        icon: '🔵', placeholder: 'Zalo 账号或手机号' },
  whatsapp:    { name: 'WhatsApp',    icon: '📱', placeholder: '+国际区号 手机号（例：+81 90-1234-5678）' },
  facebook:    { name: 'Facebook',    icon: '👥', placeholder: 'https://facebook.com/你的账号' },
  youtube:     { name: 'YouTube',     icon: '▶️', placeholder: 'https://youtube.com/@你的频道' },
  twitter:     { name: 'X (Twitter)', icon: '🐦', placeholder: 'https://x.com/你的账号' },
};

export const PLATFORM_REGISTRY: Platform[] = SOCIAL_PLATFORMS.map((p) => ({ ...p, ...UI_META[p.id] }));

export function platformById(id: string): Platform {
  const found = PLATFORM_REGISTRY.find(p => p.id === id);
  if (found) return found;
  return { id: id as SocialPlatformId, name: id, icon: '🔗', inputType: 'url', placeholder: '账号链接', countLabel: 'followers' };
}
