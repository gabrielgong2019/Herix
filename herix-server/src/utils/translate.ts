import pool from '../db';

const LOCALES = ['ja', 'en', 'ko', 'vi'] as const;

/** 发布任务后异步翻译 title + description，存入 task_translations。fire-and-forget，不抛出。 */
export async function translateTask(taskId: string, title: string, description: string): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translate] DEEPSEEK_API_KEY not set, skipping');
    return;
  }

  try {
    const prompt =
      `请将以下任务内容翻译为日语(ja)、英语(en)、韩语(ko)、越南语(vi)。\n` +
      `仅返回合法 JSON，格式：{"ja":{"title":"...","description":"..."},"en":{...},"ko":{...},"vi":{...}}\n\n` +
      `title: ${title}\ndescription: ${description}`;

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      console.error('[translate] DeepSeek error', resp.status, await resp.text());
      return;
    }

    const json = await resp.json() as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) { console.error('[translate] empty response'); return; }

    const translations = JSON.parse(content) as Record<string, { title?: string; description?: string }>;
    const now = new Date().toISOString();

    for (const locale of LOCALES) {
      const t = translations[locale];
      if (!t?.title) continue;
      await pool.query(
        `INSERT INTO task_translations (task_id, locale, title, description, translated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (task_id, locale) DO UPDATE
           SET title = EXCLUDED.title, description = EXCLUDED.description, translated_at = EXCLUDED.translated_at`,
        [taskId, locale, t.title, t.description ?? null, now]
      );
    }

    await pool.query(
      `UPDATE tasks SET translation_status = 'done', translation_attempts = translation_attempts + 1 WHERE id = $1`,
      [taskId]
    );
    console.log(`[translate] task ${taskId} → ${LOCALES.join('/')}`);
  } catch (err) {
    console.error('[translate] failed for task', taskId, err);
    await pool.query(
      `UPDATE tasks SET translation_status = 'failed', translation_attempts = translation_attempts + 1 WHERE id = $1`,
      [taskId]
    ).catch(() => {});
  }
}
