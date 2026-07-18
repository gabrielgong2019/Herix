import { Router, Request, Response } from 'express';
import { findOne, findMany, update, insert } from '../utils/db';
import { requireAuth, signToken } from '../middleware/auth';
import { UpdateBrandProfileSchema, UpdateHeraldProfileSchema } from '../types';
import { ZodError } from 'zod';

export const usersRouter = Router();

/** PATCH /api/users/profile/brand — 更新品牌商家资料 */
usersRouter.patch('/profile/brand', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = UpdateBrandProfileSchema.parse(req.body);

    const existing = await findOne<{ id: string }>('SELECT id FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    if (existing) {
      await update('brand_profiles', {
        company_name: data.companyName,
        company_desc: data.companyDesc || null,
        website: data.website || null,
        industry: data.industry || null,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
        billing_email: data.billingEmail || null,
      }, 'user_id = ?', [req.user!.userId]);
    } else {
      await insert('brand_profiles', {
        user_id: req.user!.userId,
        company_name: data.companyName,
        company_desc: data.companyDesc || null,
        website: data.website || null,
        industry: data.industry || null,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
        billing_email: data.billingEmail || null,
      });
    }

    const profile = await findOne('SELECT * FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
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
usersRouter.patch('/profile/herald', requireAuth, async (req: Request, res: Response) => {
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

    const existing = await findOne<{ id: string }>('SELECT id FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
    if (existing) {
      await update('herald_profiles', profileData, 'user_id = ?', [req.user!.userId]);
    } else {
      await insert('herald_profiles', { user_id: req.user!.userId, ...profileData });
    }

    const profile = await findOne('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
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
usersRouter.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const { nickname } = req.body;
  if (!nickname || !nickname.trim()) return res.status(400).json({ error: '昵称不能为空' });
  await update('users', { nickname: nickname.trim() }, 'id = ?', [req.user!.userId]);
  res.json({ success: true, nickname: nickname.trim() });
});

/** POST /api/users/add-role — 添加第二个角色 */
usersRouter.post('/add-role', requireAuth, async (req: Request, res: Response) => {
  const { role } = req.body as { role: 'HERALD' | 'BRAND' };
  if (!['HERALD', 'BRAND'].includes(role)) {
    return res.status(400).json({ error: '角色只能是 HERALD 或 BRAND' });
  }

  const user = await findOne<any>('SELECT id, role, roles, nickname FROM users WHERE id = ?', [req.user!.userId]);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  let currentRoles: string[] = [];
  try { currentRoles = JSON.parse(user.roles || '[]'); } catch { currentRoles = [user.role]; }
  if (!currentRoles.includes(user.role)) currentRoles.unshift(user.role);

  if (currentRoles.includes(role)) {
    return res.status(409).json({ error: `已拥有 ${role} 角色` });
  }

  // 创建对应档案
  if (role === 'BRAND') {
    const existing = await findOne('SELECT id FROM brand_profiles WHERE user_id = ?', [user.id]);
    if (!existing) await insert('brand_profiles', { user_id: user.id, company_name: '', contact_name: user.nickname || '' });
  } else {
    const existing = await findOne('SELECT id FROM herald_profiles WHERE user_id = ?', [user.id]);
    if (!existing) await insert('herald_profiles', { user_id: user.id, display_name: user.nickname || '赫使' });
  }

  const newRoles = [...currentRoles, role];
  await update('users', { roles: JSON.stringify(newRoles) }, 'id = ?', [user.id]);

  // 返回新 token（含更新后的 roles）
  const token = signToken({ userId: user.id, role: user.role, roles: newRoles });
  res.json({ success: true, roles: newRoles, token });
});

const AGREEMENT_VERSION = '2026-07-18-v3'; // v3: 新增第七条反社会势力排除+退款限原路退回(待法务审阅)；v2: 第五条数据处理(委托)条款
// ⚠️ 改版本号时三处同步：本常量 + merchant.agreement.docTitle + merchant.agreement.version 词条
//（签约证据完整性：落库的 agreed_version 必须与商家看到的协议标题/页脚一致，2026-07-18 曾出现不一致）

/** POST /api/users/brand/onboard — 品牌入驻 */
usersRouter.post('/brand/onboard', requireAuth, async (req: Request, res: Response) => {
  const { companyName, industry, companyDesc, website, contactName, contactPhone, billingEmail, agreedToTerms, country, isAgency } = req.body;
  if (!companyName || !contactName) {
    return res.status(400).json({ error: '公司名称和联系人姓名为必填项' });
  }
  if (!agreedToTerms) {
    return res.status(400).json({ error: '请阅读并同意服务协议后继续' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();

  const data: Record<string, any> = {
    company_name: companyName,
    // 商家归属国（转出实体，打款费率的 from 端；V1 默认日本）
    country: ['JP', 'CN'].includes(String(country || '').toUpperCase()) ? String(country).toUpperCase() : 'JP',
    industry: industry || null,
    company_desc: companyDesc || null,
    website: website || null,
    contact_name: contactName,
    contact_phone: contactPhone || null,
    billing_email: billingEmail || null,
    is_onboarded: 1,
    agreed_at: new Date().toISOString(),
    agreed_ip: clientIp,
    agreed_version: AGREEMENT_VERSION,
  };
  // 入驻向导新增的自助选择入口（2026-07-18）：is_agency 字段本身早已存在，
  // 此前只有 admin 后台手动开通一条路径（见 admin.ts agency 端点）；
  // 这里只在用户勾选时写 true，不覆盖 admin 已经手动关闭的情况为 false
  if (isAgency === true) data.is_agency = true;

  await update('brand_profiles', data, 'user_id = ?', [req.user!.userId]);
  res.json({ success: true, currency: 'JPY', agreedAt: data.agreed_at, agreedVersion: AGREEMENT_VERSION });
});

/** GET /api/users/heralds — 赫使列表 (公开) */
usersRouter.get('/heralds', async (_req: Request, res: Response) => {
  const heralds = await findMany<any>(
    `SELECT u.id, u.nickname, hp.display_name, hp.country, hp.diaspora_group, hp.specialties, hp.social_platforms
     FROM users u
     JOIN herald_profiles hp ON hp.user_id = u.id
     WHERE u.role = 'HERALD' AND u.is_verified = 1`
  );
  res.json(heralds);
});

/** GET /api/users/:id — 用户公开信息 */
usersRouter.get('/:id', async (req: Request, res: Response) => {
  const user = await findOne<any>(
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
usersRouter.get('/me/transactions', requireAuth, async (req: Request, res: Response) => {
  const txns = await findMany<any>(
    `SELECT t.*, tk.title as task_title
     FROM transactions t
     LEFT JOIN tasks tk ON tk.id = t.task_id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC`, [req.user!.userId]
  );
  res.json(txns);
});
