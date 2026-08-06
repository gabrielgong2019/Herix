import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { findOne, insert, update } from '../utils/db';
import { requireAuth, signToken } from '../middleware/auth';
import { RegisterSchema, LoginSchema } from '../types';
import { ZodError } from 'zod';
import { getEffectiveCommissionRate } from '../utils/settings';
import { sendMail } from '../utils/mailer';
import crypto from 'crypto';
import { serializeHeraldProfile } from '../utils/serialize';

export const authRouter = Router();

/** POST /api/auth/send-code — 发送邮箱验证码（REGISTER 注册 / BIND_EMAIL 微信用户绑定邮箱）。
 *  限频：同邮箱 60 秒一次、每小时 5 次 */
authRouter.post('/send-code', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const purpose = String(req.body?.purpose || 'REGISTER');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确', code: 'INVALID_EMAIL' });
  }
  if (!['REGISTER', 'BIND_EMAIL'].includes(purpose)) {
    return res.status(400).json({ error: '不支持的验证码用途', code: 'INVALID_PURPOSE' });
  }
  const taken = await findOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  if (taken) return res.status(409).json({ error: '该邮箱已被注册', code: 'ACCOUNT_TAKEN' });

  // 限频（防轰炸他人邮箱 + 防刷发信配额）
  const last = await findOne<any>(
    `SELECT created_at FROM verification_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  if (last && Date.now() - new Date(last.created_at).getTime() < 60_000) {
    return res.status(429).json({ error: '发送太频繁，请 1 分钟后再试', code: 'CODE_TOO_FREQUENT' });
  }
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const cnt = await findOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM verification_codes WHERE email = ? AND purpose = ? AND created_at > ?`,
    [email, purpose, hourAgo]
  );
  if ((cnt?.n || 0) >= 5) {
    return res.status(429).json({ error: '发送次数已达上限，请 1 小时后再试', code: 'CODE_HOURLY_LIMIT' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await insert('verification_codes', {
    email, purpose, code,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  });
  try {
    await sendMail(
      email,
      '【Herix】注册验证码',
      `你的 Herix 注册验证码是：${code}\n30 分钟内有效。如非本人操作，请忽略此邮件。\n\nYour Herix verification code is ${code} (valid for 30 minutes).`
    );
  } catch (err) {
    console.error('[send-code] MAIL SEND FAILED', err);
    return res.status(502).json({ error: '邮件发送失败，请稍后重试或联系平台', code: 'MAIL_SEND_FAILED' });
  }
  res.json({ sent: true });
});

/** 校验并消费验证码（按用途）。通过返回 null，否则返回错误响应参数 */
async function consumeCode(email: string, code: string, purpose: string): Promise<{ status: number; error: string; code: string } | null> {
  const rec = await findOne<any>(
    `SELECT id, code, expires_at, attempts FROM verification_codes
     WHERE email = ? AND purpose = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  if (!rec) return { status: 400, error: '请先获取邮箱验证码', code: 'CODE_REQUIRED' };
  if (new Date(rec.expires_at).getTime() < Date.now() || Number(rec.attempts) >= 5) {
    return { status: 400, error: '验证码已过期，请重新获取', code: 'CODE_EXPIRED' };
  }
  if (rec.code !== code) {
    await update('verification_codes', { attempts: Number(rec.attempts) + 1 }, 'id = ?', [rec.id]);
    return { status: 400, error: '验证码错误', code: 'CODE_INVALID' };
  }
  await update('verification_codes', { used_at: new Date().toISOString() }, 'id = ?', [rec.id]);
  return null;
}

/** 从 users.roles 字段解析角色数组，兼容旧数据 */
function parseRoles(rolesJson: string | null, primaryRole: string): string[] {
  if (rolesJson) {
    try { return JSON.parse(rolesJson); } catch { /* fall through */ }
  }
  return [primaryRole];
}

/** 按用户 id 出一套登录响应（token + user），微信登录/注册/绑定复用 */
async function issueLogin(userId: string) {
  const user = await findOne<any>(
    `SELECT u.id, u.email, u.nickname, u.role, u.roles, u.is_verified,
            COALESCE(hp.is_onboarded, bp.is_onboarded, 0) as is_onboarded,
            bp.is_onboarded as brand_onboarded
     FROM users u
     LEFT JOIN herald_profiles hp ON hp.user_id = u.id
     LEFT JOIN brand_profiles bp ON bp.user_id = u.id
     WHERE u.id = ?`, [userId]
  );
  if (!user) return null;
  const userRoles = parseRoles(user.roles, user.role);
  const token = signToken({ userId: user.id, role: user.role, roles: userRoles });
  return {
    token,
    user: {
      id: user.id, nickname: user.nickname, role: user.role,
      roles: userRoles, isVerified: !!user.is_verified, is_onboarded: !!user.is_onboarded,
      // 品牌入驻完成标记（2026-07-18）：merchant.html 登录后据此决定是否进入驻向导；
      // 旧的合并 is_onboarded 是 herald 优先的 COALESCE，双角色账号下不可用
      brand_onboarded: !!user.brand_onboarded,
      email: user.email || null,
    },
  };
}

/** 从云托管注入的请求头取可信 openid。
 *  安全模型：X-WX-OPENID 由微信云托管在链路内注入并覆盖客户端伪造；但我们的公网 ECS 可被直连，
 *  所以云托管代理转发时须附共享密钥头 X-Proxy-Auth，服务端配 WX_PROXY_SECRET 后才信任 openid。
 *  未配置密钥 = 开发模式放行（生产必须配置——见 CLAUDE.md 部署节） */
function weappOpenId(req: Request): string | null {
  const openid = String(req.headers['x-wx-openid'] || '').trim();
  if (!openid) return null;
  const secret = process.env.WX_PROXY_SECRET;
  if (secret && String(req.headers['x-proxy-auth'] || '') !== secret) return null;
  return openid;
}

/** POST /api/auth/wechat-login — 小程序静默登录：openid 已有账号直接发 token，没有则让前端走注册/绑定选择 */
authRouter.post('/wechat-login', async (req: Request, res: Response) => {
  const openid = weappOpenId(req);
  if (!openid) return res.status(400).json({ error: '缺少微信身份，请在小程序内使用', code: 'NOT_WEAPP' });
  const user = await findOne<{ id: string }>('SELECT id FROM users WHERE wechat_open_id = ?', [openid]);
  if (!user) return res.json({ needRegister: true });
  const payload = await issueLogin(user.id);
  res.json(payload);
});

/** POST /api/auth/wechat-register — 微信一键注册（无邮箱密码，password_hash 占位不可密码登录，绑定邮箱后可设） */
authRouter.post('/wechat-register', async (req: Request, res: Response) => {
  const openid = weappOpenId(req);
  if (!openid) return res.status(400).json({ error: '缺少微信身份，请在小程序内使用', code: 'NOT_WEAPP' });
  const existing = await findOne<{ id: string }>('SELECT id FROM users WHERE wechat_open_id = ?', [openid]);
  if (existing) return res.json(await issueLogin(existing.id)); // 幂等：已注册直接登录
  const nickname = String(req.body?.nickname || '').trim() || '微信用户';
  const userId = await insert('users', {
    wechat_open_id: openid,
    password_hash: '!',
    nickname,
    role: 'HERALD',
    roles: JSON.stringify(['HERALD']),
  });
  await insert('herald_profiles', { user_id: userId, display_name: nickname });
  console.log(`[wechat-register] user=${userId}`);
  res.status(201).json(await issueLogin(userId));
});

/** POST /api/auth/bind-wechat — 已有邮箱账号在小程序里登录并挂上 openid，此后双端同一账号 */
authRouter.post('/bind-wechat', async (req: Request, res: Response) => {
  const openid = weappOpenId(req);
  if (!openid) return res.status(400).json({ error: '缺少微信身份，请在小程序内使用', code: 'NOT_WEAPP' });
  const { account, password } = req.body as { account?: string; password?: string };
  if (!account || !password) return res.status(400).json({ error: '请填写账号和密码', code: 'INVALID_PARAMS' });

  const user = await findOne<any>(
    'SELECT id, password_hash, wechat_open_id FROM users WHERE phone = ? OR LOWER(email) = LOWER(?)', [account, account]
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: '账号或密码错误', code: 'BAD_CREDENTIALS' });
  }
  if (user.wechat_open_id && user.wechat_open_id !== openid) {
    return res.status(409).json({ error: '该账号已绑定其他微信', code: 'WECHAT_ALREADY_BOUND' });
  }
  const taken = await findOne<{ id: string }>('SELECT id FROM users WHERE wechat_open_id = ? AND id <> ?', [openid, user.id]);
  if (taken) return res.status(409).json({ error: '当前微信已绑定其他账号', code: 'OPENID_TAKEN' });
  if (!user.wechat_open_id) {
    await update('users', { wechat_open_id: openid }, 'id = ?', [user.id]);
    console.log(`[bind-wechat] user=${user.id}`);
  }
  res.json(await issueLogin(user.id));
});

/** POST /api/auth/bind-email — 微信注册用户补绑邮箱+密码（验证码验证所有权），绑定后可用 H5 邮箱登录并接收邮件通知 */
authRouter.post('/bind-email', requireAuth, async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确', code: 'INVALID_EMAIL' });
  }
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位', code: 'INVALID_PARAMS' });
  if (!code) return res.status(400).json({ error: '请输入邮箱验证码', code: 'CODE_REQUIRED' });

  const me = await findOne<any>('SELECT id, email FROM users WHERE id = ?', [req.user!.userId]);
  if (me?.email) return res.status(409).json({ error: '账号已绑定邮箱', code: 'EMAIL_ALREADY_SET' });
  const taken = await findOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  if (taken) return res.status(409).json({ error: '该邮箱已被注册', code: 'ACCOUNT_TAKEN' });

  const fail = await consumeCode(email, code, 'BIND_EMAIL');
  if (fail) return res.status(fail.status).json({ error: fail.error, code: fail.code });

  await update('users', { email, password_hash: await bcrypt.hash(password, 10) }, 'id = ?', [req.user!.userId]);
  console.log(`[bind-email] user=${req.user!.userId}`);
  res.json({ bound: true, email });
});

/** POST /api/auth/send-set-password-code — 给已登录用户自己的邮箱发验证码，用于修改/设置密码（requireAuth）
 *  与 send-code 的区别：不检查"邮箱是否被占用"（邮箱就是自己的） */
authRouter.post('/send-set-password-code', requireAuth, async (req: Request, res: Response) => {
  const me = await findOne<{ email: string | null }>('SELECT email FROM users WHERE id = ?', [req.user!.userId]);
  if (!me?.email) return res.status(400).json({ error: '请先绑定邮箱', code: 'NO_EMAIL' });

  const email = me.email;
  const purpose = 'SET_PASSWORD';

  const last = await findOne<any>(
    `SELECT created_at FROM verification_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  if (last && Date.now() - new Date(last.created_at).getTime() < 60_000) {
    return res.status(429).json({ error: '发送太频繁，请 1 分钟后再试', code: 'CODE_TOO_FREQUENT' });
  }
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const cnt = await findOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM verification_codes WHERE email = ? AND purpose = ? AND created_at > ?`,
    [email, purpose, hourAgo]
  );
  if ((cnt?.n || 0) >= 5) {
    return res.status(429).json({ error: '发送次数已达上限，请 1 小时后再试', code: 'CODE_HOURLY_LIMIT' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await insert('verification_codes', {
    email, purpose, code,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  });
  await sendMail(
    email,
    '【Herix】修改密码验证码',
    `你的 Herix 修改密码验证码是：${code}\n30 分钟内有效。如非本人操作，请忽略此邮件。\n\nYour Herix password verification code is ${code} (valid for 30 minutes).`
  );
  res.json({ sent: true });
});

/** POST /api/auth/change-password — 修改密码，requireAuth。
 *  两种方式：① { newPassword, code } OTP 方式（微信注册用户无原密码时使用）
 *           ② { newPassword, oldPassword } 原密码方式（有密码的老用户） */
authRouter.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const newPassword = String(req.body?.newPassword || '');
  const code = req.body?.code ? String(req.body.code).trim() : '';
  const oldPassword = req.body?.oldPassword ? String(req.body.oldPassword) : '';

  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位', code: 'INVALID_PARAMS' });
  if (!code && !oldPassword) return res.status(400).json({ error: '请提供验证码或原密码', code: 'INVALID_PARAMS' });

  const user = await findOne<{ email: string | null; password_hash: string }>(
    'SELECT email, password_hash FROM users WHERE id = ?', [req.user!.userId]
  );
  if (!user) return res.status(404).json({ error: '用户不存在', code: 'USER_NOT_FOUND' });

  if (code) {
    if (!user.email) return res.status(400).json({ error: '请先绑定邮箱', code: 'NO_EMAIL' });
    const fail = await consumeCode(user.email, code, 'SET_PASSWORD');
    if (fail) return res.status(fail.status).json({ error: fail.error, code: fail.code });
  } else {
    if (user.password_hash === '!') {
      return res.status(400).json({ error: '请使用邮箱验证码方式修改密码', code: 'USE_OTP_INSTEAD' });
    }
    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: '原密码错误', code: 'BAD_CREDENTIALS' });
  }

  await update('users', { password_hash: await bcrypt.hash(newPassword, 10) }, 'id = ?', [req.user!.userId]);
  console.log(`[change-password] user=${req.user!.userId} method=${code ? 'otp' : 'old-password'}`);
  res.json({ changed: true });
});

/** POST /api/auth/register — 注册 */
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const data = RegisterSchema.parse(req.body);

    // 邮箱注册须通过验证码验证邮箱所有权（2026-07-17；否则通知/对账/找回全不可靠）
    if (data.email) {
      const vcode = String((req.body as any).code || '').trim();
      if (!vcode) return res.status(400).json({ error: '请输入邮箱验证码', code: 'CODE_REQUIRED' });
      const fail = await consumeCode(data.email.trim().toLowerCase(), vcode, 'REGISTER');
      if (fail) return res.status(fail.status).json({ error: fail.error, code: fail.code });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const conditions: string[] = [];
    const params: string[] = [];
    if (data.phone) { conditions.push('phone = ?'); params.push(data.phone); }
    if (data.email) { conditions.push('LOWER(email) = LOWER(?)'); params.push(data.email); }

    if (conditions.length > 0) {
      const existing = await findOne<{ id: string }>(
        `SELECT id FROM users WHERE ${conditions.join(' OR ')}`, params
      );
      if (existing) return res.status(409).json({ error: '手机号或邮箱已被注册', code: 'ACCOUNT_TAKEN' });
    }

    const roles = [data.role];
    const userId = await insert('users', {
      phone: data.phone || null,
      email: data.email ? data.email.trim().toLowerCase() : null,  // 邮箱统一存小写（2026-07-17：大小写不一致曾致登录对不上）
      password_hash: passwordHash,
      nickname: data.nickname || data.phone || data.email?.split('@')[0] || '用户',
      role: data.role,
      roles: JSON.stringify(roles),
    });

    if (data.role === 'BRAND') {
      await insert('brand_profiles', { user_id: userId, company_name: '', contact_name: data.nickname || '' });
    } else if (data.role === 'HERALD') {
      await insert('herald_profiles', { user_id: userId, display_name: data.nickname || '赫使' });
    }

    const user = await findOne<any>(
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
    if (err instanceof ZodError) return res.status(400).json({ error: '参数错误', code: 'INVALID_PARAMS', details: err.errors });
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败', code: 'REGISTER_FAILED' });
  }
});

/** POST /api/auth/login — 登录 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { account, password } = LoginSchema.parse(req.body);

    const user = await findOne<any>(
      'SELECT id, password_hash, nickname, role, roles, is_verified FROM users WHERE phone = ? OR LOWER(email) = LOWER(?)',
      [account, account]
    );
    if (!user) return res.status(401).json({ error: '账号或密码错误', code: 'BAD_CREDENTIALS' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '账号或密码错误', code: 'BAD_CREDENTIALS' });

    const userRoles = parseRoles(user.roles, user.role);

    // 旧账号补填 roles
    if (!user.roles) {
      await update('users', { roles: JSON.stringify(userRoles) }, 'id = ?', [user.id]);
    }

    // 响应统一走 issueLogin：此前这里手拼响应、漏了 brand_onboarded 字段，
    // 导致 merchant.html 登录后 !brand_onboarded 恒为真——已入驻商家每次登录都被赶进向导
    //（2026-07-18 用户实测：向导完成后二次登录仍进向导）
    res.json(await issueLogin(user.id));
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: '参数错误', code: 'INVALID_PARAMS', details: err.errors });
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败', code: 'LOGIN_FAILED' });
  }
});

/** GET /api/auth/me — 当前用户信息 */
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await findOne<any>(
    `SELECT u.id, u.phone, u.email, u.nickname, u.avatar_url, u.role, u.roles, u.is_verified, u.created_at,
            bp.company_name, bp.industry, bp.contact_name, bp.is_onboarded as brand_onboarded,
            bp.website, bp.company_desc, bp.contact_phone, bp.is_agency, bp.country as brand_country,
            bp.kyb_status, bp.kyb_note,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url, bp.billing_email as brand_billing_email,
            bp.default_lang,
            hp.display_name, hp.country, hp.diaspora_group, hp.social_platforms, hp.specialties,
            hp.is_onboarded, hp.residence, hp.residence_country, hp.community, hp.kyc_status,
            hp.declaration_status, hp.visa_type, hp.bank_account,
            hp.tier_snapshot, hp.social_platforms_updated_at
     FROM users u
     LEFT JOIN brand_profiles bp ON bp.user_id = u.id
     LEFT JOIN herald_profiles hp ON hp.user_id = u.id
     WHERE u.id = ?`,
    [req.user!.userId]
  );
  if (!user) return res.status(404).json({ error: '用户不存在' });

  user.roles = parseRoles(user.roles, user.role);
  serializeHeraldProfile(user);

  // 赫使评级摘要（实时计算）
  if (user.roles?.includes('HERALD')) {
    const ratingRow = await findOne<any>(
      `SELECT
         COUNT(DISTINCT ts.id) AS completed_tasks,
         COUNT(tr.id) AS rated_count,
         SUM(CASE WHEN tr.score >= 4 THEN 1 ELSE 0 END) AS good_count
       FROM task_submissions ts
       LEFT JOIN task_ratings tr ON tr.task_id = ts.task_id AND tr.herald_id = ts.herald_id
       WHERE ts.herald_id = ? AND ts.status = 'APPROVED'`,
      [req.user!.userId]
    );
    const completedTasks = Number(ratingRow?.completed_tasks || 0);
    const ratedCount = Number(ratingRow?.rated_count || 0);
    const goodCount = Number(ratingRow?.good_count || 0);
    const goodRate = ratedCount > 0 ? Math.round((goodCount / ratedCount) * 100) / 100 : 0;
    user.rating = { completedTasks, ratedCount, goodRate };
  }

  if (user.roles?.includes('BRAND')) {
    const { rate } = await getEffectiveCommissionRate(req.user!.userId);
    user.commission_rate = rate;
  }

  // 若 DB 中的 roles 与 JWT 里的 roles 不一致（常见于向导流程漏加角色），
  // 随 /me 响应附带修复后的 token，前端收到后静默替换 localStorage，下次请求即生效。
  const jwtRoles: string[] = req.user!.roles || [req.user!.role];
  const dbRoles: string[] = user.roles || [];
  const rolesOutOfSync = dbRoles.some((r: string) => !jwtRoles.includes(r));
  if (rolesOutOfSync) {
    user._refreshedToken = signToken({ userId: user.id, role: user.role, roles: dbRoles });
  }

  res.json(user);
});
