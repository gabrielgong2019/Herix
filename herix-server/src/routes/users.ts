import { Router, Request, Response } from 'express';
import { findOne, findMany, update, insert } from '../utils/db';
import { requireAuth, signToken } from '../middleware/auth';
import { UpdateBrandProfileSchema, UpdateHeraldProfileSchema } from '../types';
import { ZodError } from 'zod';

export const usersRouter = Router();

/** PATCH /api/users/profile/brand — 更新品牌商家资料 */
usersRouter.patch('/profile/brand', requireAuth, (req: Request, res: Response) => {
  try {
    const data = UpdateBrandProfileSchema.parse(req.body);

    const existing = findOne<{ id: string }>('SELECT id FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    if (existing) {
      update('brand_profiles', {
        company_name: data.companyName,
        company_desc: data.companyDesc || null,
        website: data.website || null,
        industry: data.industry || null,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
      }, 'user_id = ?', [req.user!.userId]);
    } else {
      insert('brand_profiles', {
        user_id: req.user!.userId,
        company_name: data.companyName,
        company_desc: data.companyDesc || null,
        website: data.website || null,
        industry: data.industry || null,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
      });
    }

    const profile = findOne('SELECT * FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    res.json(profile);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: '更新失败' });
  }
});

/** PATCH /api/users/profile/herald — 更新赫使资料 */
usersRouter.patch('/profile/herald', requireAuth, (req: Request, res: Response) => {
  try {
    const data = UpdateHeraldProfileSchema.parse(req.body);

    const profileData: Record<string, any> = {
      display_name: data.displayName,
      bio: data.bio || null,
      country: data.country || null,
      diaspora_group: data.diasporaGroup || null,
      social_platforms: data.socialPlatforms ? JSON.stringify(data.socialPlatforms) : null,
      specialties: data.specialties ? JSON.stringify(data.specialties) : null,
    };

    const existing = findOne<{ id: string }>('SELECT id FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
    if (existing) {
      update('herald_profiles', profileData, 'user_id = ?', [req.user!.userId]);
    } else {
      insert('herald_profiles', { user_id: req.user!.userId, ...profileData });
    }

    const profile = findOne('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
    res.json(profile);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: '更新失败' });
  }
});

/** PATCH /api/users/me — 修改昵称 */
usersRouter.patch('/me', requireAuth, (req: Request, res: Response) => {
  const { nickname } = req.body;
  if (!nickname || !nickname.trim()) return res.status(400).json({ error: '昵称不能为空' });
  update('users', { nickname: nickname.trim() }, 'id = ?', [req.user!.userId]);
  res.json({ success: true, nickname: nickname.trim() });
});

/** POST /api/users/add-role — 添加第二个角色 */
usersRouter.post('/add-role', requireAuth, (req: Request, res: Response) => {
  const { role } = req.body as { role: 'HERALD' | 'BRAND' };
  if (!['HERALD', 'BRAND'].includes(role)) {
    return res.status(400).json({ error: '角色只能是 HERALD 或 BRAND' });
  }

  const user = findOne<any>('SELECT id, role, roles, nickname FROM users WHERE id = ?', [req.user!.userId]);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  let currentRoles: string[] = [];
  try { currentRoles = JSON.parse(user.roles || '[]'); } catch { currentRoles = [user.role]; }
  if (!currentRoles.includes(user.role)) currentRoles.unshift(user.role);

  if (currentRoles.includes(role)) {
    return res.status(409).json({ error: `已拥有 ${role} 角色` });
  }

  // 创建对应档案
  if (role === 'BRAND') {
    const existing = findOne('SELECT id FROM brand_profiles WHERE user_id = ?', [user.id]);
    if (!existing) insert('brand_profiles', { user_id: user.id, company_name: '', contact_name: user.nickname || '' });
  } else {
    const existing = findOne('SELECT id FROM herald_profiles WHERE user_id = ?', [user.id]);
    if (!existing) insert('herald_profiles', { user_id: user.id, display_name: user.nickname || '赫使' });
  }

  const newRoles = [...currentRoles, role];
  update('users', { roles: JSON.stringify(newRoles) }, 'id = ?', [user.id]);

  // 返回新 token（含更新后的 roles）
  const token = signToken({ userId: user.id, role: user.role, roles: newRoles });
  res.json({ success: true, roles: newRoles, token });
});

/** POST /api/users/brand/onboard — 品牌入驻 */
usersRouter.post('/brand/onboard', requireAuth, (req: Request, res: Response) => {
  const { companyName, industry, companyDesc, website, contactName, contactPhone } = req.body;
  if (!companyName || !contactName) {
    return res.status(400).json({ error: '公司名称和联系人姓名为必填项' });
  }
  update('brand_profiles', {
    company_name: companyName,
    industry: industry || null,
    company_desc: companyDesc || null,
    website: website || null,
    contact_name: contactName,
    contact_phone: contactPhone || null,
    is_onboarded: 1,
  }, 'user_id = ?', [req.user!.userId]);
  res.json({ success: true });
});

/** GET /api/users/heralds — 赫使列表 (公开) */
usersRouter.get('/heralds', (_req: Request, res: Response) => {
  const heralds = findMany<any>(
    `SELECT u.id, u.nickname, hp.display_name, hp.country, hp.diaspora_group, hp.specialties, hp.social_platforms
     FROM users u
     JOIN herald_profiles hp ON hp.user_id = u.id
     WHERE u.role = 'HERALD' AND u.is_verified = 1`
  );
  res.json(heralds);
});

/** GET /api/users/:id — 用户公开信息 */
usersRouter.get('/:id', (req: Request, res: Response) => {
  const user = findOne<any>(
    `SELECT u.id, u.nickname, u.role, u.is_verified, u.avatar_url,
            bp.company_name, bp.industry,
            hp.display_name, hp.country, hp.diaspora_group, hp.specialties, hp.social_platforms, hp.bio
     FROM users u
     LEFT JOIN brand_profiles bp ON bp.user_id = u.id
     LEFT JOIN herald_profiles hp ON hp.user_id = u.id
     WHERE u.id = ?`, [req.params.id]
  );

  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

/** GET /api/users/me/transactions — 我的交易记录 */
usersRouter.get('/me/transactions', requireAuth, (req: Request, res: Response) => {
  const txns = findMany<any>(
    `SELECT t.*, tk.title as task_title
     FROM transactions t
     LEFT JOIN tasks tk ON tk.id = t.task_id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC`, [req.user!.userId]
  );
  res.json(txns);
});
