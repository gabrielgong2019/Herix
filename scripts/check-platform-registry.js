#!/usr/bin/env node
/* 契约唯一事实源在 @herix/shared（herix-shared/src/index.ts）。
   miniapp platforms.ts 必须从 @herix/shared 派生 PLATFORM_REGISTRY，禁止再出现本地镜像数组。
   本脚本：1) 校验共享包仍有 SOCIAL_PLATFORMS 定义；2) 校验 miniapp 引用共享包且无内嵌平台字面量。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const SHARED = path.join(ROOT, 'herix-shared/src/index.ts');
const MINIAPP = path.join(ROOT, 'herix-miniapp/src/utils/platforms.ts');

const sharedSrc = fs.readFileSync(SHARED, 'utf8');
const m = sharedSrc.match(/SOCIAL_PLATFORMS\s*=\s*\[([\s\S]*?)\]\s*as const/);
if (!m) {
  console.error(`✗ 未找到平台注册表块: ${SHARED}`);
  process.exit(1);
}
const lineRe = /\{[^}]*?id:\s*'([^']+)'[^}]*?\}/g;
let count = 0, mm;
while ((mm = lineRe.exec(m[1]))) count++;

const miniSrc = fs.readFileSync(MINIAPP, 'utf8');
if (!miniSrc.includes("from '@herix/shared'")) {
  console.error('✗ miniapp platforms.ts 未从 @herix/shared 导入契约');
  process.exit(1);
}
const embedded = miniSrc.match(/id:\s*'wechat'|id:\s*'instagram'/);
if (embedded) {
  console.error('✗ miniapp platforms.ts 存在内嵌平台字面量，应统一从 @herix/shared 派生');
  process.exit(1);
}
console.log(`✓ 平台注册表单一来源（@herix/shared 定义 ${count} 个平台，miniapp 派生引用，无镜像）`);
