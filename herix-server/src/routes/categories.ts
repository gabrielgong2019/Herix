import { Router, Request, Response } from 'express';
import { findMany, findOne, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import crypto from 'crypto';

export const categoriesRouter = Router();

/** GET /api/categories — 公开，返回所有 active 分类，按 sort_order */
categoriesRouter.get('/', async (_req: Request, res: Response) => {
  const cats = await findMany<any>('SELECT * FROM categories WHERE active = TRUE ORDER BY sort_order, id');
  res.json(cats);
});

/** 以下为 Admin CRUD，需要 ADMIN 角色 */
categoriesRouter.use(requireAuth, requireRole('ADMIN'));

/** GET /api/categories/all — 管理员查全部（含 inactive） */
categoriesRouter.get('/all', async (_req: Request, res: Response) => {
  const cats = await findMany<any>('SELECT * FROM categories ORDER BY sort_order, id');
  res.json(cats);
});

/** POST /api/categories — 新建分类 */
categoriesRouter.post('/', async (req: Request, res: Response) => {
  const { id, label, icon, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: '缺少 id 或 label' });
  const exists = await findOne('SELECT id FROM categories WHERE id = ?', [id]);
  if (exists) return res.status(400).json({ error: '分类 ID 已存在' });
  await insert('categories', { id, label, icon: icon || '', sort_order: sort_order ?? 99 });
  const cat = await findOne<any>('SELECT * FROM categories WHERE id = ?', [id]);
  res.json(cat);
});

/** PATCH /api/categories/:id — 更新 */
categoriesRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { label, icon, sort_order, active } = req.body;
  const fields: any = {};
  if (label !== undefined)      fields.label      = label;
  if (icon !== undefined)       fields.icon       = icon;
  if (sort_order !== undefined) fields.sort_order = sort_order;
  if (active !== undefined)     fields.active     = active;
  if (!Object.keys(fields).length) return res.status(400).json({ error: '无更新字段' });
  await update('categories', fields, 'id = ?', [id]);
  const cat = await findOne<any>('SELECT * FROM categories WHERE id = ?', [id]);
  res.json(cat);
});
