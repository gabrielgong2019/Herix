import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { findOne, insert, update } from '../utils/db';
import { requireAuth, signToken } from '../middleware/auth';
import { RegisterSchema, LoginSchema } from '../types';
import { ZodError } from 'zod';

export const authRouter = Router();

/** 从 users.roles 字段解析角色数组，兼容旧数据 */
function parseRoles(rolesJson: string | null, primaryRole: string): string[] {
  if (rolesJson) {
    try { return JSON.parse(rolesJson); } catch { /* fall through */ }
  }
  return [primaryRole];
}

/** POST /api/auth/register — 注册 */
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const data = RegisterSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);

    const conditions: string[] = [];
    const params: string[] = [];
    if (data.phone) { conditions.push('phone = ?'); params.push(data.phone); }
    if (data.email) { conditions.push('email = ?'); params.push(data.email); }

    if (conditions.length > 0) {
      const existing = findOne<{ id: string }>(
        `SELECT id FROM users WHERE ${conditions.join(' OR ')}`, params
      );
      if (existing) return res.status(409).json({ error: '手机号或邮箱已被注册' });
    }

    const roles = [data.role];
    const userId = insert('users', {
      phone: data.phone || null,
      email: data.email || null,
      password_hash: passwordHash,
      nickname: data.nickname || data.phone || data.email?.split('@')[0] || '用户',
      role: data.role,
      roles: JSON.stringify(roles),
    });

    if (data.role === 'BRAND') {
      insert('brand_profiles', { user_id: userId, company_name: '', contact_name: data.nickname || '' });
    } else if (data.role === 'HERALD') {
      insert('herald_profiles', { user_id: userId, display_name: data.nickname || '赫使' });
    }

    const user = findOne<any>(
      `SELECT u.id, u.nickname, u.role, u.roles, u.is_verified,
              COALESCE(hp.is_onboarded, bp.is_onboarded, 0) as is_onboarded
       FROM users u
       LEFT JOIN herald_profiles hp ON hp.user_id = u.id
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       WHERE u.id = ?`, [userId]
    );

    const userRoles = parseRoles(user!.roles, user!.role);
    const token = signToken({ userId: user!.id, role: user!.role, roles: userRoles });

    res.status(201).json({
      token,
      user: {
        id: user!.id, nickname: user!.nickname, role: user!.role,
        roles: userRoles, isVerified: !!user!.is_verified, is_onboarded: !!user!.is_onboarded,
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: '参数错误', details: err.errors });
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

/** POST /api/auth/login — 登录 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { account, password } = LoginSchema.parse(req.body);

    const user = findOne<any>(
      'SELECT id, password_hash, nickname, role, roles, is_verified FROM users WHERE phone = ? OR email = ?',
      [account, account]
    );
    if (!user) return res.status(401).json({ error: '账号或密码错误' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '账号或密码错误' });

    const userRoles = parseRoles(user.roles, user.role);

    // 旧账号补填 roles
    if (!user.roles) {
      update('users', { roles: JSON.stringify(userRoles) }, 'id = ?', [user.id]);
    }

    const profile = findOne<any>(
      `SELECT COALESCE(hp.is_onboarded, bp.is_onboarded, 0) as is_onboarded
       FROM users u
       LEFT JOIN herald_profiles hp ON hp.user_id = u.id
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       WHERE u.id = ?`, [user.id]
    );

    const token = signToken({ userId: user.id, role: user.role, roles: userRoles });

    res.json({
      token,
      user: {
        id: user.id, nickname: user.nickname, role: user.role,
        roles: userRoles, isVerified: !!user.is_verified, is_onboarded: !!(profile?.is_onboarded),
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: '参数错误', details: err.errors });
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

/** GET /api/auth/me — 当前用户信息 */
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = findOne<any>(
    `SELECT u.id, u.phone, u.email, u.nickname, u.avatar_url, u.role, u.roles, u.is_verified, u.created_at,
            bp.company_name, bp.industry, bp.contact_name, bp.is_onboarded as brand_onboarded,
            hp.display_name, hp.country, hp.diaspora_group, hp.social_platforms, hp.specialties,
            hp.is_onboarded, hp.residence, hp.residence_country, hp.kyc_status,
            hp.declaration_status, hp.visa_type, hp.bank_account
     FROM users u
     LEFT JOIN brand_profiles bp ON bp.user_id = u.id
     LEFT JOIN herald_profiles hp ON hp.user_id = u.id
     WHERE u.id = ?`,
    [req.user!.userId]
  );
  if (!user) return res.status(404).json({ error: '用户不存在' });

  user.roles = parseRoles(user.roles, user.role);
  res.json(user);
});
