/**
 * Herix 社交平台注册表 — Taro/小程序端
 *
 * ⚠️ 这是 herix-server/src/shared/contracts.ts 的 SOCIAL_PLATFORMS 镜像
 *    （Taro webpack 无法直接编译 src 外的 TS 契约文件，故镜像而非 import）。
 *    id / countLabel / inputType 三项必须与 contracts 一致——
 *    pre-push 的 platform-registry 校验会比对，漂移即报错。加平台两处同步。
 */

export interface Platform {
  id: string;
  name: string;
  icon: string;
  inputType: 'id' | 'url';
  placeholder: string;
  countLabel: 'followers' | 'friends'; // 数量门槛叫法：内容平台=粉丝数，联系平台=好友数
}

export const PLATFORM_REGISTRY: Platform[] = [
  { id: 'wechat',      name: '微信',        icon: '💬', inputType: 'id',  placeholder: '微信号 或手机号',                          countLabel: 'friends'   },
  { id: 'instagram',   name: 'Instagram',   icon: '📸', inputType: 'url', placeholder: 'https://instagram.com/你的账号',            countLabel: 'followers' },
  { id: 'xiaohongshu', name: '小红书',       icon: '📕', inputType: 'url', placeholder: 'https://www.xiaohongshu.com/user/profile/...', countLabel: 'followers' },
  { id: 'tiktok',      name: 'TikTok',      icon: '🎵', inputType: 'url', placeholder: 'https://tiktok.com/@你的账号',               countLabel: 'followers' },
  { id: 'line',        name: 'LINE',        icon: '💚', inputType: 'id',  placeholder: 'LINE ID（例：your_line_id）',                countLabel: 'friends'   },
  { id: 'zalo',        name: 'Zalo',        icon: '🔵', inputType: 'id',  placeholder: 'Zalo 账号或手机号',                          countLabel: 'friends'   },
  { id: 'whatsapp',    name: 'WhatsApp',    icon: '📱', inputType: 'id',  placeholder: '+国际区号 手机号（例：+81 90-1234-5678）',    countLabel: 'friends'   },
  { id: 'facebook',    name: 'Facebook',    icon: '👥', inputType: 'url', placeholder: 'https://facebook.com/你的账号',              countLabel: 'followers' },
  { id: 'youtube',     name: 'YouTube',     icon: '▶️', inputType: 'url', placeholder: 'https://youtube.com/@你的频道',              countLabel: 'followers' },
  { id: 'twitter',     name: 'X (Twitter)', icon: '🐦', inputType: 'url', placeholder: 'https://x.com/你的账号',                     countLabel: 'followers' },
];

export function platformById(id: string): Platform {
  const found = PLATFORM_REGISTRY.find(p => p.id === id);
  if (found) return found;
  return { id, name: id, icon: '🔗', inputType: 'url', placeholder: '账号链接', countLabel: 'followers' };
}
