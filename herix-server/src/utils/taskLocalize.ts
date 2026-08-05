import pool from '../db';

export interface TaskLocalized {
  title?: string | null;
  description?: string | null;
  invitee_benefit?: string | null;
  referral_script?: string | null;
  service_name?: string | null;
}

/** 批量取任务的指定语言翻译；无翻译或 lang 为源语言(zh)时返回空 map，调用方保持原文。 */
export async function getTaskTranslations(taskIds: string[], lang: string): Promise<Map<string, TaskLocalized>> {
  const map = new Map<string, TaskLocalized>();
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (!ids.length || !lang || lang === 'zh') return map;
  const r = await pool.query(
    `SELECT task_id, title, description, invitee_benefit, referral_script, service_name
     FROM task_translations WHERE task_id = ANY($1) AND locale = $2`,
    [ids, lang]
  );
  for (const row of r.rows) {
    map.set(row.task_id, {
      title: row.title, description: row.description,
      invitee_benefit: row.invitee_benefit, referral_script: row.referral_script,
      service_name: row.service_name,
    });
  }
  return map;
}
