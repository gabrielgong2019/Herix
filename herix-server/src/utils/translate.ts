import pool from '../db';

const LOCALES = ['ja', 'en', 'ko', 'vi'] as const;

// 单个任务最多翻译次数（跨所有编辑/重试的终身上限）
const TASK_LIFETIME_CAP = 20;
// 同一任务两次翻译之间的最短间隔（毫秒）
const COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟

/** 发布/更新任务后异步翻译 title + description，存入 task_translations。fire-and-forget，不抛出。 */
export async function translateTask(taskId: string, title: string, description: string): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translate] DEEPSEEK_API_KEY not set, skipping');
    return;
  }

  try {
    // 兜底1：终身次数硬上限，防止 bug 死循环消耗 API 额度
    const taskRow = await pool.query<{ translation_attempts: number }>(
      `SELECT translation_attempts FROM tasks WHERE id = $1`, [taskId]
    );
    const attempts = taskRow.rows[0]?.translation_attempts ?? 0;
    if (attempts >= TASK_LIFETIME_CAP) {
      console.warn(`[translate] task ${taskId} hit lifetime cap (${attempts}), skipping`);
      return;
    }

    // 兜底2：冷却时间，防止快速连续编辑触发重复调用
    const cooldownRow = await pool.query<{ last: string | null }>(
      `SELECT MAX(translated_at) AS last FROM task_translations WHERE task_id = $1`, [taskId]
    );
    const lastAt = cooldownRow.rows[0]?.last;
    if (lastAt && Date.now() - new Date(lastAt).getTime() < COOLDOWN_MS) {
      console.log(`[translate] task ${taskId} skipped (cooldown)`);
      await pool.query(`UPDATE tasks SET translation_status = 'done' WHERE id = $1`, [taskId]);
      return;
    }

    // 先计数，再调 API——无论成功失败都算一次尝试
    await pool.query(
      `UPDATE tasks SET translation_attempts = translation_attempts + 1 WHERE id = $1`, [taskId]
    );

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
      await pool.query(`UPDATE tasks SET translation_status = 'failed' WHERE id = $1`, [taskId]).catch(() => {});
      return;
    }

    const json = await resp.json() as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[translate] empty response');
      await pool.query(`UPDATE tasks SET translation_status = 'failed' WHERE id = $1`, [taskId]).catch(() => {});
      return;
    }

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

    await pool.query(`UPDATE tasks SET translation_status = 'done' WHERE id = $1`, [taskId]);
    console.log(`[translate] task ${taskId} → ${LOCALES.join('/')}`);
  } catch (err) {
    console.error('[translate] failed for task', taskId, err);
    await pool.query(
      `UPDATE tasks SET translation_status = 'failed' WHERE id = $1`, [taskId]
    ).catch(() => {});
  }
}
