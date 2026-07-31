#!/usr/bin/env node
/* miniapp platforms.ts 是 contracts.SOCIAL_PLATFORMS 的镜像（Taro 无法直接编译 src 外 TS）。
   本脚本比对两者 id→countLabel→inputType，漂移即报错。接入 pre-push + CI。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function parse(file, blockRe) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(blockRe);
  if (!m) { console.error(`✗ 未找到平台注册表块: ${file}`); process.exit(1); }
  const map = {};
  const lineRe = /\{[^}]*?id:\s*'([^']+)'[^}]*?\}/g;
  let mm;
  while ((mm = lineRe.exec(m[1]))) {
    const entry = mm[0];
    const id = mm[1];
    const cl = (entry.match(/countLabel:\s*'([^']+)'/) || [])[1];
    const it = (entry.match(/inputType:\s*'([^']+)'/) || [])[1];
    map[id] = `${cl}|${it}`;
  }
  return map;
}

const contracts = parse(
  path.join(ROOT, 'herix-server/src/shared/contracts.ts'),
  /SOCIAL_PLATFORMS\s*=\s*\[([\s\S]*?)\]\s*as const/
);
const miniapp = parse(
  path.join(ROOT, 'herix-miniapp/src/utils/platforms.ts'),
  /PLATFORM_REGISTRY[^=]*=\s*\[([\s\S]*?)\];/
);

const ids = new Set([...Object.keys(contracts), ...Object.keys(miniapp)]);
const drift = [];
for (const id of ids) {
  if (contracts[id] !== miniapp[id]) drift.push(`  ${id}: contracts=${contracts[id] || '缺'} / miniapp=${miniapp[id] || '缺'}`);
}
if (drift.length) {
  console.error('✗ 平台注册表漂移（contracts 与 miniapp platforms.ts 不一致）：\n' + drift.join('\n'));
  process.exit(1);
}
console.log(`✓ 平台注册表一致（${Object.keys(contracts).length} 个平台，id/countLabel/inputType 对齐）`);
