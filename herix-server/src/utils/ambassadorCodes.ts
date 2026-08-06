/** 赫使推广码查询（2026-08-06 从 referrals/my-codes 抽出，供仪表盘 actions 接口复用） */
import { findMany } from './db';
import { getTaskTranslations } from './taskLocalize';

export async function fetchMyCodes(userId: string, lang?: string): Promise<any[]> {
  // 计数直读 ambassador_tasks 聚合列（CSV 上传的唯一写入点）；收入按 task_transactions 实际入账。
  // 旧版从 referrals 明细表统计——那张表 CSV 上传从不写，赫使端永远显示 0（2026-07-17 修复）
  const codes = await findMany<any>(
    `SELECT at.id, at.task_id, at.unique_code, at.status, at.joined_at,
            t.title as task_title, t.description as task_description,
            t.payout_per_herald, t.mode, t.service_name,
            trs.invitee_benefit, trs.referral_script, trs.register_url,
            at.share_intro,
            at.registered_count, at.used_count, at.paid_conversions,
            COALESCE((SELECT SUM(tt.amount) FROM task_transactions tt
              WHERE tt.task_id = at.task_id AND tt.to_user_id = at.herald_id
                AND tt.type = 'TASK_RELEASE' AND tt.status = 'completed'), 0) as earned_amount
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     LEFT JOIN task_referral_specs trs ON trs.task_id = at.task_id
     WHERE at.herald_id = ?
     ORDER BY at.joined_at DESC`, [userId]
  );
  // 任务标题/商家文案按赫使语言本地化（2026-08-05：分享弹窗与历史卡此前全是源语言）
  if (lang && lang !== 'zh') {
    const tr = await getTaskTranslations(codes.map((c: any) => c.task_id), lang);
    for (const c of codes) {
      const t = tr.get(c.task_id);
      if (!t) continue;
      if (t.title) c.task_title = t.title;
      if (t.description) c.task_description = t.description;
      if (t.invitee_benefit) c.invitee_benefit = t.invitee_benefit;
      if (t.referral_script) c.referral_script = t.referral_script;
      if (t.service_name) c.service_name = t.service_name;
    }
  }
  return codes;
}
