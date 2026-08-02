/**
 * 翻译重试（原为 index.ts 内联 setInterval，2026-08-02 抽出并入 jobs registry）：
 * 发布时 fire-and-forget 失败的、以及编辑后置 pending 的任务，批量补翻。
 */
import pool from '../db';
import { translateTask } from './translate';

export async function runTranslationRetryOnce(): Promise<void> {
  try {
    const rows = await pool.query<{ id: string; title: string; description: string; source_lang: string; target_communities: string[] }>(
      `SELECT id, title, description, source_lang, target_communities FROM tasks
       WHERE (translation_status = 'failed' AND translation_attempts < 20)
          OR  translation_status = 'pending'
       LIMIT 10`
    );
    for (const row of rows.rows) {
      translateTask(row.id, row.title, row.description ?? '', row.source_lang ?? 'zh', row.target_communities ?? []).catch(() => {});
    }
  } catch (err) {
    console.error('[translate-retry] sweep error', err);
  }
}
