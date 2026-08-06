import { Router, Request, Response } from 'express';
import { findOne, findMany, update, insert } from '../utils/db';
import { requireAuth, signToken } from '../middleware/auth';
import { UpdateBrandProfileSchema, UpdateHeraldProfileSchema } from '../types';
import { ZodError } from 'zod';
import { SUPPORTED_LOCALES } from '../constants/locales';
import { translateBrand } from '../utils/translate';
import { serializeHeraldProfile } from '../utils/serialize';

export const usersRouter = Router();

/** PATCH /api/users/profile/brand — 更新品牌商家资料 */
usersRouter.patch('/profile/brand', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = UpdateBrandProfileSchema.parse(req.body);

    const existing = await findOne<any>('SELECT id, company_name, company_desc, default_lang FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    const fields: Record<string, any> = {
      company_name:  data.companyName,
      company_desc:  data.companyDesc || null,
      website:       data.website || null,
      industry:      data.industry || null,
      contact_name:  data.contactName,
      contact_phone: data.contactPhone || null,
      billing_email: data.billingEmail || null,
      ...(data.defaultLang ? { default_lang: data.defaultLang } : {}),
    };
    if (existing) {
      await update('brand_profiles', fields, 'user_id = ?', [req.user!.userId]);
    } else {
      await insert('brand_profiles', { user_id: req.user!.userId, ...fields });
    }

    const profile = await findOne('SELECT * FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    // 品牌简介/名称变更 → 异步重翻（hash 兜底，不阻塞保存）
    if (data.companyName !== undefined || data.companyDesc !== undefined) {
      translateBrand(
        req.user!.userId,
        String(data.companyName ?? existing?.company_name ?? ''),
        data.companyDesc !== undefined ? (data.companyDesc || null) : (existing?.company_desc ?? null),
        (data.defaultLang as string) || existing?.default_lang || 'zh'
      ).catch(() => {});
    }
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

/** PATCH /api/users/me — 修改昵称 / 语言偏好 */
usersRouter.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const { nickname, lang } = req.body;
  const updates: Record<string, string> = {};
  if (nickname !== undefined) {
    if (!nickname || !nickname.trim()) return res.status(400).json({ error: '昵称不能为空' });
    updates.nickname = nickname.trim();
  }
  if (lang !== undefined) {
    if (!SUPPORTED_LOCALES.has(lang)) return res.status(400).json({ error: '不支持的语言' });
    updates.preferred_lang = lang;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: '无有效字段' });
  await update('users', updates, 'id = ?', [req.user!.userId]);
  res.json({ success: true, ...updates });
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

const AGREEMENT_VERSION = '2026-07-18-v4'; // v4: 运营主体改配置占位符+服务费改'按平台公示费率'；v3: 暴排条款+退款原路退回(待法务审阅)；v2: 数据处理条款
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

  // upsert：bp 行不存在时 UPDATE 会零行生效但静默返回 success，
  // 协议同意记录（click-wrap 证据）会丢——2026-07-18 实测踩到，改为显式建行
  const existingBp = await findOne('SELECT user_id FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
  if (!existingBp) {
    await insert('brand_profiles', { user_id: req.user!.userId, ...data });
  } else {
    await update('brand_profiles', data, 'user_id = ?', [req.user!.userId]);
  }
  // 入驻完成 → 异步翻译品牌简介/名称（不阻塞响应）
  translateBrand(req.user!.userId, String(companyName), companyDesc || null, String(data.default_lang || 'zh')).catch(() => {});

  // 无论注册时走哪条路径（赫使端/邮箱直注册），onboard 完成后必须确保 users.roles 含 BRAND。
  // 此前仅依赖 add-role 端点添加角色，但向导流程跳过了 add-role，导致入驻后仍无 BRAND 角色。
  const userRow = await findOne<any>('SELECT role, roles FROM users WHERE id = ?', [req.user!.userId]);
  let currentRoles: string[] = [];
  try { currentRoles = JSON.parse(userRow?.roles || '[]'); } catch { currentRoles = [userRow?.role]; }
  if (!currentRoles.includes(userRow?.role)) currentRoles.unshift(userRow?.role);
  let token: string | undefined;
  if (!currentRoles.includes('BRAND')) {
    const newRoles = [...currentRoles, 'BRAND'];
    await update('users', { roles: JSON.stringify(newRoles) }, 'id = ?', [req.user!.userId]);
    token = signToken({ userId: req.user!.userId, role: userRow?.role, roles: newRoles });
  }

  res.json({ success: true, currency: 'JPY', agreedAt: data.agreed_at, agreedVersion: AGREEMENT_VERSION, ...(token ? { token } : {}) });
});

/** GET /api/users/heralds — 赫使列表 (公开) */
usersRouter.get('/heralds', async (_req: Request, res: Response) => {
  const heralds = await findMany<any>(
    `SELECT u.id, u.nickname, hp.display_name, hp.country, hp.diaspora_group, hp.specialties, hp.social_platforms
     FROM users u
     JOIN herald_profiles hp ON hp.user_id = u.id
     WHERE u.role = 'HERALD' AND u.is_verified = 1`
  );
  res.json(heralds.map(serializeHeraldProfile));
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
  res.json(serializeHeraldProfile(user));
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
