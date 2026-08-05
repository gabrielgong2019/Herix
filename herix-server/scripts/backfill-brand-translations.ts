/**
 * 品牌翻译回填（2026-08-05）：把线上缺少品牌简介/名称翻译的品牌补齐。
 * 品牌翻译按品牌维度维护，目标语言 = 全量默认语言 - 品牌 default_lang。
 *
 * 用法: cd herix-server && npx tsx scripts/backfill-brand-translations.ts
 */
import 'dotenv/config';
import pool from '../src/db';
import { translateBrand } from '../src/utils/translate';
import { DEFAULT_TARGET_LOCALES } from '../src/constants/locales';

interface BrandRow {
  user_id: string;
  company_name: string;
  company_desc: string | null;
  default_lang: string;
}

async function main() {
  const brands = await pool.query<BrandRow>(
    `SELECT user_id, company_name, company_desc, default_lang
     FROM brand_profiles
     WHERE company_name <> ''`
  );

  let fixed = 0, skipped = 0, failed = 0;
  for (const brand of brands.rows) {
    const locales = DEFAULT_TARGET_LOCALES.filter(l => l !== (brand.default_lang || 'zh'));
    if (!locales.length) { skipped++; continue; }

    const rows = await pool.query<{ locale: string; company_name: string | null; company_desc: string | null }>(
      `SELECT locale, company_name, company_desc FROM brand_profile_translations
       WHERE brand_id = $1 AND locale = ANY($2)`,
      [brand.user_id, locales]
    );
    const byLocale = new Map(rows.rows.map(r => [r.locale, r]));
    const incomplete = locales.some(l => {
      const r = byLocale.get(l);
      if (!r) return true;
      if (!r.company_name) return true;
      return brand.company_desc ? !r.company_desc : false;
    });
    if (!incomplete) { skipped++; continue; }

    console.log(`[backfill-brand] ${brand.user_id} ${brand.company_name} → ${locales.join('/')}`);
    try {
      await translateBrand(brand.user_id, brand.company_name, brand.company_desc, brand.default_lang || 'zh');
      fixed++;
    } catch (err) {
      console.error(`[backfill-brand] FAILED ${brand.user_id}`, err);
      failed++;
    }
  }
  console.log(`[backfill-brand] done: fixed=${fixed} skipped=${skipped} failed=${failed}`);
  await pool.end();
}

main().catch(err => { console.error('[backfill-brand] fatal', err); process.exit(1); });
