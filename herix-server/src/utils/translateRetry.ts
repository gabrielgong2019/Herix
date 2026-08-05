/**
 * 翻译重试（原为 index.ts 内联 setInterval，2026-08-02 抽出并入 jobs registry）：
 * 发布时 fire-and-forget 失败的、以及编辑后置 pending 的任务，批量补翻。
 * 2026-08-03：扩展为带 extras（PERFORMANCE 任务额外文案字段），与 translateTask 保持同步。
 */
import pool from '../db';
import { translateTask } from './translate';

export async function runTranslationRetryOnce(): Promise<void> {
  try {
    const rows = await pool.query<{
      id: string; title: string; description: string;
      source_lang: string; target_communities: string[];
      mode: string; service_name: string | null; brand_desc: string | null;
      invitee_benefit: string | null; referral_script: string | null; conversion_criteria: any;
    }>(
      `SELECT t.id, t.title, t.description, t.source_lang, t.target_communities, t.mode, t.service_name,
              bp.company_desc as brand_desc,
              trs.invitee_benefit, trs.referral_script, trs.conversion_criteria
       FROM tasks t
       LEFT JOIN task_referral_specs trs ON trs.task_id = t.id
       LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
       WHERE (t.translation_status = 'failed' AND t.translation_attempts < 20)
          OR  t.translation_status = 'pending'
       LIMIT 10`
    );
    for (const row of rows.rows) {
      // service_name 是任务通用字段，STANDARD/PERFORMANCE 都要翻；
      // 邀请码任务的其余商家文案（好友得到/参考话术/转化条件）仅 PERFORMANCE 有
      const extras: any = { serviceName: row.service_name, brandDesc: row.brand_desc };
      if (row.mode === 'PERFORMANCE') {
        extras.inviteeBenefit = row.invitee_benefit;
        extras.referralScript = row.referral_script;
        extras.conversionCriteria = row.conversion_criteria;
      }
      translateTask(row.id, row.title, row.description ?? '', row.source_lang ?? 'zh', row.target_communities ?? [], extras).catch(() => {});
    }
  } catch (err) {
    console.error('[translate-retry] sweep error', err);
  }
}
