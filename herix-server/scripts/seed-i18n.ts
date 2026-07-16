/**
 * i18n 词条 seed —— key 的唯一创建入口（运营在 admin 只改译文，不建 key）
 *
 * 读取 herix-miniapp/src/i18n/{zh,ja,en}.json（代码侧词典 = key 清单 + 初始译文），
 * 全部按 DO NOTHING 插入：只补新 key，绝不覆盖运营在矩阵里改过的任何译文。
 *
 * 用法: cd herix-server && npx tsx --env-file=.env scripts/seed-i18n.ts
 */
import fs from 'fs';
import path from 'path';
import pool from '../src/db';

const DICT_DIR = path.resolve(__dirname, '../../herix-miniapp/src/i18n');
const LOCALES = ['zh', 'ja', 'en'] as const;

async function main() {
  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  for (const locale of LOCALES) {
    const file = path.join(DICT_DIR, `${locale}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`跳过 ${locale}: ${file} 不存在`);
      continue;
    }
    const dict: Record<string, string> = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const [key, value] of Object.entries(dict)) {
      const r = await pool.query(
        `INSERT INTO i18n_entries (key, locale, value, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, 'seed')
         ON CONFLICT (key, locale) DO NOTHING`,
        [key, locale, value, now]
      );
      if (r.rowCount) inserted++;
      else skipped++;
    }
  }
  console.log(`SEED_DONE 新增 ${inserted} 条，已存在跳过 ${skipped} 条`);
  await pool.end();
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
