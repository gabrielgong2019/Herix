import pool from '../db';
import { createNotification } from '../routes/notifications';
import { sendMail } from './mailer';

// Stage names per locale (used to resolve {{stage}} variable before interpolation)
const STAGE_NAMES: Record<string, Record<string, string>> = {
  DRAFT: { zh: '草稿', en: 'draft', ja: '下書き', vi: 'bản nháp', ko: '초안' },
  FINAL: { zh: '终稿', en: 'final submission', ja: '本稿', vi: 'bản cuối', ko: '최종본' },
};

// Simple {{variable}} interpolation
function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{{${key}}}`
  );
}

export interface NotifyOptions {
  userId: string;
  email?: string | null;
  type: string;
  variables?: Record<string, string | number>;
  targetRole?: string;
  metadata?: Record<string, any>;
  // Legacy fallback — used if i18n template not found
  title?: string;
  body?: string;
}

/**
 * 统一通知入口：写站内信 + 发邮件（若有）。
 * 通知文案从 i18n_entries 表按用户 preferred_lang 查找，key 格式为
 * notify.TYPE.title / notify.TYPE.body，支持 {{variable}} 插值。
 * 后续接推送 / 企微 / 微信只需在此扩展，调用方不改。
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  // 1. 查用户语言
  const langRow = await pool.query(
    `SELECT preferred_lang FROM users WHERE id = $1`,
    [opts.userId]
  );
  let lang = (langRow.rows[0]?.preferred_lang as string) || 'zh';

  // 2. 从 i18n_entries 查模板
  const titleKey = `notify.${opts.type}.title`;
  const bodyKey  = `notify.${opts.type}.body`;
  const tmplRows = await pool.query(
    `SELECT key, value FROM i18n_entries WHERE key = ANY($1) AND locale = $2`,
    [[titleKey, bodyKey], lang]
  );

  // fallback to zh if lang template missing
  let titleTmpl: string | undefined;
  let bodyTmpl: string | undefined;
  for (const r of tmplRows.rows) {
    if (r.key === titleKey) titleTmpl = r.value;
    if (r.key === bodyKey)  bodyTmpl  = r.value;
  }

  if ((!titleTmpl || !bodyTmpl) && lang !== 'zh') {
    const fallback = await pool.query(
      `SELECT key, value FROM i18n_entries WHERE key = ANY($1) AND locale = 'zh'`,
      [[titleKey, bodyKey]]
    );
    for (const r of fallback.rows) {
      if (r.key === titleKey && !titleTmpl) titleTmpl = r.value;
      if (r.key === bodyKey  && !bodyTmpl)  bodyTmpl  = r.value;
    }
  }

  // 3. Interpolate variables (resolve {{stage}} → localized stage name first)
  const vars: Record<string, string | number> = { ...opts.variables };
  if (typeof vars.stage === 'string' && STAGE_NAMES[vars.stage]) {
    vars.stage = STAGE_NAMES[vars.stage][lang] ?? STAGE_NAMES[vars.stage]['zh'];
  }

  const title = titleTmpl ? interpolate(titleTmpl, vars) : (opts.title ?? opts.type);
  const body  = bodyTmpl  ? interpolate(bodyTmpl,  vars) : (opts.body  ?? '');

  // 4. Write notification + send email
  await createNotification({
    userId: opts.userId,
    type: opts.type,
    title,
    body,
    targetRole: opts.targetRole,
    metadata: opts.metadata,
  });

  if (opts.email) {
    const subject = `【Herix】${title}`;
    sendMail(opts.email, subject, body).catch((e) => console.error('[notify] sendMail failed:', e));
  }
}
