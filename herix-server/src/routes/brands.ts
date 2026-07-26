import { Router, Request, Response } from 'express';
import { findOne, findMany } from '../utils/db';
import { optionalAuth } from '../middleware/auth';

export const brandsRouter = Router();

/** GET /api/brands/:userId — 公开品牌主页（无需登录） */
brandsRouter.get('/:userId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const profile = await findOne<any>(
      `SELECT u.id, u.nickname, u.created_at,
              bp.company_name, bp.company_desc, bp.website, bp.industry,
              bp.logo_url, bp.promo_image_url, bp.is_agency,
              (SELECT COUNT(*)::int FROM tasks WHERE creator_id = u.id) AS total_tasks,
              (SELECT COUNT(*)::int FROM tasks WHERE creator_id = u.id AND status = 'COMPLETED') AS completed_tasks,
              (SELECT COUNT(DISTINCT ta.herald_id)::int
               FROM task_applications ta
               JOIN tasks t2 ON t2.id = ta.task_id
               WHERE t2.creator_id = u.id AND ta.status = 'APPROVED') AS total_heralds
       FROM users u
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       WHERE u.id = ? AND bp.is_onboarded = 1`,
      [userId]
    );

    if (!profile) return res.status(404).json({ error: 'brand_not_found', code: 'BRAND_NOT_FOUND' });

    const tasks = await findMany<any>(
      `SELECT t.*, u.nickname AS creator_name,
              bp.logo_url AS brand_logo_url,
              bp.promo_image_url AS brand_promo_image_url,
              (SELECT ROUND(AVG(score)::numeric, 1) FROM task_ratings tr WHERE tr.task_id = t.id) AS avg_rating
       FROM tasks t
       JOIN users u ON u.id = t.creator_id
       LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
       WHERE t.creator_id = ? AND t.status = 'OPEN'
       ORDER BY t.created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({ profile, tasks });
  } catch (err) {
    console.error('Brand profile error:', err);
    res.status(500).json({ error: '获取品牌主页失败' });
  }
});
