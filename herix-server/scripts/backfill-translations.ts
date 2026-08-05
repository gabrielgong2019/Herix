/**
 * 翻译完整性回填（2026-08-05）：把线上"done 但不完整"的任务重新翻译。
 *
 * 背景：08-03 之前翻译的任务只有 title/description（extras 未接入），
 * STANDARD 任务的 service_name 从未进翻译，且历史 done 状态不会被 retry 扫到。
 * 本脚本按「覆盖群体 → 目标语言」+「mode → 必翻字段」判定完整性，
 * 对不完整的已发布任务直接调 translateTask 重译。
 *
 * 用法: cd herix-server && npx tsx scripts/backfill-translations.ts
 */
import 'dotenv/config';
import pool from '../src/db';
import { translateTask } from '../src/utils/translate';
import { getLocalesForCommunities } from '../src/constants/communities';
import { DEFAULT_TARGET_LOCALES, SUPPORTED_LOCALES } from '../src/constants/locales';

interface TaskRow {
  id: string;
  title: string | null;
  description: string | null;
  source_lang: string | null;
  target_communities: string[];
  mode: string;
  service_name: string | null;
}

function expectedLocales(task: TaskRow): string[] {
  const communities = task.target_communities ?? [];
  const locales = communities.length
    ? getLocalesForCommunities(communities)
    : DEFAULT_TARGET_LOCALES;
  return locales.filter(l => l !== (task.source_lang ?? 'zh') && SUPPORTED_LOCALES.has(l));
}

function requiredFields(task: TaskRow, trs: { invitee_benefit: string | null; referral_script: string | null; conversion_criteria: unknown } | null): string[] {
  const fields = ['title', 'description'];
  if (task.service_name) fields.push('service_name');
  if (task.mode === 'PERFORMANCE' && trs) {
    if (trs.invitee_benefit) fields.push('invitee_benefit');
    if (trs.referral_script) fields.push('referral_script');
    if (trs.conversion_criteria) fields.push('conversion_criteria_json');
  }
  return fields;
}

async function main() {
  const tasks = await pool.query<TaskRow>(
    `SELECT id, title, description, source_lang, target_communities, mode, service_name
     FROM tasks
     WHERE status IN ('PENDING_REVIEW','OPEN','IN_PROGRESS','COMPLETED')`
  );

  let fixed = 0, skipped = 0, failed = 0;
  for (const task of tasks.rows) {
    const locales = expectedLocales(task);
    if (!locales.length) { skipped++; continue; }

    const trsRes = await pool.query<{ invitee_benefit: string | null; referral_script: string | null; conversion_criteria: unknown }>(
      `SELECT invitee_benefit, referral_script, conversion_criteria FROM task_referral_specs WHERE task_id = $1`,
      [task.id]
    );
    const trs = trsRes.rows[0] ?? null;
    const fields = requiredFields(task, trs);

    const rows = await pool.query<{ locale: string; title: string | null; description: string | null; invitee_benefit: string | null; referral_script: string | null; conversion_criteria_json: string | null; service_name: string | null }>(
      `SELECT locale, title, description, invitee_benefit, referral_script, conversion_criteria_json, service_name
       FROM task_translations WHERE task_id = $1 AND locale = ANY($2)`,
      [task.id, locales]
    );
    const byLocale = new Map(rows.rows.map(r => [r.locale, r]));
    const incomplete = locales.some(l => {
      const r = byLocale.get(l);
      if (!r) return true;
      return fields.some(f => !(r as any)[f]);
    });
    if (!incomplete) { skipped++; continue; }

    const extras: any = { serviceName: task.service_name };
    if (task.mode === 'PERFORMANCE' && trs) {
      extras.inviteeBenefit = trs.invitee_benefit;
      extras.referralScript = trs.referral_script;
      extras.conversionCriteria = trs.conversion_criteria;
    }
    console.log(`[backfill] ${task.id} ${task.title ?? ''} → ${locales.join('/')}`);
    try {
      await translateTask(task.id, task.title ?? '', task.description ?? '', task.source_lang ?? 'zh', task.target_communities ?? [], extras);
      fixed++;
    } catch (err) {
      console.error(`[backfill] FAILED ${task.id}`, err);
      failed++;
    }
  }
  console.log(`[backfill] done: fixed=${fixed} skipped=${skipped} failed=${failed}`);
  await pool.end();
}

main().catch(err => { console.error('[backfill] fatal', err); process.exit(1); });
