import { findMany } from './db';

/** 报名列表档案字段（赫使身份/平台/履历/方案）——任务详情内嵌、GET /tasks/:id/applications、
 *  GET /applications/pending 三处共用，字段集必须一致（HeraldDrawer 两个上下文渲染同一结构） */
const APPLICATION_PROFILE_SQL = `
  SELECT ta.*, u.nickname, u.avatar_url, hp.display_name, hp.country,
         hp.social_platforms, hp.tier_snapshot, hp.social_platforms_updated_at,
         hp.community, hp.bio,
         (SELECT COUNT(*)::int FROM task_submissions ts2 WHERE ts2.herald_id = ta.herald_id AND ts2.status = 'APPROVED') AS completed_tasks,
         (SELECT ROUND(AVG(CASE WHEN tr.score >= 4 THEN 1.0 ELSE 0 END) * 100) / 100.0
          FROM task_ratings tr WHERE tr.herald_id = ta.herald_id) AS good_rate,
         (SELECT json_agg(hst.tag_id ORDER BY st.sort_order)
          FROM herald_specialty_tags hst
          JOIN specialty_tags st ON st.id = hst.tag_id
          WHERE hst.herald_id = ta.herald_id AND st.active = 1) AS specialty_tags
  FROM task_applications ta
  JOIN users u ON u.id = ta.herald_id
  LEFT JOIN herald_profiles hp ON hp.user_id = ta.herald_id`;

/** 单任务全部报名（任务详情内嵌 + GET /tasks/:id/applications） */
export async function fetchTaskApplications(taskId: string): Promise<any[]> {
  return findMany<any>(
    `${APPLICATION_PROFILE_SQL}
     WHERE ta.task_id = ? ORDER BY ta.created_at DESC`, [taskId]
  );
}

/** 商家名下全部待审报名（审核队列页就地审核，含任务标题上下文） */
export async function fetchPendingApplications(brandUserId: string): Promise<any[]> {
  return findMany<any>(
    `${APPLICATION_PROFILE_SQL.replace('SELECT ta.*,', 'SELECT ta.*, t.title AS task_title,')}
     JOIN tasks t ON t.id = ta.task_id
     WHERE t.creator_id = ? AND ta.status = 'PENDING'
     ORDER BY ta.created_at ASC`, [brandUserId]
  );
}
