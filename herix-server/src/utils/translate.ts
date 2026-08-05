import pool from '../db';
import crypto from 'crypto';
import { getLocalesForCommunities } from '../constants/communities';
import { DEFAULT_TARGET_LOCALES, SUPPORTED_LOCALES } from '../constants/locales';
const TASK_LIFETIME_CAP = 20;

export interface TranslateExtras {
  inviteeBenefit?: string | null;
  referralScript?: string | null;
  conversionCriteria?: any;
  serviceName?: string | null;
  brandDesc?: string | null;
}

function contentHash(title: string, description: string, extras?: TranslateExtras): string {
  const extrasStr = extras ? [
    extras.inviteeBenefit || '',
    extras.referralScript || '',
    extras.serviceName || '',
    extras.brandDesc || '',
    typeof extras.conversionCriteria === 'string'
      ? extras.conversionCriteria
      : JSON.stringify(extras.conversionCriteria ?? ''),
  ].join('\n') : '';
  const normalized = (title + '\n' + description + '\n' + extrasStr)
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

/** 健壮解析 LLM 返回的 JSON（2026-08-03）：模型有时把 JSON 包在 ```json 围栏里、
 *  或前后带解说文字，直接 JSON.parse 会抛 SyntaxError。这里先剥围栏、再截取第一个 `{`
 *  到最后一个 `}`，去掉多余包裹后再 parse。真正结构损坏仍会抛，由 translateTask 外层 catch
 *  降级标 failed（既有行为），本函数只提升成功率、不吞错。 */
function parseLlmJson(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

/** 发布/更新任务后异步翻译，fire-and-forget，不抛出。
 *  targetCommunities 为空 → 翻译为所有默认目标语言（ja/en/ko/vi）
 *  targetCommunities 非空 → 仅翻译目标社群所用的语言，跳过与 sourceLang 相同的部分
 *  extras → PERFORMANCE 任务的额外商家文案字段 */
export async function translateTask(
  taskId: string,
  title: string,
  description: string,
  sourceLang = 'zh',
  targetCommunities: string[] = [],
  extras?: TranslateExtras
): Promise<void> {
  let locales: string[];
  if (targetCommunities.length > 0) {
    const communityLocales = getLocalesForCommunities(targetCommunities);
    locales = communityLocales.filter(l => l !== sourceLang && SUPPORTED_LOCALES.has(l));
    if (locales.length === 0) {
      await pool.query(`UPDATE tasks SET translation_status = 'done' WHERE id = $1`, [taskId]).catch(() => {});
      return;
    }
  } else {
    locales = DEFAULT_TARGET_LOCALES.filter(l => l !== sourceLang);
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translate] DEEPSEEK_API_KEY not set, skipping');
    return;
  }

  try {
    const hash = contentHash(title, description, extras);
    const hashRow = await pool.query<{ translation_source_hash: string | null }>(
      `SELECT translation_source_hash FROM tasks WHERE id = $1`, [taskId]
    );
    if (hashRow.rows[0]?.translation_source_hash === hash) {
      console.log(`[translate] task ${taskId} skipped (content unchanged)`);
      await pool.query(`UPDATE tasks SET translation_status = 'done' WHERE id = $1`, [taskId]);
      return;
    }

    const attemptsRow = await pool.query<{ translation_attempts: number }>(
      `SELECT translation_attempts FROM tasks WHERE id = $1`, [taskId]
    );
    const attempts = attemptsRow.rows[0]?.translation_attempts ?? 0;
    if (attempts >= TASK_LIFETIME_CAP) {
      console.warn(`[translate] task ${taskId} hit lifetime cap (${attempts})`);
      return;
    }

    await pool.query(
      `UPDATE tasks SET translation_attempts = translation_attempts + 1 WHERE id = $1`, [taskId]
    );

    const hasExtras = extras && (extras.inviteeBenefit || extras.referralScript || extras.conversionCriteria || extras.serviceName || extras.brandDesc);
    const extrasLines = hasExtras ? [
      extras!.inviteeBenefit ? `invitee_benefit: ${extras!.inviteeBenefit}` : '',
      extras!.serviceName ? `service_name: ${extras!.serviceName}` : '',
      extras!.brandDesc ? `brand_desc: ${extras!.brandDesc}` : '',
      extras!.referralScript ? `referral_script: ${extras!.referralScript}` : '',
      extras!.conversionCriteria ? `conversion_criteria (JSON，翻译所有 label/string 值，保留 JSON 结构): ${typeof extras!.conversionCriteria === 'string' ? extras!.conversionCriteria : JSON.stringify(extras!.conversionCriteria)}` : '',
    ].filter(Boolean).join('\n') : '';

    const responseFields = ['title', 'description'];
    if (hasExtras) {
      if (extras!.inviteeBenefit) responseFields.push('invitee_benefit');
      if (extras!.serviceName) responseFields.push('service_name');
      if (extras!.brandDesc) responseFields.push('brand_desc');
      if (extras!.referralScript) responseFields.push('referral_script');
      if (extras!.conversionCriteria) responseFields.push('conversion_criteria');
    }
    const sampleFields = responseFields.map(f =>
      f === 'conversion_criteria' ? `"${f}": {...}` : `"${f}": "..."`
    ).join(', ');

    const userPrompt =
      `请将以下任务内容翻译为：${locales.join('、')}。\n` +
      `仅返回合法 JSON，格式：{"ja":{${sampleFields}},"en":{...}}（只包含需要翻译的语言和字段）\n\n` +
      `title: ${title}\ndescription: ${description}` +
      (extrasLines ? '\n' + extrasLines : '');

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

    const translations = parseLlmJson(content) as Record<string, {
      title?: string;
      description?: string;
      invitee_benefit?: string;
      referral_script?: string;
      conversion_criteria?: any;
      service_name?: string;
      brand_desc?: string;
    }>;
    // 完整性校验（2026-08-05）：每个目标 locale 的必翻字段必须齐全，缺字段不落库、
    // 整单标 failed 交给 retry 重试——防止"部分翻译"被当成 done 永久固化。
    const requiredFields: string[] = ['title', 'description'];
    if (extras?.serviceName) requiredFields.push('service_name');
    if (extras?.brandDesc) requiredFields.push('brand_desc');
    if (extras?.inviteeBenefit) requiredFields.push('invitee_benefit');
    if (extras?.referralScript) requiredFields.push('referral_script');
    if (extras?.conversionCriteria) requiredFields.push('conversion_criteria');
    for (const locale of locales) {
      const t = translations[locale];
      if (!t) throw new Error(`[translate] missing locale ${locale}`);
      const missing = requiredFields.filter(f => (t as any)[f] === undefined || (t as any)[f] === null || (t as any)[f] === '');
      if (missing.length) throw new Error(`[translate] ${locale} 缺字段: ${missing.join(', ')}`);
    }
    const now = new Date().toISOString();

    for (const locale of locales) {
      const t = translations[locale];
      if (!t?.title) continue;
      const ccJson = t.conversion_criteria != null
        ? (typeof t.conversion_criteria === 'string' ? t.conversion_criteria : JSON.stringify(t.conversion_criteria))
        : null;
      await pool.query(
        `INSERT INTO task_translations
           (task_id, locale, title, description, invitee_benefit, referral_script, conversion_criteria_json, service_name, brand_desc, translated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (task_id, locale) DO UPDATE
           SET title = EXCLUDED.title,
               description = EXCLUDED.description,
               invitee_benefit = EXCLUDED.invitee_benefit,
               referral_script = EXCLUDED.referral_script,
               conversion_criteria_json = EXCLUDED.conversion_criteria_json,
               service_name = EXCLUDED.service_name,
               brand_desc = EXCLUDED.brand_desc,
               translated_at = EXCLUDED.translated_at`,
        [taskId, locale, t.title, t.description ?? null,
         t.invitee_benefit ?? null, t.referral_script ?? null, ccJson, t.service_name ?? null, t.brand_desc ?? null, now]
      );
    }

    await pool.query(
      `UPDATE tasks SET translation_status = 'done', translation_source_hash = $2 WHERE id = $1`,
      [taskId, hash]
    );
    console.log(`[translate] task ${taskId} (${sourceLang}) → ${locales.join('/')} [extras=${hasExtras ? 'yes' : 'no'}]`);
  } catch (err) {
    console.error('[translate] failed for task', taskId, err);
    await pool.query(
      `UPDATE tasks SET translation_status = 'failed' WHERE id = $1`, [taskId]
    ).catch(() => {});
  }
}
