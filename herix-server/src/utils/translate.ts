import pool from '../db';
import crypto from 'crypto';

const ALL_LOCALES = ['ja', 'en', 'ko', 'vi'] as const;
const TASK_LIFETIME_CAP = 20;

/**
 * 内容哈希：去除标点符号和空白后比较，纯标点/格式改动不触发重译。
 * 保留汉字、字母、数字（\p{L}\p{N}），其余全部剥离。
 */
function contentHash(title: string, description: string): string {
  const normalized = (title + '\n' + description)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

const SYSTEM_CONTEXT = `你是 Herix 平台的专业翻译助手。
Herix 是面向日本华人社群的网红营销平台，连接品牌商家与在日华人推广大使。

术语对照（必须严格使用，不得自行发挥）：
- 赫使 → アンバサダー(ja) / Ambassador(en) / 앰배서더(ko) / Đại sứ(vi)
- 推广码 → 紹介コード(ja) / Referral code(en) / 추천 코드(ko) / Mã giới thiệu(vi)
- 任务/案件 → タスク/案件(ja) / Task/Campaign(en) / 태스크(ko) / Nhiệm vụ(vi)
- 转化 → コンバージョン(ja) / Conversion(en) / 전환(ko) / Chuyển đổi(vi)
- 结算 → 精算(ja) / Settlement(en) / 정산(ko) / Thanh toán(vi)
- 海外华人社群 → 海外华人コミュニティ(ja) / Diaspora community(en) / 해외 화교 커뮤니티(ko) / Cộng đồng người Hoa(vi)

翻译风格：保持营销文案的吸引力，语气专业但友好，贴近目标语言母语者习惯。`;

/** 发布/更新任务后异步翻译，fire-and-forget，不抛出。 */
export async function translateTask(taskId: string, title: string, description: string, sourceLang = 'zh'): Promise<void> {
  const locales = ALL_LOCALES.filter(l => l !== sourceLang);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translate] DEEPSEEK_API_KEY not set, skipping');
    return;
  }

  try {
    // 兜底1：内容哈希——标点/格式改动不触发翻译
    const hash = contentHash(title, description);
    const hashRow = await pool.query<{ translation_source_hash: string | null }>(
      `SELECT translation_source_hash FROM tasks WHERE id = $1`, [taskId]
    );
    if (hashRow.rows[0]?.translation_source_hash === hash) {
      console.log(`[translate] task ${taskId} skipped (content unchanged)`);
      await pool.query(`UPDATE tasks SET translation_status = 'done' WHERE id = $1`, [taskId]);
      return;
    }

    // 兜底2：终身次数硬上限，防 bug 死循环
    const attemptsRow = await pool.query<{ translation_attempts: number }>(
      `SELECT translation_attempts FROM tasks WHERE id = $1`, [taskId]
    );
    const attempts = attemptsRow.rows[0]?.translation_attempts ?? 0;
    if (attempts >= TASK_LIFETIME_CAP) {
      console.warn(`[translate] task ${taskId} hit lifetime cap (${attempts})`);
      return;
    }

    // 先计数再调 API，无论成功失败均消耗次数
    await pool.query(
      `UPDATE tasks SET translation_attempts = translation_attempts + 1 WHERE id = $1`, [taskId]
    );

    const userPrompt =
      `请将以下任务内容翻译为：${locales.join('、')}。\n` +
      `仅返回合法 JSON，格式：{"ja":{"title":"...","description":"..."},"en":{...},"ko":{...},"vi":{...}}（只包含需要翻译的语言）\n\n` +
      `title: ${title}\ndescription: ${description}`;

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_CONTEXT },
          { role: 'user', content: userPrompt },
        ],
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

    for (const locale of locales) {
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
      `UPDATE tasks SET translation_status = 'done', translation_source_hash = $2 WHERE id = $1`,
      [taskId, hash]
    );
    console.log(`[translate] task ${taskId} (${sourceLang}) → ${locales.join('/')}`);
  } catch (err) {
    console.error('[translate] failed for task', taskId, err);
    await pool.query(
      `UPDATE tasks SET translation_status = 'failed' WHERE id = $1`, [taskId]
    ).catch(() => {});
  }
}
