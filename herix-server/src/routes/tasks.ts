import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth';
import { CreateTaskSchema } from '../types';
import { ZodError } from 'zod';
import crypto from 'crypto';
import { settleCreditTask, creditHerald, creditPlatformFee, getBalance, PLATFORM_USER_ID } from '../utils/wallet';
import { createNotification } from './notifications';
import { notify } from '../utils/notify';
import { isWechatConfigured, generateUrlLink, getUnlimitedQRCode } from '../utils/wechat';
import { hashUserKey, maskUserKey } from '../utils/privacy';
import { getBrandCreditInfo, getSetting, getEffectiveCommissionRate } from '../utils/settings';
import pool from '../db';

function genCode(): string {
  return 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function generateCodePool(taskId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    let code = genCode();
    while (await findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code])) {
      code = genCode();
    }
    await insert('task_promo_codes', { task_id: taskId, code });
  }
}

export const tasksRouter = Router();

/** GET /api/tasks — 获取任务列表（已登录用户可见自己所有状态，未登录只见 OPEN） */
tasksRouter.get('/', optionalAuth, async (req: Request, res: Response) => {
  const { status, mode, creator, page = '1', limit = '20' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params: any[] = [];

  if (status) { where += ' AND t.status = ?'; params.push(status); }
  if (mode) { where += ' AND t.mode = ?'; params.push(mode); }
  if (creator) { where += ' AND t.creator_id = ?'; params.push(creator); }
  // 非创建者只看已发布（OPEN）任务；INVITE 任务不出现在公开列表
  const uid = req.user?.userId;
  if (!uid) {
    where += " AND t.status = 'OPEN' AND t.visibility = 'PUBLIC'";
  } else if (creator) {
    // 商家查自己的任务：显示全部状态和 visibility
    if (creator !== uid) {
      where += " AND t.visibility = 'PUBLIC'"; // 不能看别人的 INVITE 任务
    }
  } else {
    // 赫使浏览探索列表：只显示 OPEN 且 PUBLIC
    where += " AND t.status = 'OPEN' AND t.visibility = 'PUBLIC'";
  }

  const totalRow = await findOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM tasks t WHERE ${where}`, params
  );

  const total = totalRow?.cnt || 0;

  const tasks = await findMany<any>(
    `SELECT t.*, u.nickname as creator_name,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url,
            (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id = t.id) as application_count,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*)::int FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count
     FROM tasks t
     JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     WHERE ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), skip]
  );

  res.json({
    tasks,
    pagination: {
      page: Number(page), limit: Number(limit), total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

/** GET /api/tasks/my/stats — 我的任务数据（已登录即可，creator 过滤保证只看自己的） */
tasksRouter.get('/my/stats', requireAuth, async (req: Request, res: Response) => {
  const uid = req.user!.userId;

  const tasks = await findMany<any>(`
    SELECT t.id, t.title, t.mode, t.status, t.commission, t.max_heralds, t.created_at, t.data_mode, t.brand_party_id,
      (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id=t.id) as app_total,
      (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id=t.id AND ta.status='APPROVED') as app_approved,
      (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id=t.id AND ta.status='PENDING') as app_pending,
      (SELECT COUNT(*)::int FROM task_submissions ts WHERE ts.task_id=t.id) as sub_total,
      (SELECT COUNT(*)::int FROM task_submissions ts WHERE ts.task_id=t.id AND ts.status='APPROVED') as sub_approved,
      (SELECT COUNT(*)::int FROM task_submissions ts WHERE ts.task_id=t.id AND ts.status='PENDING_REVIEW') as sub_pending,
      (SELECT COUNT(*)::int FROM ambassador_tasks at WHERE at.task_id=t.id) as code_holders,
      -- 旧 referrals 死表已删（2026-07-17），计数改读 ambassador_tasks 聚合列（汇总/明细两模式的统一投影）
      (SELECT COALESCE(SUM(at.used_count),0)::int FROM ambassador_tasks at WHERE at.task_id=t.id) as qualified_referrals,
      (SELECT COALESCE(SUM(at.registered_count),0)::int FROM ambassador_tasks at WHERE at.task_id=t.id) as total_referrals
    FROM tasks t WHERE t.creator_id=? ORDER BY t.created_at DESC
  `, [uid]);

  const summary = {
    totalTasks: tasks.length,
    openTasks:  tasks.filter((t: any) => t.status === 'OPEN').length,
    draftTasks: tasks.filter((t: any) => t.status === 'DRAFT').length,
    totalApplicants: tasks.reduce((s: number, t: any) => s + (t.app_total || 0), 0),
    pendingApplicants: tasks.reduce((s: number, t: any) => s + (t.app_pending || 0), 0),
    pendingSubmissions: tasks.reduce((s: number, t: any) => s + (t.sub_pending || 0), 0),
    totalCompleted: tasks.reduce((s: number, t: any) => s + (t.sub_approved || 0), 0),
    totalSpend: tasks.reduce((s: number, t: any) => s + (t.sub_approved || 0) * t.commission, 0),
    pendingSpend: tasks.reduce((s: number, t: any) => s + (t.sub_pending || 0) * t.commission, 0),
    qualifiedReferrals: tasks.reduce((s: number, t: any) => s + (t.qualified_referrals || 0), 0),
  };

  res.json({ summary, tasks });
});

/** GET /api/tasks/:id — 任务详情 (公开) */
tasksRouter.get('/:id/codes', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });

  const all = await findMany<any>(
    'SELECT code, herald_id, assigned_at FROM task_promo_codes WHERE task_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({
    total: all.length,
    assigned: all.filter((c: any) => c.herald_id).length,
    available: all.filter((c: any) => !c.herald_id).length,
    samples: all.slice(0, 5).map((c: any) => c.code),
  });
});

