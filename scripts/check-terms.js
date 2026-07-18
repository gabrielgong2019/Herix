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
