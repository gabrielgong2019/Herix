import { Router, Request, Response } from 'express';
import { findMany, findOne, insert, update, remove } from '../utils/db';
import pool from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

export const specialtyTagsRouter = Router();

/** GET /api/specialty-tags — 公开，返回所有 active 标签 */
specialtyTagsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const tags = await findMany<any>(
      'SELECT id, sort_order FROM specialty_tags WHERE active = 1 ORDER BY sort_order, id'
    );
    res.json(tags);
  } catch (err) { console.error('[specialty-tags GET /]', err); res.status(500).json({ error: '加载失败' }); }
});

/** GET /api/specialty-tags/herald/me — 当前赫使自己的标签（需 auth，必须在 /:userId 之前注册）*/
specialtyTagsRouter.get('/herald/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const tags = await findMany<any>(
      `SELECT hst.tag_id as id, hst.source
       FROM herald_specialty_tags hst
       JOIN specialty_tags st ON st.id = hst.tag_id AND st.active = 1
       WHERE hst.herald_id = ?
       ORDER BY st.sort_order, hst.tag_id`,
      [req.user!.userId]
    );
    res.json(tags);
  } catch (err) { console.error('[specialty-tags GET /herald/me]', err); res.status(500).json({ error: '加载失败' }); }
});

/** GET /api/specialty-tags/herald/:userId — 查某赫使的标签（公开） */
specialtyTagsRouter.get('/herald/:userId', async (req: Request, res: Response) => {
  try {
    const tags = await findMany<any>(
      `SELECT hst.tag_id as id, hst.source
       FROM herald_specialty_tags hst
       JOIN specialty_tags st ON st.id = hst.tag_id AND st.active = 1
       WHERE hst.herald_id = ?
       ORDER BY st.sort_order, hst.tag_id`,
      [req.params.userId]
    );
    res.json(tags);
  } catch (err) { console.error('[specialty-tags GET /herald/:userId]', err); res.status(500).json({ error: '加载失败' }); }
});

/** PUT /api/specialty-tags/herald/me — 赫使更新自己的标签（替换全部） */
specialtyTagsRouter.put('/herald/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { tagIds } = req.body as { tagIds: string[] };
    if (!Array.isArray(tagIds)) return res.status(400).json({ error: 'tagIds must be array' });
    if (tagIds.length > 8) return res.status(400).json({ error: '最多选8个标签' });

    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(',');
      const valid = await findMany<any>(
        `SELECT id FROM specialty_tags WHERE id IN (${placeholders}) AND active = 1`, tagIds
      );
      if (valid.length !== tagIds.length) return res.status(400).json({ error: '包含无效标签ID' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM herald_specialty_tags WHERE herald_id = $1 AND source = $2',
        [userId, 'manual']
      );
      for (const tagId of tagIds) {
        await client.query(
          'INSERT INTO herald_specialty_tags (herald_id, tag_id, source) VALUES ($1, $2, $3)',
          [userId, tagId, 'manual']
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ ok: true, tagIds });
  } catch (err: any) {
    console.error('[specialty-tags PUT /herald/me]', err);
    res.status(500).json({ error: '保存失败，请重试' });
  }
});

/** 以下为 Admin CRUD */
specialtyTagsRouter.use(requireAuth, requireRole('ADMIN'));

/** GET /api/specialty-tags/all — 管理员查全部（含 inactive） */
specialtyTagsRouter.get('/all', async (_req: Request, res: Response) => {
  try {
    const tags = await findMany<any>(
      `SELECT st.*, COUNT(hst.herald_id)::int as herald_count
       FROM specialty_tags st
       LEFT JOIN herald_specialty_tags hst ON hst.tag_id = st.id
       GROUP BY st.id ORDER BY st.sort_order, st.id`
    );
    res.json(tags);
  } catch (err) { console.error('[specialty-tags GET /all]', err); res.status(500).json({ error: '加载失败' }); }
});

/** POST /api/specialty-tags — 新建标签 */
specialtyTagsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { id, sort_order } = req.body;
    if (!id || !/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'id 必须为小写ASCII和连字符' });
    const exists = await findOne('SELECT id FROM specialty_tags WHERE id = ?', [id]);
    if (exists) return res.status(400).json({ error: '标签ID已存在' });
    await insert('specialty_tags', { id, sort_order: sort_order ?? 99 });
    res.json(await findOne<any>('SELECT * FROM specialty_tags WHERE id = ?', [id]));
  } catch (err) { console.error('[specialty-tags POST /]', err); res.status(500).json({ error: '创建失败' }); }
});

/** PATCH /api/specialty-tags/:id — 更新排序或上下架 */
specialtyTagsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { sort_order, active } = req.body;
    const fields: any = {};
    if (sort_order !== undefined) fields.sort_order = sort_order;
    if (active !== undefined)     fields.active     = active ? 1 : 0;
    if (!Object.keys(fields).length) return res.status(400).json({ error: '无更新字段' });
    await update('specialty_tags', fields, 'id = ?', [req.params.id]);
    res.json(await findOne<any>('SELECT * FROM specialty_tags WHERE id = ?', [req.params.id]));
  } catch (err) { console.error('[specialty-tags PATCH /:id]', err); res.status(500).json({ error: '更新失败' }); }
});