/** GET /api/tasks/:id/codes/export — 下载推广码 CSV（商家用） */
tasksRouter.get('/:id/codes/export', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, title, creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }

  const codes = await findMany<any>(`
    SELECT
      pc.code as unique_code,
      pc.assigned_at,
      CASE WHEN pc.herald_id IS NULL THEN 'available' ELSE 'assigned' END as status,
      u.nickname as herald_name,
      u.email as herald_email,
      hp.country, hp.residence,
      COALESCE((SELECT at.used_count FROM ambassador_tasks at WHERE at.unique_code = pc.code), 0) as qualified_count,
      COALESCE((SELECT at.registered_count FROM ambassador_tasks at WHERE at.unique_code = pc.code), 0) as total_referrals
    FROM task_promo_codes pc
    LEFT JOIN users u ON u.id = pc.herald_id
    LEFT JOIN herald_profiles hp ON hp.user_id = pc.herald_id
    WHERE pc.task_id = ?
    ORDER BY pc.created_at ASC
  `, [req.params.id]);

  const header = 'promo_code,status,herald_name,herald_email,country,residence,assigned_at,total_referrals,qualified_count';
  const rows = codes.map((c: any) =>
    [c.unique_code, c.status, c.herald_name || '', c.herald_email || '',
     c.country || '', c.residence || '', c.assigned_at?.slice(0, 10) || '',
     c.total_referrals, c.qualified_count].join(',')
  );

  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="herix_codes_${req.params.id.slice(0,8)}.csv"`);
  res.send('﻿' + csv); // BOM for Excel compatibility
});

/** POST /api/tasks/:id/codes/upload — 商家上传自定义推广码 */
tasksRouter.post('/:id/codes/upload', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, mode, code_mode, max_heralds FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '仅成果报酬任务支持推广码' });

  const { codes } = req.body as { codes: string[] };
  if (!Array.isArray(codes) || codes.length === 0) return res.status(400).json({ error: 'codes 数组不能为空' });

  const cleaned = [...new Set(codes.map((c: string) => c.trim()).filter(Boolean))];
  if (cleaned.length > task.max_heralds) {
    return res.status(400).json({ error: `推广码数量（${cleaned.length}）超过任务名额（${task.max_heralds}）` });
  }

  let added = 0, skipped = 0;
  for (const code of cleaned) {
    const exists = await findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code]);
    if (exists) { skipped++; continue; }
    await insert('task_promo_codes', { task_id: task.id, code });
    added++;
  }

  res.json({ added, skipped, total: cleaned.length, maxHeralds: task.max_heralds });
});

/** GET /api/tasks/:id/upload-info — 品牌上传页用，token 鉴权，返回任务基本信息 */
tasksRouter.get('/:id/upload-info', async (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(401).json({ error: '缺少 token' });
  const task = await findOne<any>(
    'SELECT id, title, mode, status, upload_token, max_heralds, data_mode FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task || task.upload_token !== token) return res.status(403).json({ error: '链接无效或已过期' });
  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '该任务不支持数据上传' });
  const codes = await findMany<any>(
    'SELECT at.unique_code as code, at.registered_count, at.used_count, at.paid_conversions, u.nickname as herald_name FROM ambassador_tasks at JOIN users u ON u.id=at.herald_id WHERE at.task_id=?',
    [task.id]
  );
  res.json({ id: task.id, title: task.title, status: task.status, maxHeralds: task.max_heralds, dataMode: task.data_mode || 'AGGREGATE', codes });
});

/** GET /api/tasks/:id/weapp-link — 小程序 URL Link（30天有效，DB 缓存自动续期）。
 *  未配置微信凭据/小程序未发布 → available:false 优雅降级，前端显示占位。 */
tasksRouter.get('/:id/weapp-link', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>(
    'SELECT id, creator_id, status, weapp_link, weapp_link_expires FROM tasks WHERE id = ?', [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限', code: 'FORBIDDEN' });
  }
  if (task.status === 'DRAFT') return res.status(400).json({ error: '任务发布后才能分享', code: 'TASK_NOT_PUBLISHED' });

  if (!isWechatConfigured()) {
    return res.json({ available: false, reason: '小程序发布后可用（服务端未配置微信凭据）', code: 'WEAPP_NOT_CONFIGURED' });
  }
  // 缓存有效直接返回
  if (task.weapp_link && task.weapp_link_expires && new Date(task.weapp_link_expires) > new Date()) {
    return res.json({ available: true, link: task.weapp_link, expiresAt: task.weapp_link_expires });
  }
  try {
    const { link, expiresAt } = await generateUrlLink('pages/landing/index', `task=${task.id}`);
    await update('tasks', { weapp_link: link, weapp_link_expires: expiresAt }, 'id = ?', [task.id]);
    res.json({ available: true, link, expiresAt });
  } catch (e: any) {
    console.error('[weapp-link]', e.message);
    res.json({ available: false, reason: '小程序链接生成失败（小程序可能未发布）', code: e.code || 'WEAPP_API_ERROR' });
  }
});

/** GET /api/tasks/:id/weapp-qrcode — 小程序码 PNG（永久有效，内存缓存）。失败返回 JSON。 */
const weappQrCache = new Map<string, Buffer>();
tasksRouter.get('/:id/weapp-qrcode', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, status FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限', code: 'FORBIDDEN' });
  }
  if (task.status === 'DRAFT') return res.status(400).json({ error: '任务发布后才能分享', code: 'TASK_NOT_PUBLISHED' });

  if (!isWechatConfigured()) {
    return res.status(404).json({ available: false, reason: '小程序发布后可用', code: 'WEAPP_NOT_CONFIGURED' });
  }
  const cached = weappQrCache.get(task.id);
  if (cached) {
    res.setHeader('Content-Type', 'image/png');
    return res.send(cached);
  }
  try {
    // scene 只放 taskId（32 hex 恰好顶满长度上限），landing 页负责解析
    const buf = await getUnlimitedQRCode(task.id, 'pages/landing/index');
    weappQrCache.set(task.id, buf);
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (e: any) {
    console.error('[weapp-qrcode]', e.message);
    res.status(404).json({ available: false, reason: '小程序码生成失败（小程序可能未发布）', code: e.code || 'WEAPP_API_ERROR' });
  }
});

/** 品牌上传页数据条款版本（改条款文案时同步升版本）。v2：明细模式一人多码分别计费 */
const UPLOAD_TERMS_VERSION = '2026-07-17-v2';

/** POST /api/tasks/:id/brand-bind — 品牌方凭数据上传链接的 token 自助绑定（2026-07-17 合并设计：
 *  不再有单独的邀请链接/审批。先到先得，只能绑一次；代理任务详情可见绑定者并可解绑。
 *  风险评估：上传链接持有者本就能看到码表统计，绑定的边际权限极小，代理可解绑兜底 */
tasksRouter.post('/:id/brand-bind', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  const task = await findOne<any>('SELECT id, title, creator_id, brand_party_id, upload_token FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  if (task.brand_party_id) return res.status(409).json({ error: '该任务已绑定品牌方，如有误请联系代理解绑', code: 'ALREADY_BOUND' });
  if (!token || !task.upload_token || token !== task.upload_token) {
    return res.status(403).json({ error: '链接无效或已过期', code: 'INVALID_TOKEN' });
  }
  if (task.creator_id === req.user!.userId) {
    return res.status(400).json({ error: '不能绑定自己创建的任务', code: 'CANNOT_BIND_OWN' });
  }
  await update('tasks', { brand_party_id: req.user!.userId }, 'id = ?', [task.id]);
  console.log(`[brand-bind] task=${task.id} brand_party=${req.user!.userId}`);
  res.json({ taskId: task.id, title: task.title, bound: true });
});

/** POST /api/tasks/:id/brand-unbind — 代理解绑品牌方（绑错人的兜底；解绑后可重新绑定） */
tasksRouter.post('/:id/brand-unbind', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, brand_party_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '只有任务创建者可以解绑', code: 'FORBIDDEN' });
  }
  if (!task.brand_party_id) return res.status(400).json({ error: '该任务未绑定品牌方', code: 'NOT_BOUND' });
  await update('tasks', { brand_party_id: null }, 'id = ?', [task.id]);
  console.log(`[brand-unbind] task=${task.id} by=${req.user!.userId} removed=${task.brand_party_id}`);
  res.json({ taskId: task.id, unbound: true });
});

/** GET /api/tasks/partner/mine — 我作为品牌方被绑定的任务（进展数量，无金额） */
tasksRouter.get('/partner/mine', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const rows = await findMany<any>(
    `SELECT t.id, t.title, t.status, t.mode, t.data_mode, t.max_heralds, t.created_at,
            u.nickname AS agency_name,
            (SELECT COUNT(*)::int FROM ambassador_tasks at WHERE at.task_id = t.id) AS code_holders,
            (SELECT COALESCE(SUM(at.registered_count),0)::int FROM ambassador_tasks at WHERE at.task_id = t.id) AS total_registered,
            (SELECT COALESCE(SUM(at.used_count),0)::int FROM ambassador_tasks at WHERE at.task_id = t.id) AS total_converted
     FROM tasks t JOIN users u ON u.id = t.creator_id
     WHERE t.brand_party_id = ? ORDER BY t.created_at DESC`,
    [req.user!.userId]
  );
  res.json(rows);
});

/** POST /api/tasks/:id/upload-consent — 品牌方（非平台用户）进入上传页前的条款同意，记录 IP/UA 作为电子证据 */
tasksRouter.post('/:id/upload-consent', async (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  const task = await findOne<any>('SELECT id, upload_token FROM tasks WHERE id = ?', [req.params.id]);
  if (!task || !token || task.upload_token !== token) {
    return res.status(403).json({ error: '链接无效或已过期', code: 'INVALID_TOKEN' });
  }
  await insert('upload_consents', {
    task_id: task.id,
    agreed_version: UPLOAD_TERMS_VERSION,
    ip: req.ip || req.socket?.remoteAddress || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    agreed_at: new Date().toISOString(),
  });
  res.json({ agreed: true, version: UPLOAD_TERMS_VERSION });
});

/** GET /api/tasks/:id/referrals — 明细模式跟踪列表（商家）。只回脱敏标识，不存在原文 */
tasksRouter.get('/:id/referrals', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, brand_party_id, data_mode FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  // 代理（创建者）/管理员/绑定的品牌方均可看跟踪明细（行内只有状态无金额）
  if (task.creator_id !== req.user!.userId && task.brand_party_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限', code: 'FORBIDDEN' });
  }
  const rows = await findMany<any>(
    `SELECT r.id, r.code, r.user_masked, r.registered_at, r.converted_at,
            (r.settled_txn_id IS NOT NULL) AS settled,
            u.nickname AS herald_name
     FROM referral_records r JOIN users u ON u.id = r.herald_id
     WHERE r.task_id = ? ORDER BY r.registered_at DESC LIMIT 500`,
    [task.id]
  );
  res.json({ dataMode: task.data_mode || 'AGGREGATE', records: rows });
});

// （改判端点已于 2026-07-17 同日拆除：跨码不再拦截，同一用户用多个码各码分别计费——见 handleDetailUpload 注释）

/** POST /api/tasks/:id/csv — 上传推广码转化数据，每条新转化直接写 transactions */
tasksRouter.post('/:id/csv', optionalAuth, async (req: Request, res: Response) => {
  const task = await findOne<any>(
    'SELECT id, creator_id, brand_party_id, mode, payout_per_herald, cost_per_herald, currency, title, lock_txn_id, upload_token, data_mode FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });

  // 鉴权：Bearer token（代理商家/绑定品牌方/管理员）或 upload_token（品牌专属链接）
  const uploadToken = String(req.query.token || '');
  const isTokenAuth = uploadToken && task.upload_token && uploadToken === task.upload_token;
  const isBrandParty = !!(req.user && task.brand_party_id && req.user.userId === task.brand_party_id);
  const isBearerAuth = req.user && (req.user.userId === task.creator_id || req.user.role === 'ADMIN' || isBrandParty);
  if (!isTokenAuth && !isBearerAuth) return res.status(403).json({ error: '无权限' });

  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '只有成果报酬任务支持数据上传' });

  // token 通道（品牌方，非平台用户）须先同意数据条款；Bearer 通道（商家/管理员）入驻时已签服务协议
  if (isTokenAuth && !isBearerAuth) {
    const consent = await findOne<any>('SELECT id FROM upload_consents WHERE task_id = ? LIMIT 1', [task.id]);
    if (!consent) {
      return res.status(403).json({ error: '请先阅读并同意数据上传条款', code: 'CONSENT_REQUIRED' });
    }
  }

  const { records } = req.body as { records: Array<{ code: string; registered_count?: number; used_count?: number }> };
  if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ error: 'records 不能为空' });

  // 单次转化的账：赫使到手 = payout_per_herald，商家扣款 = cost_per_herald（发布时按费率快照算好），
  // 差额即平台费。不再用废弃的 commission 字段/写死费率——报酬字段重构后新任务 commission 恒 0，曾导致结算 ¥0
  const payoutPerConv = Number(task.payout_per_herald) || 0;
  const costPerConv   = Math.max(Number(task.cost_per_herald) || 0, payoutPerConv);
  const feePerConv    = costPerConv - payoutPerConv;

  // 上传格式须与任务的数据回传模式一致（表头驱动：明细行带 user 字段）
  const isDetailShaped = records.some((r: any) => r.user !== undefined);
  const dataMode = task.data_mode === 'DETAIL' ? 'DETAIL' : 'AGGREGATE';
  if (dataMode === 'AGGREGATE' && isDetailShaped) {
    return res.status(400).json({ error: '该任务为汇总模式，请按「code,注册数,使用数」模板上传', code: 'MODE_MISMATCH', dataMode });
  }
  if (dataMode === 'DETAIL' && !isDetailShaped) {
    return res.status(400).json({ error: '该任务为明细模式，请按「code,用户邮箱或ID,是否完成交易」模板上传', code: 'MODE_MISMATCH', dataMode });
  }
  if (dataMode === 'DETAIL') {
    return handleDetailUpload(res, task, records as any[], { payoutPerConv, costPerConv, feePerConv, isTokenAuth: !!isTokenAuth, stripMoney: isBrandParty });
  }

  let processed = 0, skipped = 0, totalNewConversions = 0, totalPaid = 0;
  const blockedCodes: string[] = [];
  const skippedCodes: string[] = [];
  const skippedHints: Array<{ code: string; belongsTo: string }> = [];

  for (const row of records) {
    // 码归一化：CSV 里常见首尾空白/小写，落库码是大写
    const code = String(row.code || '').trim().toUpperCase();
    const at = await findOne<any>(
      'SELECT id, herald_id, paid_conversions, registered_count, used_count FROM ambassador_tasks WHERE unique_code = ? AND task_id = ?',
      [code, task.id]
    );
    if (!at) {
      skipped++;
      skippedCodes.push(code || String(row.code));
      // 码全局唯一：若属于同商家的另一个任务，直接告诉商家该用哪个任务的上传入口（实际踩过的坑）
      const elsewhere = await findOne<any>(
        'SELECT t.title, t.creator_id FROM ambassador_tasks at2 JOIN tasks t ON t.id = at2.task_id WHERE at2.unique_code = ?',
        [code]
      );
      if (elsewhere && elsewhere.creator_id === task.creator_id) {
        skippedHints.push({ code, belongsTo: elsewhere.title });
      }
      continue;
    }

    const newUsedCount = Math.max(0, parseInt(String(row.used_count || '0'), 10));
    const newRegCount  = Math.max(0, parseInt(String(row.registered_count || '0'), 10));
    const alreadyPaid  = Number(at.paid_conversions || 0);
    const delta        = newUsedCount - alreadyPaid;  // 新增转化数
    const countsChanged = newRegCount !== Number(at.registered_count || 0)
                       || newUsedCount !== Number(at.used_count || 0);

    // 更新原始数据（用于报表，无论是否有新转化）
    await update('ambassador_tasks', {
      registered_count: newRegCount,
      used_count: newUsedCount,
    }, 'id = ?', [at.id]);

    if (delta <= 0) {
      // 无新增付费转化：数据有变化也要让赫使知道（用户要求：数据生效即通知）
      if (countsChanged) {
        await notify({
          userId: at.herald_id,
          targetRole: 'HERALD',
          type: 'CONVERSION_UPDATED',
          title: `推广数据更新：${task.title}`,
          body: `你的推广码 ${code} 数据已更新：注册 ${newRegCount}、使用 ${newUsedCount}。`,
          metadata: { taskId: task.id, taskTitle: task.title, code, reg: newRegCount, used: newUsedCount },
        }).catch((e) => console.error('[notify] CONVERSION_UPDATED failed:', e));
      }
      processed++;
      continue;
    }

    const totalNeeded = costPerConv * delta;

    // PERFORMANCE 任务按转化实时扣余额，余额不足则拦截并通知商户
    const brandBal = await getBalance(task.creator_id, 'brand');
    if (brandBal.available < totalNeeded) {
      blockedCodes.push(code);
      await createNotification({
        userId: task.creator_id,
        targetRole: 'BRAND',
        type:   'SETTLEMENT_BLOCKED',
        title:  '邀请码任务结算失败 — 请充值',
        body:   `推广码 ${code} 新增 ${delta} 次转化，需支付 ¥${totalNeeded}，当前余额 ¥${brandBal.available} 不足，请充值后重新上传数据。`,
        metadata: { taskId: task.id, taskTitle: task.title, code, needed: totalNeeded, available: brandBal.available },
      });
      skipped++;
      continue;
    }

    // task_transactions 记录业务事件
    const releaseTxnId = await insert('task_transactions', {
      task_id:       task.id,
      type:          'TASK_RELEASE',
      task_amount:   costPerConv * delta,
      amount:        payoutPerConv * delta,
      platform_fee:  feePerConv * delta,
      from_user_id:  task.creator_id,
      to_user_id:    at.herald_id,
      parent_txn_id: task.lock_txn_id || null,
      status:        'completed',
      note:          `推广码 ${code} 新增 ${delta} 次转化`,
    });

    // 品牌扣可用余额，赫使+收入，平台+手续费
    await Promise.all([
      settleCreditTask({
        userId: task.creator_id, amount: costPerConv * delta,
        idempotencyKey: `SETTLE:${releaseTxnId}`,
        referenceType: 'task_transaction', referenceId: releaseTxnId,
        note: `推广码 ${code} 结算 ${delta} 次`,
      }),
      creditHerald({
        userId: at.herald_id, amount: payoutPerConv * delta,
        idempotencyKey: `CREDIT:${releaseTxnId}`,
        referenceType: 'task_transaction', referenceId: releaseTxnId,
        note: `任务《${task.title}》推广收入`,
      }),
      creditPlatformFee({
        userId: PLATFORM_USER_ID, amount: feePerConv * delta,
        idempotencyKey: `FEE:${releaseTxnId}`,
        referenceType: 'task_transaction', referenceId: releaseTxnId,
        note: `平台服务费（发布时费率快照）`,
      }),
    ]);

    // 更新已付转化数，防止重复计费
    await update('ambassador_tasks', { paid_conversions: newUsedCount }, 'id = ?', [at.id]);

    // 结算成功 → 通知赫使（站内信 + 邮件）
    const heraldUser = await findOne<any>('SELECT email, nickname FROM users WHERE id = ?', [at.herald_id]);
    const paidAmount = payoutPerConv * delta;
    await notify({
      userId: at.herald_id,
      email: heraldUser?.email || null,
      targetRole: 'HERALD',
      type: 'CONVERSION_SETTLED',
      title: `推广收入到账：${task.title}`,
      body: `你的推广码 ${code} 新增 ${delta} 次转化，收入 ¥${paidAmount} 已入账钱包。`,
      metadata: { taskId: task.id, taskTitle: task.title, code, conversions: delta, amount: paidAmount, reg: newRegCount, used: newUsedCount },
    }).catch((e) => console.error('[notify] CONVERSION_SETTLED failed:', e));

    totalNewConversions += delta;
    totalPaid           += paidAmount;
    processed++;
  }

  // 诊断日志：转化上传是资金入口，每次调用留痕（此前无请求日志，"上传没生效"无法回溯）
  console.log(`[csv-upload] task=${task.id}(${task.title}) auth=${isTokenAuth ? 'token' : 'bearer'} records=${records.length} processed=${processed} skipped=${skipped} newConv=${totalNewConversions} paid=${totalPaid}${skippedCodes.length ? ' skippedCodes=' + skippedCodes.join(',') : ''}${skippedHints.length ? ' hints=' + skippedHints.map(h => `${h.code}→《${h.belongsTo}》`).join(',') : ''}${blockedCodes.length ? ' blockedCodes=' + blockedCodes.join(',') : ''}`);

  res.json({
    processed,
    skipped,
    total: records.length,
    newConversions: totalNewConversions,
    // 品牌方（非创建者）看不到结算金额——金额是代理的成本价（2026-07-17 权限定稿）
    ...(isBrandParty ? {} : { totalPaid, commissionPerConversion: costPerConv }),
    ...(skippedCodes.length > 0 ? { skippedCodes } : {}),
    ...(skippedHints.length > 0 ? { skippedHints } : {}),
    ...(blockedCodes.length > 0 ? { blockedCodes, message: `${blockedCodes.length} 个推广码因余额不足未结算，请充值后重新上传` } : {}),
  });
});

/** 明细模式上传处理（2026-07-17 修订版）：
 *  一行 = 一个「用户×码」；幂等键 UNIQUE(task_id, code, user_hash)——同码内同用户只算一次
 *  （商家手滑重复上传免疫）；同一用户用多个码 → 各码分别计费，multiCodeUsers 仅作提示不拦截
 *  （定稿理由：赫使推广真实发生就该有回报，一人多码是品牌系统的选择与成本，条款已写明）；
 *  状态单向：未出现→已注册→已转化，不降级不回收；行级 settled_txn_id 防重复打款；
 *  ambassador_tasks 计数为明细行投影（明细表是唯一事实来源）；
 *  隐私：原文只在内存里，落库/日志仅 hash+脱敏串（utils/privacy.ts）。 */
async function handleDetailUpload(
  res: Response,
  task: any,
  records: Array<{ code?: string; user?: string; converted?: any }>,
  money: { payoutPerConv: number; costPerConv: number; feePerConv: number; isTokenAuth: boolean; stripMoney?: boolean },
) {
  const now = () => new Date().toISOString();
  const isTruthy = (v: any) => ['1', 'true', '是', 'yes', 'y'].includes(String(v ?? '').trim().toLowerCase());

  let processed = 0, skipped = 0;
  const skippedCodes: string[] = [];
  const skippedHints: Array<{ code: string; belongsTo: string }> = [];
  const multiCodeUsers: Array<{ user: string; codes: string[] }> = [];
  const touchedCodes = new Set<string>();
  const atByCode = new Map<string, any>();

  // pass 1：逐行 upsert
  for (const row of records) {
    const code = String(row.code || '').trim().toUpperCase();
    const rawUser = String(row.user || '').trim();
    if (!code || !rawUser) { skipped++; continue; }

    let at = atByCode.get(code);
    if (at === undefined) {
      at = await findOne<any>('SELECT id, herald_id FROM ambassador_tasks WHERE unique_code = ? AND task_id = ?', [code, task.id]);
      atByCode.set(code, at || null);
    }
    if (!at) {
      skipped++;
      if (!skippedCodes.includes(code)) {
        skippedCodes.push(code);
        const elsewhere = await findOne<any>(
          'SELECT t.title, t.creator_id FROM ambassador_tasks at2 JOIN tasks t ON t.id = at2.task_id WHERE at2.unique_code = ?', [code]
        );
        if (elsewhere && elsewhere.creator_id === task.creator_id) skippedHints.push({ code, belongsTo: elsewhere.title });
      }
      continue;
    }

    const userHash = hashUserKey(rawUser);
    const userMasked = maskUserKey(rawUser);
    const converted = isTruthy(row.converted);
    // 幂等键：同码内同用户唯一。同一用户在其他码下的记录不影响本行（分别计费）
    const existing = await findOne<any>(
      'SELECT id, converted_at, settled_txn_id FROM referral_records WHERE task_id = ? AND code = ? AND user_hash = ?',
      [task.id, code, userHash]
    );
    if (!existing) {
      // 透明提示（不拦截）：该用户已出现在本任务其他码下 → 本行照常入库计费
      const otherCodes = await findMany<any>(
        'SELECT code FROM referral_records WHERE task_id = ? AND user_hash = ? AND code <> ?',
        [task.id, userHash, code]
      );
      if (otherCodes.length) {
        multiCodeUsers.push({ user: userMasked, codes: otherCodes.map((r: any) => r.code).concat(code) });
      }
      await insert('referral_records', {
        task_id: task.id, code, herald_id: at.herald_id, user_hash: userHash, user_masked: userMasked,
        registered_at: now(), converted_at: converted ? now() : null,
        created_at: now(), updated_at: now(),
      });
      touchedCodes.add(code);
      processed++;
    } else {
      // 同码重复出现：仅允许 未转化→已转化 单向升级；1 改回 0 不降级、已结算不回收
      if (converted && !existing.converted_at) {
        await update('referral_records', { converted_at: now(), updated_at: now() }, 'id = ?', [existing.id]);
        touchedCodes.add(code);
      }
      processed++;
    }
  }

  // pass 2：按码结算（行级 settled_txn_id 保证每行只打一次款）+ 投影刷新 + 通知
  let totalNewConversions = 0, totalPaid = 0;
  const blockedCodes: string[] = [];
  for (const code of touchedCodes) {
    const at = atByCode.get(code);
    const unsettled = await findMany<any>(
      'SELECT id FROM referral_records WHERE task_id = ? AND code = ? AND converted_at IS NOT NULL AND settled_txn_id IS NULL',
      [task.id, code]
    );
    const delta = unsettled.length;
    let settledNow = false;

    if (delta > 0) {
      const totalNeeded = money.costPerConv * delta;
      const brandBal = await getBalance(task.creator_id, 'brand');
      if (brandBal.available < totalNeeded) {
        blockedCodes.push(code);
        await createNotification({
          userId: task.creator_id, targetRole: 'BRAND', type: 'SETTLEMENT_BLOCKED',
          title: '邀请码任务结算失败 — 请充值',
          body: `推广码 ${code} 新增 ${delta} 次转化，需支付 ¥${totalNeeded}，当前余额 ¥${brandBal.available} 不足，请充值后重新上传数据。`,
          metadata: { taskId: task.id, taskTitle: task.title, code, needed: totalNeeded, available: brandBal.available },
        });
      } else {
        const releaseTxnId = await insert('task_transactions', {
          task_id: task.id, type: 'TASK_RELEASE',
          task_amount: money.costPerConv * delta, amount: money.payoutPerConv * delta, platform_fee: money.feePerConv * delta,
          from_user_id: task.creator_id, to_user_id: at.herald_id, parent_txn_id: task.lock_txn_id || null,
          status: 'completed', note: `推广码 ${code} 新增 ${delta} 次转化（明细）`,
        });
        await Promise.all([
          settleCreditTask({
            userId: task.creator_id, amount: money.costPerConv * delta,
            idempotencyKey: `SETTLE:${releaseTxnId}`, referenceType: 'task_transaction', referenceId: releaseTxnId,
            note: `推广码 ${code} 结算 ${delta} 次`,
          }),
          creditHerald({
            userId: at.herald_id, amount: money.payoutPerConv * delta,
            idempotencyKey: `CREDIT:${releaseTxnId}`, referenceType: 'task_transaction', referenceId: releaseTxnId,
            note: `任务《${task.title}》推广收入`,
          }),
          creditPlatformFee({
            userId: PLATFORM_USER_ID, amount: money.feePerConv * delta,
            idempotencyKey: `FEE:${releaseTxnId}`, referenceType: 'task_transaction', referenceId: releaseTxnId,
            note: `平台服务费（发布时费率快照）`,
          }),
        ]);
        await pool.query('UPDATE referral_records SET settled_txn_id = $1, updated_at = $2 WHERE id = ANY($3)',
          [releaseTxnId, now(), unsettled.map((r: any) => r.id)]);
        totalNewConversions += delta;
        totalPaid += money.payoutPerConv * delta;
        settledNow = true;
      }
    }

    // 投影：计数从明细行派生（赫使端/任务页展示零改动）
    await pool.query(
      `UPDATE ambassador_tasks SET
         registered_count = (SELECT COUNT(*) FROM referral_records r WHERE r.task_id = $1 AND r.code = $2),
         used_count       = (SELECT COUNT(*) FROM referral_records r WHERE r.task_id = $1 AND r.code = $2 AND r.converted_at IS NOT NULL),
         paid_conversions = (SELECT COUNT(*) FROM referral_records r WHERE r.task_id = $1 AND r.code = $2 AND r.settled_txn_id IS NOT NULL)
       WHERE task_id = $1 AND unique_code = $2`,
      [task.id, code]
    );

    // 通知赫使：结算成功发 SETTLED；数据有变但无新结算发 UPDATED；余额拦截只通知商家（钱没到不预告）
    const counts = await findOne<any>(
      'SELECT registered_count, used_count FROM ambassador_tasks WHERE task_id = ? AND unique_code = ?', [task.id, code]
    );
    if (settledNow) {
      const heraldUser = await findOne<any>('SELECT email FROM users WHERE id = ?', [at.herald_id]);
      const paidAmount = money.payoutPerConv * delta;
      await notify({
        userId: at.herald_id, email: heraldUser?.email || null, targetRole: 'HERALD', type: 'CONVERSION_SETTLED',
        title: `推广收入到账：${task.title}`,
        body: `你的推广码 ${code} 新增 ${delta} 次转化，收入 ¥${paidAmount} 已入账钱包。`,
        metadata: { taskId: task.id, taskTitle: task.title, code, conversions: delta, amount: paidAmount, reg: counts?.registered_count, used: counts?.used_count },
      }).catch((e) => console.error('[notify] CONVERSION_SETTLED failed:', e));
    } else if (delta === 0) {
      await notify({
        userId: at.herald_id, targetRole: 'HERALD', type: 'CONVERSION_UPDATED',
        title: `推广数据更新：${task.title}`,
        body: `你的推广码 ${code} 数据已更新：注册 ${counts?.registered_count || 0}、使用 ${counts?.used_count || 0}。`,
        metadata: { taskId: task.id, taskTitle: task.title, code, reg: counts?.registered_count, used: counts?.used_count },
      }).catch((e) => console.error('[notify] CONVERSION_UPDATED failed:', e));
    }
  }

  // 诊断日志：只打计数与 hash 前缀级信息，不打用户原文（隐私底线）
  console.log(`[csv-upload] task=${task.id}(${task.title}) mode=DETAIL auth=${money.isTokenAuth ? 'token' : 'bearer'} records=${records.length} processed=${processed} skipped=${skipped} newConv=${totalNewConversions} paid=${totalPaid} multiCode=${multiCodeUsers.length}${skippedCodes.length ? ' skippedCodes=' + skippedCodes.join(',') : ''}${blockedCodes.length ? ' blockedCodes=' + blockedCodes.join(',') : ''}`);

  res.json({
    dataMode: 'DETAIL',
    processed,
    skipped,
    total: records.length,
    newConversions: totalNewConversions,
    // 品牌方看不到结算金额（代理成本价）
    ...(money.stripMoney ? {} : { totalPaid, commissionPerConversion: money.costPerConv }),
    ...(skippedCodes.length > 0 ? { skippedCodes } : {}),
    ...(skippedHints.length > 0 ? { skippedHints } : {}),
    ...(multiCodeUsers.length > 0 ? { multiCodeUsers } : {}),
    ...(blockedCodes.length > 0 ? { blockedCodes, message: `${blockedCodes.length} 个推广码因余额不足未结算，请充值后重新上传` } : {}),
  });
}

/** PATCH /api/tasks/:id/publish});

/** PATCH /api/tasks/:id/publish — 发布任务 */
tasksRouter.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  const task = await findOne<any>(
    `SELECT t.*, u.nickname as creator_name,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url,
            bp2.nickname as brand_party_name,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*)::int FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count
     FROM tasks t JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     LEFT JOIN users bp2 ON bp2.id = t.brand_party_id
     WHERE t.id = ?`, [req.params.id]
  );

  if (!task) return res.status(404).json({ error: '任务不存在' });

  // 敏感凭证只给创建者/管理员：upload_token 可直接触发结算上传/绑定品牌方
  // （修复：此前 t.* 泄露给任何访问者）
  const isOwner = req.user && (req.user.userId === task.creator_id || req.user.role === 'ADMIN');
  if (!isOwner) {
    delete task.upload_token;
  }

  const applications = await findMany<any>(
    `SELECT ta.*, u.nickname, hp.display_name, hp.country, hp.social_platforms,
            hp.tier_snapshot, hp.social_platforms_updated_at,
            (SELECT COUNT(*) FROM task_submissions ts2 WHERE ts2.herald_id = ta.herald_id AND ts2.status = 'APPROVED') AS completed_tasks,
            (SELECT ROUND(AVG(CASE WHEN tr.score >= 4 THEN 1.0 ELSE 0 END) * 100) / 100.0
             FROM task_ratings tr WHERE tr.herald_id = ta.herald_id) AS good_rate
     FROM task_applications ta
     JOIN users u ON u.id = ta.herald_id
     LEFT JOIN herald_profiles hp ON hp.user_id = ta.herald_id
     WHERE ta.task_id = ?`, [req.params.id]
  );

  const subRow = await findOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM task_submissions WHERE task_id = ?', [req.params.id]
  );

  const submissionCount = subRow?.cnt || 0;

  res.json({ ...task, applications, _count: { applications: applications.length, submissions: submissionCount } });
});

/** POST /api/tasks — 创建任务 (品牌商家) */
tasksRouter.post('/', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const data = CreateTaskSchema.parse(req.body);

    const taskId = await insert('tasks', {
      creator_id:        req.user!.userId,
      mode:              data.mode,
      title:             data.title,
      description:       data.description,
      requirements:      data.requirements || null,
      payout_per_herald: data.payoutPerHerald,
      currency:          'JPY',
      max_heralds:       data.maxHeralds,
      deadline:          data.deadline || null,
      category:          data.category || null,
      content_type:      data.mode === 'PERFORMANCE' ? null : data.contentType,
      difficulty:        data.difficulty,
      cover_image:       data.coverImage || null,
      code_mode:         data.codeMode || 'auto',
      platform_requirements: data.platformRequirements ? JSON.stringify(data.platformRequirements) : null,
      req_mode:          data.reqMode,
      req_min_count:     data.reqMode === 'ANY_N' ? (data.reqMinCount || 1) : null,
      data_mode:         data.mode === 'PERFORMANCE' ? data.dataMode : 'AGGREGATE',
      visibility:        data.visibility || 'PUBLIC',
      status:            'DRAFT',
      // cost_per_herald 和 commission_rate 在发布时计算快照
    });

    // PERFORMANCE + 自动模式：创建时立即生成推广码池
    if (data.mode === 'PERFORMANCE' && data.codeMode === 'auto') {
      generateCodePool(taskId, data.maxHeralds);
    }

    const task = await findOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: '参数错误', details: err.errors });
    }
    console.error('Create task error:', err);
    res.status(500).json({ error: '创建任务失败' });
  }
});

/** PUT /api/tasks/:id — 编辑草稿任务 */
tasksRouter.put('/:id', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, status FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.status !== 'DRAFT') return res.status(400).json({ error: '只有草稿可以编辑' });

  const { title, description, requirements, payoutPerHerald, maxHeralds, deadline, category, contentType, difficulty, coverImage, platformRequirements, visibility, reqMode, reqMinCount } = req.body;
  const data: Record<string, any> = {};
  if (title) data.title = title;
  if (description) data.description = description;
  if (requirements !== undefined) data.requirements = requirements;
  if (payoutPerHerald) data.payout_per_herald = payoutPerHerald;
  if (maxHeralds) data.max_heralds = maxHeralds;
  if (deadline !== undefined) data.deadline = deadline || null;
  if (category !== undefined) data.category = category;
  if (contentType) data.content_type = contentType;
  if (difficulty) data.difficulty = difficulty;
  if (coverImage !== undefined) data.cover_image = coverImage || null;
  if (platformRequirements !== undefined) data.platform_requirements = platformRequirements ? JSON.stringify(platformRequirements) : null;
  if (visibility && ['PUBLIC', 'INVITE'].includes(visibility)) data.visibility = visibility;
  if (reqMode && ['ALL', 'ANY_N'].includes(reqMode)) {
    data.req_mode = reqMode;
    data.req_min_count = reqMode === 'ANY_N' ? Math.max(1, parseInt(String(reqMinCount || 1), 10)) : null;
  }
  // 数据回传模式只在草稿期可改（发布后锁定，防两套数据对不上）
  if (req.body.dataMode && ['AGGREGATE', 'DETAIL'].includes(req.body.dataMode)) {
    data.data_mode = req.body.dataMode;
  }

  await update('tasks', data, 'id = ?', [req.params.id]);
  res.json(await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]));
});

/** PATCH /api/tasks/:id/meta — 已发布任务的有限字段编辑 */
tasksRouter.patch('/:id/meta', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<{ id: string; creator_id: string; status: string; max_heralds: number }>(
    'SELECT id, creator_id, status, max_heralds FROM tasks WHERE id = ?', [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }
  if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) {
    return res.status(400).json({ error: '只有进行中的任务可以编辑' });
  }

  const { description, requirements, deadline, coverImage, platformRequirements, maxHeralds, reqMode, reqMinCount } = req.body;
  const data: Record<string, any> = {};
  if (description !== undefined) data.description = description;
  if (requirements !== undefined) data.requirements = requirements || null;
  if (deadline !== undefined) data.deadline = deadline || null;
  if (coverImage !== undefined) data.cover_image = coverImage || null;
  if (platformRequirements !== undefined) data.platform_requirements = platformRequirements ? JSON.stringify(platformRequirements) : null;
  if (reqMode && ['ALL', 'ANY_N'].includes(reqMode)) {
    data.req_mode = reqMode;
    data.req_min_count = reqMode === 'ANY_N' ? Math.max(1, parseInt(String(reqMinCount || 1), 10)) : null;
  }
  // 名额只允许增加
  if (maxHeralds !== undefined) {
    if (maxHeralds < task.max_heralds) return res.status(400).json({ error: '名额不能减少' });
    data.max_heralds = maxHeralds;
  }

  if (!Object.keys(data).length) return res.status(400).json({ error: '没有可更新的字段' });
  await update('tasks', data, 'id = ?', [req.params.id]);
  res.json(await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]));
});

/** GET /api/tasks/:id/codes — 推广码池概览（商家用） */
tasksRouter.patch('/:id/publish', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>(
    'SELECT id, creator_id, status, mode, payout_per_herald, currency, max_heralds, title FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '只有创建者可以发布' });
  }
  if (task.status !== 'DRAFT') {
    return res.status(400).json({ error: '只有草稿状态可以发布' });
  }

  // 发布时计算费率快照和单人成本（含服务费）
  const { rate: commissionRate } = await getEffectiveCommissionRate(task.creator_id);
  const costPerHerald = Math.round(task.payout_per_herald / (1 - commissionRate));

  const creditInfo  = await getBrandCreditInfo(task.creator_id);
  const fpThreshold = Number(await getSetting('fast_payout_threshold')) || 100000;
  const fast_payout = creditInfo.availableBalance >= fpThreshold;
  const uploadToken = crypto.randomBytes(16).toString('hex');

  await update('tasks', {
    status:          'OPEN',
    published_at:    new Date().toISOString(),
    cost_per_herald: costPerHerald,
    commission_rate: commissionRate,
    fast_payout,
    upload_token:    uploadToken,
  }, 'id = ?', [req.params.id]);

  // 首次发布且未充值 → 响应中附带充值引导提醒
  const prevPublished = await findOne<{ id: string }>(
    `SELECT id FROM tasks WHERE creator_id = ? AND status != 'DRAFT' AND id != ?`,
    [task.creator_id, req.params.id],
  );
  const isFirstPublish = !prevPublished && creditInfo.availableBalance === 0;

  if (isFirstPublish) {
    await pool.query(
      `UPDATE brand_profiles SET first_publish_reminder_sent = TRUE WHERE user_id = $1`,
      [task.creator_id],
    );
  }

  const updated = await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json({
    ...updated,
    ...(isFirstPublish ? {
      topupReminder: '为提升任务可信度、鼓励赫使积极报名，并在任务完成后自动打款，请尽快完成充值。充值后您的任务将获得「极速打款」标签，显著提升赫使报名意愿。',
    } : {}),
  });
});

// /escrow 端点已废弃，资金锁定在 /publish 时自动完成

/** PATCH /api/tasks/:id/complete — 完成/关闭任务 */
tasksRouter.patch('/:id/complete', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId) return res.status(403).json({ error: '无权限' });

  await update('tasks', { status: 'COMPLETED', completed_at: new Date().toISOString() }, 'id = ?', [req.params.id]);
  const updated = await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});
