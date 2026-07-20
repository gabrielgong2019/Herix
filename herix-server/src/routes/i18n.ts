/**
 * i18n 词条服务
 *
 * - 公开端: GET /api/i18n/:locale — 全量词典 {key:value} + version，带 ETag/304。
 *   前端打包词典兜底 + 本接口做"运营改文案不发版"的更新通道。
 * - 管理端: 挂在 adminRouter 下（继承 requireRole('ADMIN')），词条矩阵读取 + 译文更新。
 *   ⚠️ key 由 scripts/seed-i18n.ts（代码侧）创建；管理端只能改已存在 key 的译文，
 *   不能新建 key——防止 key 漂移/孤儿词条。
 */
import { Router, Request, Response } from 'express';
import pool from '../db';

const LOCALES = ['zh', 'ja', 'en', 'vi'] as const; // vi 仅客户端(2026-07-19)
type Locale = (typeof LOCALES)[number];

const now = () => new Date().toISOString();

/** 词典版本号：最后更新时间 + 行数，任一变化则版本变 */
async function dictVersion(locale: string): Promise<string> {
  const r = await pool.query(
    'SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), \'0\') AS m FROM i18n_entries WHERE locale = $1',
    [locale]
  );
  return `${r.rows[0].m}:${r.rows[0].n}`;
}

// ── 公开端 ──────────────────────────────────────────────────────────────────

export const i18nPublicRouter = Router();

i18nPublicRouter.get('/:locale', async (req: Request, res: Response) => {
  const locale = req.params.locale as Locale;
  if (!LOCALES.includes(locale)) {
    return res.status(400).json({ error: `locale 取值无效，允许: ${LOCALES.join(' / ')}` });
  }
  const version = await dictVersion(locale);
  const etag = `"${version}"`;
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  const r = await pool.query('SELECT key, value FROM i18n_entries WHERE locale = $1', [locale]);
  const entries: Record<string, string> = {};
  for (const row of r.rows) entries[row.key] = row.value;
  res.set('ETag', etag);
  res.set('Cache-Control', 'no-cache'); // 允许缓存但每次校验 ETag
  res.json({ version, locale, entries });
});

// ── 管理端（由 adminRouter.use('/i18n', ...) 挂载，鉴权继承）───────────────────

export const i18nAdminRouter = Router();

/** GET /api/admin/i18n — 词条×语言矩阵 */
i18nAdminRouter.get('/', async (_req: Request, res: Response) => {
  const r = await pool.query(
    'SELECT key, locale, value, context, updated_at, updated_by FROM i18n_entries ORDER BY key, locale'
  );
  const byKey = new Map<string, any>();
  for (const row of r.rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, { key: row.key, zh: '', ja: '', en: '', context: '', updated_at: '' });
    const item = byKey.get(row.key);
    item[row.locale] = row.value;
    if (row.context && !item.context) item.context = row.context;
    if (row.updated_at > item.updated_at) item.updated_at = row.updated_at;
  }
  res.json({ rows: [...byKey.values()] });
});

/** PATCH /api/admin/i18n/:key — 更新某词条的译文（body: {zh?, ja?, en?}）
 *  - 仅接受已存在的 key（zh 行由 seed 创建）——运营不能造 key
 *  - 某语言传空字符串 = 删除该语言译文（回退打包词典/中文）
 */
i18nAdminRouter.patch('/:key', async (req: Request, res: Response) => {
  const key = req.params.key;
  const exists = await pool.query('SELECT 1 FROM i18n_entries WHERE key = $1 LIMIT 1', [key]);
  if (!exists.rows[0]) {
    return res.status(404).json({ error: `词条 ${key} 不存在。key 由代码 seed 创建，管理端只改译文` });
  }
  const updatedBy = (req as any).user?.userId || 'admin';
  const results: Record<string, string> = {};
  for (const locale of LOCALES) {
    const v = req.body[locale];
    if (v === undefined) continue; // 未提交的语言不动
    if (typeof v !== 'string') {
      return res.status(400).json({ error: `${locale} 译文必须是字符串` });
    }
    if (v === '') {
      await pool.query('DELETE FROM i18n_entries WHERE key = $1 AND locale = $2', [key, locale]);
      results[locale] = '(已清空)';
    } else {
      await pool.query(
        `INSERT INTO i18n_entries (key, locale, value, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key, locale) DO UPDATE SET value = $3, updated_at = $4, updated_by = $5`,
        [key, locale, v, now(), updatedBy]
      );
      results[locale] = v;
    }
  }
  res.json({ key, updated: results });
});
