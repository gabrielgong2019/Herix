/**
 * 任务流量统计聚合（2026-08-06）。
 *
 * 从 task_events（前端埋点）+ 业务表（task_applications / task_submissions）
 * 刷新 task_stats 预聚合计数器。每条在榜任务一行，查询侧 LEFT JOIN 取数当场算分。
 *
 * 设计原则：
 * - 幂等：全程 UPSERT，重复跑不会重复计数
 * - 自包含：只读 DB，不依赖内存状态
 * - 轻量：只扫活跃任务（OPEN/IN_PROGRESS），不扫全表
 */

import pool from '../db';

export async function runTaskStatsAggregationOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. 从 task_events 聚合曝光/点击数（去重由 UNIQUE 约束保证，直接 COUNT）
    await client.query(`
      INSERT INTO task_stats (task_id, exposure_count, click_count, application_count, completion_count, updated_at)
      SELECT
        t.id,
        COALESCE(e.exposure_cnt, 0),
        COALESCE(e.click_cnt, 0),
        COALESCE(a.app_cnt, 0),
        COALESCE(s.comp_cnt, 0),
        TO_CHAR(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      FROM tasks t
      LEFT JOIN (
        SELECT task_id,
               COUNT(*) FILTER (WHERE event_type = 'exposure') AS exposure_cnt,
               COUNT(*) FILTER (WHERE event_type = 'click')     AS click_cnt
        FROM task_events
        GROUP BY task_id
      ) e ON e.task_id = t.id
      LEFT JOIN (
        SELECT task_id, COUNT(*)::int AS app_cnt
        FROM task_applications
        WHERE status = 'APPROVED'
        GROUP BY task_id
      ) a ON a.task_id = t.id
      LEFT JOIN (
        SELECT task_id, COUNT(*)::int AS comp_cnt
        FROM task_submissions
        WHERE status = 'APPROVED'
        GROUP BY task_id
      ) s ON s.task_id = t.id
      WHERE t.status IN ('OPEN', 'IN_PROGRESS')
      ON CONFLICT (task_id) DO UPDATE SET
        exposure_count    = EXCLUDED.exposure_count,
        click_count       = EXCLUDED.click_count,
        application_count = EXCLUDED.application_count,
        completion_count  = EXCLUDED.completion_count,
        updated_at        = EXCLUDED.updated_at
    `);

    // 2. 清理已下线任务的 stats 行（任务关闭/取消后无需再参与排名）
    await client.query(`
      DELETE FROM task_stats
      WHERE task_id NOT IN (
        SELECT id FROM tasks WHERE status IN ('OPEN', 'IN_PROGRESS')
      )
    `);

    // 3. 清理过期埋点事件（保留 30 天，控制表膨胀）
    await client.query(`
      DELETE FROM task_events
      WHERE hour_bucket < TO_CHAR(NOW() - INTERVAL '30 days', 'YYYY-MM-DD"T"HH24')
    `);
  } finally {
    client.release();
  }
}
