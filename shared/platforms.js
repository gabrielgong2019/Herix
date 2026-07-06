/**
 * Herix 社交平台注册表 — 三端共用
 * preview.html / merchant.html / admin.html 均通过 <script src="/shared/platforms.js"> 引入
 *
 * inputType: 'id'  → 收账号 ID（微信、LINE、Zalo、WhatsApp）
 * inputType: 'url' → 收主页链接（Instagram、小红书、TikTok 等）
 * hasFollowers     → 是否展示粉丝数输入框
 */

var PLATFORM_REGISTRY = [
  { id: 'wechat',      name: '微信',        icon: '💬', inputType: 'id',  placeholder: '微信号 或手机号',                          hasFollowers: false },
  { id: 'instagram',   name: 'Instagram',   icon: '📸', inputType: 'url', placeholder: 'https://instagram.com/你的账号',            hasFollowers: true  },
  { id: 'xiaohongshu', name: '小红书',       icon: '📕', inputType: 'url', placeholder: 'https://www.xiaohongshu.com/user/profile/...', hasFollowers: true  },
  { id: 'tiktok',      name: 'TikTok',      icon: '🎵', inputType: 'url', placeholder: 'https://tiktok.com/@你的账号',               hasFollowers: true  },
  { id: 'line',        name: 'LINE',        icon: '💚', inputType: 'id',  placeholder: 'LINE ID（例：your_line_id）',                hasFollowers: false },
  { id: 'zalo',        name: 'Zalo',        icon: '🔵', inputType: 'id',  placeholder: 'Zalo 账号或手机号',                          hasFollowers: false },
  { id: 'whatsapp',    name: 'WhatsApp',    icon: '📱', inputType: 'id',  placeholder: '+国际区号 手机号（例：+81 90-1234-5678）',    hasFollowers: false },
  { id: 'facebook',    name: 'Facebook',    icon: '👥', inputType: 'url', placeholder: 'https://facebook.com/你的账号',              hasFollowers: true  },
  { id: 'youtube',     name: 'YouTube',     icon: '▶️', inputType: 'url', placeholder: 'https://youtube.com/@你的频道',              hasFollowers: true  },
  { id: 'twitter',     name: 'X (Twitter)', icon: '🐦', inputType: 'url', placeholder: 'https://x.com/你的账号',                     hasFollowers: true  },
];

/** 段位阈值（与后端 types/index.ts 保持同步） */
var TIER_THRESHOLDS = [
  { name: 'Macro', min: 100000 },
  { name: 'Mid',   min: 10000  },
  { name: 'Micro', min: 1000   },
  { name: 'Nano',  min: 0      },
];

/** 根据粉丝数计算段位（前端展示用，权威值以后端 tier_snapshot 为准） */
function calcTier(followers) {
  followers = followers || 0;
  for (var i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (followers >= TIER_THRESHOLDS[i].min) return TIER_THRESHOLDS[i].name;
  }
  return 'Nano';
}

/** 按 id 查找平台信息 */
function platformById(id) {
  for (var i = 0; i < PLATFORM_REGISTRY.length; i++) {
    if (PLATFORM_REGISTRY[i].id === id) return PLATFORM_REGISTRY[i];
  }
  return { id: id, name: id, icon: '🔗', inputType: 'url', placeholder: '账号链接', hasFollowers: true };
}
