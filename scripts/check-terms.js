#!/usr/bin/env node
/**
 * 品牌术语一致性检查器 —— 术语定稿见 docs/Herix_Ambassador_PRD.md §27
 * 扫描所有对外文案文件，发现"禁用词"即退出码 1（可挂 CI / 发版前手跑）。
 * 用法: node scripts/check-terms.js
 */
const fs = require('fs');
const path = require('path');

// 禁用词 → 正确用法（正则均区分大小写；只扫对外文案文件，不扫代码标识符）
const BANNED = [
  { re: /代理商/g,        fix: '广告代理' },
  { re: /プロモコード/g,   fix: '紹介コード' },
  { re: /転換/g,          fix: 'コンバージョン' },
  { re: /結算/g,          fix: '精算（日文）——"結算"是中文错字' },
  { re: /移住者/g,        fix: '海外ルーツ（コミュニティ）' },
  { re: /(?<![A-Za-z])Heralds/g,       fix: 'Ambassadors（英文对外文案禁用 Herald 直译）' },
  { re: /海外华人/g,      fix: '海外生活社群（2026-07-17 定位泛化）' },
  { re: /赫府/g,          fix: '广告代理（2026-07-18 旧称废弃）' },
];

// 对外文案所在文件（新增文案文件记得补这里）
const TARGETS = [
  'index.html', 'merchant.html', 'admin.html', 'herix.html',
  'herix-miniapp/src/i18n/zh.json',
  'herix-miniapp/src/i18n/ja.json',
  'herix-miniapp/src/i18n/en.json',
  'herix-miniapp/src/i18n/vi.json', // vi=仅客户端，键集守卫见文件末尾 checkViParity()
];

const root = path.join(__dirname, '..');

// Taro 源码整目录纳入（防 tsx 里硬编码文案绕过词条；标识符如 maxHeralds 已被正则排除）
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|scss)$/.test(e.name) && !e.name.endsWith('.d.ts')) TARGETS.push(path.relative(root, p));
  }
}
walk(path.join(root, 'herix-miniapp/src'));

let bad = 0;
for (const rel of TARGETS) {
  const f = path.join(root, rel);
  if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { re, fix } of BANNED) {
      re.lastIndex = 0;
      if (re.test(line)) {
        console.log(`${rel}:${i + 1}  禁用词 ${re.source} → 应为「${fix}」`);
        console.log(`    ${line.trim().slice(0, 100)}`);
        bad++;
      }
    }
  });
}
if (bad) {
  console.error(`\n✗ ${bad} 处术语违例，术语表见 docs/Herix_Ambassador_PRD.md §27`);
  process.exit(1);
}
console.log('✓ 术语检查通过（PRD §27）');


// ── 国际化分叉守卫（2026-07-19，PRD §27.1）：vi 仅客户端 ──
// 硬性错误：vi.json 出现 merchant.* 键（范围违规）
// 警告：zh 客户端键缺 vi 译文（运行时回落中文不白屏，但要有意识地补齐）
function checkViParity() {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'herix-miniapp/src/i18n/zh.json'), 'utf8'));
  const vi = JSON.parse(fs.readFileSync(path.join(root, 'herix-miniapp/src/i18n/vi.json'), 'utf8'));
  const viMerchant = Object.keys(vi).filter((k) => k.startsWith('merchant.'));
  if (viMerchant.length) {
    console.error(`✗ 分叉违规：vi.json 含 ${viMerchant.length} 个 merchant.* 键（vi 仅客户端）：${viMerchant.slice(0, 5).join(', ')}...`);
    process.exit(1);
  }
  const clientKeys = Object.keys(zh).filter((k) => !k.startsWith('merchant.'));
  const missing = clientKeys.filter((k) => !(k in vi));
  if (missing.length) {
    console.warn(`⚠ ${missing.length} 个客户端键缺 vi 译文（回落中文，需有意识补齐）：${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '...' : ''}`);
  } else {
    console.log('✓ vi 键集与客户端键集齐平');
  }
}
checkViParity();
