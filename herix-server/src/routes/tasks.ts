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
import { getBrandCreditInfo, getSetting, getEffectiveCommissionRate, getPublishLimitInfo } from '../utils/settings';
import { SOCIAL_PLATFORM_IDS } from '../shared/contracts';
import { translateTask } from '../utils/translate';
import { fetchTaskApplications } from '../utils/applicationQueries';
import { VALID_COMMUNITIES, communityToSite } from '../constants/communities';
import { VALID_SITES } from '../constants/sites';
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

// platformRequirements 里的 platformId 必须在注册表内（建任务走 zod，编辑走这里）
function badPlatformReq(reqs: any): string | null {
  if (!Array.isArray(reqs)) return null;
  const bad = reqs.find((r: any) => r?.platformId && !SOCIAL_PLATFORM_IDS.includes(r.platformId));
  return bad ? bad.platformId : null;
}


/** GET /api/tasks — 获取任务列表（已登录用户可见自己所有状态，未登录只见 OPEN） */
tasksRouter.get('/', optionalAuth, async (req: Request, res: Response) => {
  const { status, mode, creator, page = '1', limit = '20', lang } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params: any[] = [];

  if (status) { where += ' AND t.status = ?'; params.push(status); }
  if (mode) { where += ' AND t.mode = ?'; params.push(mode); }
  if (creator) { where += ' AND t.creator_id = ?'; params.push(creator); }
  // 非创建者只看已发布（OPEN）任务；INVITE 任务不出现在公开列表
  const uid = req.user?.userId;
  if (!uid) {
    // PENDING_REVIEW 真状态后 status='OPEN' 已隐含过审，platform_review 过滤冗余（列保留做审计）
    where += " AND t.status = 'OPEN' AND t.visibility = 'PUBLIC'";
  } else if (creator) {
    // 商家查自己的任务：显示全部状态和 visibility
    if (creator !== uid) {
      where += " AND t.visibility = 'PUBLIC' AND t.status NOT IN ('DRAFT','PENDING_REVIEW')"; // 不能看别人的 INVITE/草稿/审核中任务
    }
  } else {
    // 赫使浏览探索列表：只显示 OPEN 且 PUBLIC（OPEN 已隐含过审）
    where += " AND t.status = 'OPEN' AND t.visibility = 'PUBLIC'";
    // 社群过滤：只显示定向到该社群的任务 + 无社群限制的任务（community=null 历史账号降级全量）
    // allCommunities=true 时赫使可主动关闭过滤，看全量任务
    const heraldProfile = await findOne<{ community: string | null }>(
      'SELECT community FROM herald_profiles WHERE user_id = ?', [uid]
    );
    const community = heraldProfile?.community ?? null;
    const allCommunities = req.query.allCommunities === 'true';
    // 站点过滤：赫使只看自己所在站点的任务（从 community 推导，无 community 则不过滤）
    const heraldSite = community ? communityToSite(community) : null;
    if (heraldSite) {
      where += ` AND t.site_id = ?`;
      params.push(heraldSite);
    }
    if (community && !allCommunities) {
      where += ` AND (t.target_communities = '{}' OR ? = ANY(t.target_communities))`;
      params.push(community);
    }
  }

  const totalRow = await findOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM tasks t WHERE ${where}`, params
  );

  const total = totalRow?.cnt || 0;

  const useLang = typeof lang === 'string' && lang !== 'zh' ? lang : null;
  const tasks = await findMany<any>(
    `SELECT t.*,
            ${useLang ? 'COALESCE(tt.title, t.title) as title, COALESCE(tt.description, t.description) as description,' : ''}
            u.nickname as creator_name,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url,
            bp.company_name as brand_company_name,
            (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id = t.id) as application_count,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*)::int FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count,
            (SELECT trs.data_mode FROM task_referral_specs trs WHERE trs.task_id = t.id) as data_mode
     FROM tasks t
     JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     ${useLang ? 'LEFT JOIN task_translations tt ON tt.task_id = t.id AND tt.locale = ?' : ''}
     WHERE ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...(useLang ? [useLang] : []), ...params, Number(limit), skip]
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
    SELECT t.id, t.title, t.mode, t.status, t.commission, t.max_heralds, t.created_at,
      (SELECT trs.data_mode FROM task_referral_specs trs WHERE trs.task_id = t.id) as data_mode,
      (SELECT COUNT(*)::int FROM task_brand_parties tbp WHERE tbp.task_id = t.id) AS brand_party_count,
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
    `SELECT pc.code, pc.herald_id, pc.assigned_at,
            u.nickname AS herald_name,
            amb.registered_count, amb.used_count, amb.status AS herald_status
     FROM task_promo_codes pc
     LEFT JOIN users u ON u.id = pc.herald_id
     LEFT JOIN ambassador_tasks amb ON amb.task_id = pc.task_id AND amb.herald_id = pc.herald_id
     WHERE pc.task_id = ? ORDER BY pc.created_at ASC`,
    [req.params.id]
  );
  res.json({
    total: all.length,
    assigned: all.filter((c: any) => c.herald_id).length,
    available: all.filter((c: any) => !c.herald_id).length,
    samples: all.slice(0, 5).map((c: any) => c.code),
    // 逐条明细（2026-07-18 补）：codesPanel 需要按赫使展示每个码的转化情况，
    // 此前该数据从未返回过，前端 state.taskCodes 一直是 undefined（详情页推广码 tab 恒空）
    codes: all.map((c: any) => ({
      unique_code: c.code,
      herald_id: c.herald_id,
      herald_name: c.herald_name,
      total_referrals: c.registered_count || 0,
      qualified_count: c.used_count || 0,
      status: c.herald_id ? (c.herald_status || 'active') : 'available',
    })),
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

// 单次上传数量上限：express.json() 默认 100KB 请求体，短码(~12字符/条)约几千条就会撞 413。
// 给一个明确、留足余量的数字，好过让商家撞一个不可预期的"请求体过大"（2026-07-27 排查坐实）
const MAX_CUSTOM_CODES_PER_UPLOAD = 2000;
const SHORT_LINK_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const BASE_URL = process.env.BASE_URL || 'https://herix.huaxuex.com';

/** POST /api/tasks/:id/short-link — 创建或返回已有短链（幂等，一个任务一个码） */
tasksRouter.post('/:id/short-link', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const task = await findOne<{ id: string; creator_id: string }>('SELECT id, creator_id FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });

    const existing = await findOne<{ code: string }>('SELECT code FROM short_links WHERE task_id = ?', [task.id]);
    if (existing) return res.json({ code: existing.code, url: `${BASE_URL}/t/${existing.code}` });

    let code: string;
    do {
      code = Array.from({ length: 6 }, () => SHORT_LINK_CHARS[Math.floor(Math.random() * SHORT_LINK_CHARS.length)]).join('');
    } while (await findOne('SELECT code FROM short_links WHERE code = ?', [code]));

    await insert('short_links', { code, task_id: task.id, created_at: new Date().toISOString() });
    res.json({ code, url: `${BASE_URL}/t/${code}` });
  } catch (err) {
    console.error('Short link error:', err);
    res.status(500).json({ error: '短链生成失败' });
  }
});

/** POST /api/tasks/:id/codes/upload — 商家上传自定义推广码 */
tasksRouter.post('/:id/codes/upload', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    // 2026-07-25 code_mode/data_mode 迁移进 task_referral_specs 后 tasks 表已删该列，
    // 这里当时漏改，SELECT 撞 42703 未捕获异常——Express 4 对未 catch 的 async 异常不会自动
    // 500，请求直接挂死到客户端超时，商家侧只看到"提交失败，请稍后重试"（2026-07-27 用户报）
    const task = await findOne<any>('SELECT id, creator_id, mode, max_heralds FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
    if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '仅成果报酬任务支持推广码' });

    const { codes } = req.body as { codes: string[] };
    if (!Array.isArray(codes) || codes.length === 0) return res.status(400).json({ error: 'codes 数组不能为空' });
    if (codes.length > MAX_CUSTOM_CODES_PER_UPLOAD) {
      return res.status(400).json({
        error: `单次最多上传 ${MAX_CUSTOM_CODES_PER_UPLOAD} 个推广码（本次 ${codes.length} 个），请分批上传`,
        code: 'MAX_CODES_EXCEEDED',
        limit: MAX_CUSTOM_CODES_PER_UPLOAD,
      });
    }

    const cleaned = [...new Set(codes.map((c: string) => c.trim()).filter(Boolean))];

    let added = 0, skipped = 0;
    for (const code of cleaned) {
      const exists = await findOne('SELECT id FROM task_promo_codes WHERE code = ?', [code]);
      if (exists) { skipped++; continue; }
      await insert('task_promo_codes', { task_id: task.id, code });
      added++;
    }

    // 自定义码的数量即招募容量，上传后同步更新 max_heralds
    const totalInPool = await findOne<{ cnt: number }>('SELECT COUNT(*)::int as cnt FROM task_promo_codes WHERE task_id = ?', [task.id]);
    await update('tasks', { max_heralds: totalInPool?.cnt ?? cleaned.length }, 'id = ?', [task.id]);

    res.json({ added, skipped, total: cleaned.length, maxHeralds: totalInPool?.cnt ?? cleaned.length });
  } catch (err) {
    console.error('Codes upload error:', err);
    res.status(500).json({ error: '推广码上传失败' });
  }
});

/** GET /api/tasks/:id/upload-info — 品牌上传页用，token 鉴权，返回任务基本信息 */
tasksRouter.get('/:id/upload-info', async (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(401).json({ error: '缺少 token' });
  const task = await findOne<any>(
    'SELECT id, title, mode, status, upload_token, max_heralds, (SELECT trs.data_mode FROM task_referral_specs trs WHERE trs.task_id = tasks.id) as data_mode FROM tasks WHERE id = ?',
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

/** 任务关闭后的数据缓冲期：COMPLETED 后 30 天内仍可上传/查看，此后惰性失效（无定时任务） */
const GRACE_DAYS = 30;

function graceDeadline(task: { status?: string; completed_at?: string | null }): Date | null {
  if (task.status !== 'COMPLETED' || !task.completed_at) return null;
  return new Date(new Date(task.completed_at).getTime() + GRACE_DAYS * 24 * 3600_000);
}

/** 数据通道是否开放：进行中，或已完成且在 30 天缓冲期内。CANCELLED/DRAFT 一律关闭 */
function uploadWindowOpen(task: { status?: string; completed_at?: string | null }): boolean {
  if (['PENDING_REVIEW', 'OPEN', 'IN_PROGRESS'].includes(String(task.status))) return true;
  const d = graceDeadline(task);
  return !!d && d.getTime() > Date.now();
}

/** SQL 片段：任务对品牌方仍"活跃"（进行中或缓冲期内），参数为 30 天前的 ISO 时间 */
const BINDING_ACTIVE_SQL = `(t.status IN ('PENDING_REVIEW','OPEN','IN_PROGRESS') OR (t.status = 'COMPLETED' AND t.completed_at > ?))`;
const graceCutoffIso = () => new Date(Date.now() - GRACE_DAYS * 24 * 3600_000).toISOString();

async function isBrandPartyOf(taskId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const r = await findOne<{ id: string }>('SELECT id FROM task_brand_parties WHERE task_id = ? AND user_id = ?', [taskId, userId]);
  return !!r;
}

/** POST /api/tasks/:id/brand-bind — 品牌方凭数据上传链接的 token 自助绑定（2026-07-17 合并设计：
 *  不再有单独的邀请链接/审批。先到先得，只能绑一次；代理任务详情可见绑定者并可解绑。
 *  风险评估：上传链接持有者本就能看到码表统计，绑定的边际权限极小，代理可解绑兜底 */
tasksRouter.post('/:id/brand-bind', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  const task = await findOne<any>('SELECT id, title, creator_id, status, completed_at, upload_token FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  if (!token || !task.upload_token || token !== task.upload_token) {
    return res.status(403).json({ error: '链接无效或已过期', code: 'INVALID_TOKEN' });
  }
  if (task.creator_id === req.user!.userId) {
    return res.status(400).json({ error: '不能绑定自己创建的任务', code: 'CANNOT_BIND_OWN' });
  }
  if (!uploadWindowOpen(task)) {
    return res.status(400).json({ error: '任务已关闭且超过数据缓冲期，无法绑定', code: 'TASK_CLOSED' });
  }
  // 多账号绑定（品牌可能多个员工账号），同账号重复绑定幂等
  const existing = await isBrandPartyOf(task.id, req.user!.userId);
  if (!existing) {
    await insert('task_brand_parties', { task_id: task.id, user_id: req.user!.userId, bound_at: new Date().toISOString() });
    console.log(`[brand-bind] task=${task.id} brand_party=${req.user!.userId}`);
  }
  res.json({ taskId: task.id, title: task.title, bound: true, already: existing });
});

/** POST /api/tasks/:id/brand-unbind — 代理解绑指定品牌账号（绑错人的兜底；解绑后可重新绑定） */
tasksRouter.post('/:id/brand-unbind', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  const task = await findOne<any>('SELECT id, creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '只有任务创建者可以解绑', code: 'FORBIDDEN' });
  }
  if (!userId) return res.status(400).json({ error: '缺少要解绑的账号', code: 'USER_REQUIRED' });
  const r = await pool.query('DELETE FROM task_brand_parties WHERE task_id = $1 AND user_id = $2', [task.id, userId]);
  if (!r.rowCount) return res.status(400).json({ error: '该账号未绑定本任务', code: 'NOT_BOUND' });
  console.log(`[brand-unbind] task=${task.id} by=${req.user!.userId} removed=${userId}`);
  res.json({ taskId: task.id, unbound: true });
});

/** GET /api/tasks/partner/mine — 我作为品牌方被绑定的任务（进展数量，无金额） */
tasksRouter.get('/partner/mine', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  // 绑定关系随任务生命周期：关闭超过 30 天缓冲期的任务不再出现（惰性失效）
  const rows = await findMany<any>(
    `SELECT t.id, t.title, t.status, t.mode, trs.data_mode, t.max_heralds, t.created_at, t.completed_at,
            u.nickname AS agency_name,
            (SELECT COUNT(*)::int FROM ambassador_tasks at WHERE at.task_id = t.id) AS code_holders,
            (SELECT COALESCE(SUM(at.registered_count),0)::int FROM ambassador_tasks at WHERE at.task_id = t.id) AS total_registered,
            (SELECT COALESCE(SUM(at.used_count),0)::int FROM ambassador_tasks at WHERE at.task_id = t.id) AS total_converted
     FROM tasks t
     LEFT JOIN task_referral_specs trs ON trs.task_id = t.id
     JOIN task_brand_parties tbp ON tbp.task_id = t.id
     JOIN users u ON u.id = t.creator_id
     WHERE tbp.user_id = ? AND ${BINDING_ACTIVE_SQL}
     ORDER BY t.created_at DESC`,
    [req.user!.userId, graceCutoffIso()]
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
  const task = await findOne<any>('SELECT id, creator_id, status, completed_at, (SELECT trs.data_mode FROM task_referral_specs trs WHERE trs.task_id = tasks.id) as data_mode FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  // 代理（创建者）/管理员随时可看；品牌方仅在任务活跃或 30 天缓冲期内可看
  const isCreatorOrAdmin = task.creator_id === req.user!.userId || req.user!.role === 'ADMIN';
  if (!isCreatorOrAdmin) {
    const bound = await isBrandPartyOf(task.id, req.user!.userId);
    if (!bound || !uploadWindowOpen(task)) {
      return res.status(403).json({ error: '无权限', code: 'FORBIDDEN' });
    }
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
    'SELECT id, creator_id, mode, status, completed_at, payout_per_herald, cost_per_herald, currency, title, lock_txn_id, upload_token, (SELECT trs.data_mode FROM task_referral_specs trs WHERE trs.task_id = tasks.id) as data_mode FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });

  // 鉴权：Bearer token（代理商家/绑定品牌方/管理员）或 upload_token（品牌专属链接）
  const uploadToken = String(req.query.token || '');
  const isTokenAuth = uploadToken && task.upload_token && uploadToken === task.upload_token;
  const isBrandParty = !!(req.user && await isBrandPartyOf(task.id, req.user.userId));
  const isBearerAuth = req.user && (req.user.userId === task.creator_id || req.user.role === 'ADMIN' || isBrandParty);
  if (!isTokenAuth && !isBearerAuth) return res.status(403).json({ error: '无权限' });

  if (task.mode !== 'PERFORMANCE') return res.status(400).json({ error: '只有成果报酬任务支持数据上传' });

  // 生命周期闸门：进行中或关闭后 30 天缓冲期内可收数；此前无此检查——已关闭任务凭 token 仍能触发结算（口子，2026-07-17 堵）
  if (!uploadWindowOpen(task)) {
    return res.status(400).json({ error: '任务已关闭且超过 30 天数据缓冲期，不再接收数据', code: 'TASK_CLOSED' });
  }

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
          variables: { task: task.title, code, reg: newRegCount, used: newUsedCount },
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
      variables: { task: task.title, code, conversions: delta, amount: paidAmount },
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
        variables: { task: task.title, code, conversions: delta, amount: paidAmount },
        metadata: { taskId: task.id, taskTitle: task.title, code, conversions: delta, amount: paidAmount, reg: counts?.registered_count, used: counts?.used_count },
      }).catch((e) => console.error('[notify] CONVERSION_SETTLED failed:', e));
    } else if (delta === 0) {
      await notify({
        userId: at.herald_id, targetRole: 'HERALD', type: 'CONVERSION_UPDATED',
        variables: { task: task.title, code, reg: counts?.registered_count || 0, used: counts?.used_count || 0 },
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

/** GET /api/tasks/:id/applications — 任务报名列表（仅创建者/管理员） */
tasksRouter.get('/:id/applications', requireAuth, async (req: Request, res: Response) => {
  const task = await findOne<{ creator_id: string }>('SELECT creator_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }
  res.json(await fetchTaskApplications(String(req.params.id)));
});

/** PATCH /api/tasks/:id/publish — 发布任务 */
tasksRouter.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  const lang = typeof req.query.lang === 'string' ? req.query.lang : null;
  const task = await findOne<any>(
    `SELECT t.*, u.nickname as creator_name,
            bp.logo_url as brand_logo_url, bp.promo_image_url as brand_promo_image_url,
            bp.company_name as brand_company_name, bp.company_desc as brand_company_desc,
            (SELECT COUNT(*)::int FROM task_applications ta WHERE ta.task_id = t.id AND ta.status = 'APPROVED') as approved_count,
            (SELECT ROUND(AVG(score),1) FROM task_ratings tr WHERE tr.task_id = t.id) as avg_rating,
            (SELECT COUNT(*)::int FROM task_ratings tr WHERE tr.task_id = t.id) as rating_count,
            (SELECT CASE WHEN COUNT(*) >= 5
               THEN NULLIF(ROUND(AVG(EXTRACT(EPOCH FROM (ts.reviewed_at::timestamp - ts.submitted_at::timestamp)) / 86400)), 0)
               ELSE NULL END
             FROM task_submissions ts
             JOIN tasks t2 ON t2.id = ts.task_id
             LEFT JOIN task_content_specs tcs2 ON tcs2.task_id = t2.id
             WHERE t2.creator_id = t.creator_id
               AND tcs2.content_type IS NOT DISTINCT FROM tcs.content_type
               AND ts.status = 'APPROVED'
               AND ts.reviewed_at IS NOT NULL) as avg_payout_days,
            tcs.content_type as content_type,
            tcs.min_images as min_images,
            tcs.min_video_seconds as min_video_seconds,
            tcs.max_revisions as max_revisions,
            tcs.require_proposal as require_proposal,
            tcs.require_draft_review as require_draft_review,
            tcs.submit_deadline as submit_deadline,
            trs.code_mode as code_mode,
            trs.data_mode as data_mode,
            trs.conversion_criteria as conversion_criteria,
            trs.invitee_benefit as invitee_benefit,
            trs.referral_script as referral_script,
            trs.register_url as register_url
     FROM tasks t JOIN users u ON u.id = t.creator_id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     LEFT JOIN task_content_specs tcs ON tcs.task_id = t.id
     LEFT JOIN task_referral_specs trs ON trs.task_id = t.id
     WHERE t.id = ?`, [req.params.id]
  );

  if (!task) return res.status(404).json({ error: '任务不存在' });

  // 语言覆盖：有翻译时用翻译字段覆盖原文
  if (lang && lang !== 'zh') {
    const tr = await findOne<any>(
      'SELECT title, description FROM task_translations WHERE task_id = ? AND locale = ?',
      [req.params.id, lang]
    );
    if (tr) {
      if (tr.title)       task.title       = tr.title;
      if (tr.description) task.description = tr.description;
    }
  }

  // 审核门（2026-07-18；2026-07-26 改按 status 判断）：草稿/审核中任务对非创建者一律 404，防直链绕过列表过滤
  if (task.status === 'DRAFT' || task.status === 'PENDING_REVIEW') {
    const isOwnerOrAdmin = req.user && (req.user.userId === task.creator_id || req.user.role === 'ADMIN');
    if (!isOwnerOrAdmin) return res.status(404).json({ error: '任务不存在' });
  }

  // 敏感凭证只给创建者/管理员：upload_token 可直接触发结算上传/绑定品牌方
  // （修复：此前 t.* 泄露给任何访问者）
  const isOwner = req.user && (req.user.userId === task.creator_id || req.user.role === 'ADMIN');
  if (!isOwner) {
    delete task.upload_token;
  } else {
    // 品牌方绑定列表（多账号），供代理面板展示 + 逐个解绑
    task.brand_parties = await findMany<any>(
      `SELECT tbp.user_id, tbp.bound_at, u.nickname, u.email
       FROM task_brand_parties tbp JOIN users u ON u.id = tbp.user_id
       WHERE tbp.task_id = ? ORDER BY tbp.bound_at`,
      [task.id]
    );
  }

  const applications = await fetchTaskApplications(String(req.params.id));

  const subRow = await findOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM task_submissions WHERE task_id = ?', [req.params.id]
  );

  const submissionCount = subRow?.cnt || 0;

  // 非 owner：只下发已通过的报名，名字截断为前3位+***，不暴露完整身份和拒绝状态
  const publicApplications = isOwner ? applications : applications
    .filter((a: any) => a.status === 'APPROVED')
    .map((a: any) => ({
      id: a.id,
      nickname: (a.nickname || '').slice(0, 3) + '***',
      avatar_url: a.avatar_url,
      status: 'APPROVED',
    }));

  res.json({ ...task, applications: publicApplications, _count: { applications: applications.length, submissions: submissionCount } });
});

/** POST /api/tasks — 创建任务 (品牌商家) */
tasksRouter.post('/', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const data = CreateTaskSchema.parse(req.body);

    // source_lang：前端显式传 > 商家 profile 默认语言 > 兜底 zh
    const bp = await findOne<{ default_lang: string }>('SELECT default_lang FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    const sourceLang = data.sourceLang !== 'zh' ? data.sourceLang : (bp?.default_lang ?? 'zh');

    // 类型专属字段只住 spec 表（2026-07-25 用户决策：未上线不做双写，直接终态）
    const taskId = await insert('tasks', {
      creator_id:        req.user!.userId,
      mode:              data.mode,
      source_lang:       sourceLang,
      title:             data.title,
      description:       data.description,
      payout_per_herald: data.payoutPerHerald,
      currency:          'JPY',
      max_heralds:       data.maxHeralds,
      deadline:          data.deadline || null,
      category:          data.category || null,
      difficulty:        data.difficulty,
      cover_image:       data.coverImage || null,
      platform_requirements: data.platformRequirements ? JSON.stringify(data.platformRequirements) : null,
      req_mode:          data.reqMode,
      req_min_count:     data.reqMode === 'ANY_N' ? (data.reqMinCount || 1) : null,
      visibility:        data.visibility || 'PUBLIC',
      target_communities: data.targetCommunities.filter(c => VALID_COMMUNITIES.has(c)),
      site_id:           VALID_SITES.has(data.siteId) ? data.siteId : 'jp',
      service_name:      data.serviceName || null,
      status:            'DRAFT',
      // cost_per_herald 和 commission_rate 在发布时计算快照
    });

    // PERFORMANCE + 自动模式：创建时立即生成推广码池
    if (data.mode === 'PERFORMANCE' && data.codeMode === 'auto') {
      generateCodePool(taskId, data.maxHeralds);
    }

    // spec 分表 = 类型专属字段唯一权威来源
    let spec: Record<string, any>;
    if (data.mode === 'STANDARD') {
      spec = {
        content_type: data.contentType || 'photo',
        min_images: data.minImages || null,
        min_video_seconds: data.minVideoSeconds || null,
        max_revisions: data.maxRevisions ?? 2,
        require_proposal: data.requireProposal ? 1 : 0,
        require_draft_review: !!data.requireDraftReview,
        submit_deadline: data.submitDeadline || null,
      };
      await pool.query(
        `INSERT INTO task_content_specs (task_id, content_type, min_images, min_video_seconds, max_revisions, require_proposal, require_draft_review, submit_deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [taskId, spec.content_type, spec.min_images, spec.min_video_seconds, spec.max_revisions, spec.require_proposal, spec.require_draft_review, spec.submit_deadline]
      );
    } else {
      const criteria = data.conversionCriteria || { register: { label: '新用户' }, convert: [] };
      spec = {
        code_mode: data.codeMode || 'auto', data_mode: data.dataMode || 'AGGREGATE',
        conversion_criteria: criteria, invitee_benefit: data.inviteeBenefit || null,
        referral_script: data.referralScript || null, register_url: data.registerUrl || null,
      };
      await pool.query(
        `INSERT INTO task_referral_specs (task_id, code_mode, data_mode, conversion_criteria, invitee_benefit, referral_script, register_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [taskId, spec.code_mode, spec.data_mode, JSON.stringify(criteria), spec.invitee_benefit, spec.referral_script, spec.register_url]
      );
    }

    // 响应形状保持不变：spec 字段合并进任务对象（线上旧客户端读同样的 JSON 键）
    const task = await findOne<any>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    res.status(201).json({ ...task, ...spec });
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
  const task = await findOne<any>('SELECT id, creator_id, status, mode FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') return res.status(403).json({ error: '无权限' });
  if (task.status !== 'DRAFT') return res.status(400).json({ error: '只有草稿可以编辑' });

  const { title, description, payoutPerHerald, maxHeralds, deadline, category, contentType, difficulty, coverImage, platformRequirements, visibility, reqMode, reqMinCount } = req.body;
  const data: Record<string, any> = {};
  if (title) data.title = title;
  if (description) data.description = description;
  if (payoutPerHerald) data.payout_per_herald = payoutPerHerald;
  if (maxHeralds) data.max_heralds = maxHeralds;
  if (deadline !== undefined) data.deadline = deadline || null;
  if (category !== undefined) data.category = category;
  if (difficulty) data.difficulty = difficulty;
  if (coverImage !== undefined) data.cover_image = coverImage || null;
  if (platformRequirements !== undefined) {
    const badPid = badPlatformReq(platformRequirements);
    if (badPid) return res.status(400).json({ error: `未知社交平台：${badPid}`, code: 'UNKNOWN_PLATFORM' });
    data.platform_requirements = platformRequirements ? JSON.stringify(platformRequirements) : null;
  }
  if (visibility && ['PUBLIC', 'INVITE'].includes(visibility)) data.visibility = visibility;
  if (req.body.targetCommunities !== undefined) {
    data.target_communities = (req.body.targetCommunities as string[]).filter(c => VALID_COMMUNITIES.has(c));
  }
  if (req.body.siteId !== undefined && VALID_SITES.has(req.body.siteId)) {
    data.site_id = req.body.siteId;
  }
  if (req.body.serviceName !== undefined) data.service_name = req.body.serviceName || null;
  if (reqMode && ['ALL', 'ANY_N'].includes(reqMode)) {
    data.req_mode = reqMode;
    data.req_min_count = reqMode === 'ANY_N' ? Math.max(1, parseInt(String(reqMinCount || 1), 10)) : null;
  }
  await update('tasks', data, 'id = ?', [req.params.id]);

  // 类型专属字段只写 spec 表（终态，无双写）。传了才更新，未传保持原值
  if (task.mode === 'STANDARD') {
    const sets: string[] = []; const vals: any[] = [];
    const push = (col: string, v: any) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (req.body.contentType) push('content_type', req.body.contentType);
    if (req.body.minImages !== undefined) push('min_images', req.body.minImages || null);
    if (req.body.minVideoSeconds !== undefined) push('min_video_seconds', req.body.minVideoSeconds || null);
    if (req.body.maxRevisions !== undefined) push('max_revisions', req.body.maxRevisions ?? 2);
    if (req.body.requireProposal !== undefined) push('require_proposal', req.body.requireProposal ? 1 : 0);
    if (req.body.requireDraftReview !== undefined) push('require_draft_review', !!req.body.requireDraftReview);
    if (req.body.submitDeadline !== undefined) push('submit_deadline', req.body.submitDeadline || null);
    if (sets.length) {
      vals.push(req.params.id);
      await pool.query(`UPDATE task_content_specs SET ${sets.join(', ')} WHERE task_id = $${vals.length}`, vals);
    }
  } else if (task.mode === 'PERFORMANCE') {
    // 邀请任务 spec：数据模式 + 展示字段（转化条件/激励/话术）草稿期可改
    const rvals: any[] = []; const rsets: string[] = [];
    const rpush = (col: string, v: any) => { rvals.push(v); rsets.push(`${col} = $${rvals.length}`); };
    if (req.body.dataMode && ['AGGREGATE', 'DETAIL'].includes(req.body.dataMode)) rpush('data_mode', req.body.dataMode);
    if (req.body.conversionCriteria !== undefined) rpush('conversion_criteria', JSON.stringify(req.body.conversionCriteria));
    if (req.body.inviteeBenefit !== undefined) rpush('invitee_benefit', req.body.inviteeBenefit || null);
    if (req.body.referralScript !== undefined) rpush('referral_script', req.body.referralScript || null);
    if (req.body.registerUrl !== undefined) rpush('register_url', req.body.registerUrl || null);
    if (rsets.length) {
      rvals.push(req.params.id);
      await pool.query(`UPDATE task_referral_specs SET ${rsets.join(', ')} WHERE task_id = $${rvals.length}`, rvals);
    }
  }

  const updated = await findOne<any>('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  const specRow = task.mode === 'STANDARD'
    ? await findOne<any>('SELECT content_type, min_images, min_video_seconds, max_revisions, require_proposal, require_draft_review, submit_deadline FROM task_content_specs WHERE task_id = ?', [req.params.id])
    : await findOne<any>('SELECT code_mode, data_mode FROM task_referral_specs WHERE task_id = ?', [req.params.id]);
  res.json({ ...updated, ...(specRow || {}) });
});

/** PATCH /api/tasks/:id/meta — 已发布任务的有限字段编辑 */
tasksRouter.patch('/:id/meta', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<{ id: string; creator_id: string; status: string; max_heralds: number; mode: string }>(
    'SELECT id, creator_id, status, max_heralds, mode FROM tasks WHERE id = ?', [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '无权限' });
  }
  if (!['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(task.status)) {
    return res.status(400).json({ error: '只有进行中的任务可以编辑' });
  }

  const { title, description, deadline, coverImage, platformRequirements, maxHeralds, reqMode, reqMinCount, conversionCriteria, inviteeBenefit, referralScript } = req.body;
  const data: Record<string, any> = {};
  if (title) data.title = title;
  if (description !== undefined) data.description = description;
  if (req.body.serviceName !== undefined) data.service_name = req.body.serviceName || null;
  if (deadline !== undefined) data.deadline = deadline || null;
  if (coverImage !== undefined) data.cover_image = coverImage || null;
  if (platformRequirements !== undefined) {
    const badPid = badPlatformReq(platformRequirements);
    if (badPid) return res.status(400).json({ error: `未知社交平台：${badPid}`, code: 'UNKNOWN_PLATFORM' });
    data.platform_requirements = platformRequirements ? JSON.stringify(platformRequirements) : null;
  }
  if (reqMode && ['ALL', 'ANY_N'].includes(reqMode)) {
    data.req_mode = reqMode;
    data.req_min_count = reqMode === 'ANY_N' ? Math.max(1, parseInt(String(reqMinCount || 1), 10)) : null;
  }
  // 名额只允许增加
  if (maxHeralds !== undefined) {
    if (maxHeralds < task.max_heralds) return res.status(400).json({ error: '名额不能减少' });
    data.max_heralds = maxHeralds;
  }

  // PERFORMANCE 展示字段（转化条件/激励/话术）OPEN 后也可改——纯展示文案，不影响已分码/已结算
  const rvals: any[] = []; const rsets: string[] = [];
  if (task.mode === 'PERFORMANCE') {
    const rpush = (col: string, v: any) => { rvals.push(v); rsets.push(`${col} = $${rvals.length}`); };
    if (conversionCriteria !== undefined) rpush('conversion_criteria', JSON.stringify(conversionCriteria));
    if (inviteeBenefit !== undefined) rpush('invitee_benefit', inviteeBenefit || null);
    if (referralScript !== undefined) rpush('referral_script', referralScript || null);
  }

  if (!Object.keys(data).length && !rsets.length) return res.status(400).json({ error: '没有可更新的字段' });

  if (Object.keys(data).length) await update('tasks', data, 'id = ?', [req.params.id]);
  if (rsets.length) {
    rvals.push(req.params.id);
    await pool.query(`UPDATE task_referral_specs SET ${rsets.join(', ')} WHERE task_id = $${rvals.length}`, rvals);
  }
  const updated = await findOne<any>('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);

  // description 变更时触发重译，hash 兜底：纯标点/格式改动不调 API
  if (description !== undefined && updated) {
    translateTask(String(updated.id), String(updated.title ?? ''), String(updated.description ?? ''), updated.source_lang ?? 'zh', updated.target_communities ?? []).catch(() => {});
  }
});

/** GET /api/tasks/:id/codes — 推广码池概览（商家用） */
tasksRouter.patch('/:id/publish', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  const task = await findOne<any>(
    'SELECT id, creator_id, status, mode, payout_per_herald, currency, max_heralds, title, description, source_lang, target_communities, trial_credit_amount, cover_image FROM tasks WHERE id = ?',
    [req.params.id]
  );
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: '只有创建者可以发布' });
  }
  if (task.status !== 'DRAFT') {
    return res.status(400).json({ error: '只有草稿状态可以发布' });
  }
  // 封面闸（2026-07-29 用户决策：所有任务类型发布必须有封面图；草稿不强制）——
  // 赫使侧任务卡/详情/落地页均以封面为第一视觉，无封面任务转化差且拉低列表观感
  if (!task.cover_image) {
    return res.status(400).json({ error: '请先上传任务封面图再发布', code: 'COVER_REQUIRED' });
  }

  // 并发数闸（四级阶梯：注册/KYB/注资/订阅，两种任务类型都计数）。
  // 资金敞口由报名批准闸兜底，这里防"0报名空任务无限刷屏"；402 文案即升级引导
  const pubLimit = await getPublishLimitInfo(task.creator_id);
  if (pubLimit.limit !== null && pubLimit.current >= pubLimit.limit) {
    const nextHint = !pubLimit.kybApproved
      ? `完成企业认证可提升至 ${pubLimit.kybLimit} 个`
      : !pubLimit.funded
        ? `累计充值满 ¥${pubLimit.fundedThreshold.toLocaleString()} 可提升至 ${pubLimit.fundedLimit} 个`
        : '订阅营销顾问服务可不限数量发布';
    return res.status(402).json({
      error: `同时进行中的任务已达上限（${pubLimit.current}/${pubLimit.limit}），完成或关闭现有任务后再发布。${nextHint}`,
      code: 'OPEN_TASKS_LIMIT',
      current: pubLimit.current,
      limit: pubLimit.limit,
      tier: pubLimit.tier,
    });
  }

  // 发布时计算费率快照和单人成本（含服务费）
  const { rate: commissionRate } = await getEffectiveCommissionRate(task.creator_id);
  const costPerHerald = Math.round(task.payout_per_herald * (1 + commissionRate));

  const creditInfo  = await getBrandCreditInfo(task.creator_id);

  // 服务端容量闸 + 首单体验额度（STANDARD 任务；PERFORMANCE 按转化付费不占额度）。
  // 此前只有前端预检，绕过前端可无限发布未注资任务（2026-07-18 补上）。
  // 体验额度 = min(配置额度, 任务总成本) 盖戳在任务行上，只对本任务生效——
  // 审核驳回回 DRAFT 再发布时戳还在（trialGrant 分支一），不算重新发放。
  let trialGrant = 0;
  let stampTrial = false;
  if (task.mode === 'STANDARD') {
    const totalCost = costPerHerald * Number(task.max_heralds || 0);
    if (Number(task.trial_credit_amount) > 0) {
      trialGrant = Number(task.trial_credit_amount);
    } else if (creditInfo.trialEligible) {
      trialGrant = Math.min(creditInfo.trialDefault, totalCost);
      stampTrial = trialGrant > 0;
    }
    if (totalCost > creditInfo.totalCapacity + trialGrant) {
      const cap = creditInfo.totalCapacity + trialGrant;
      // 报错带具体数字（2026-07-26 用户反馈"告诉差多少更友好"）
      return res.status(402).json({
        error: `额度不足：本任务需 ¥${totalCost.toLocaleString()}，当前可发布额度 ¥${cap.toLocaleString()}`
          + `${trialGrant > 0 ? '（含首单体验额度）' : ''}，还差 ¥${(totalCost - cap).toLocaleString()}，请充值后再发布`,
        code: 'INSUFFICIENT_CREDIT',
        needed: totalCost,
        shortfall: totalCost - cap,
        creditInfo: {
          totalCapacity: cap,
          creditUsed: creditInfo.creditUsed,
        },
      });
    }
  }

  const fpThreshold = Number(await getSetting('fast_payout_threshold')) || 100000;
  const fast_payout = creditInfo.availableBalance >= fpThreshold;
  const uploadToken = crypto.randomBytes(16).toString('hex');

  // 首任务审核门（2026-07-18，PRD §29；2026-07-19 gate 从 is_enterprise_verified 合并进 kyb_status）：
  // 未通过 KYB(kyb_status!=='approved') 的商家，发布的任务须平台审核后才进公开列表——
  // 防恶意注册用任务做钓鱼/违规内容载体。
  // 2026-07-26：审核态从 OPEN+platform_review 正交列改为真状态 PENDING_REVIEW（额度照常占用），
  // admin 审核通过才转 OPEN 并刷新 published_at 为进入公开时间；此前报名闸只看 status，未过审任务可被报名
  const bpRow = await findOne<any>('SELECT kyb_status FROM brand_profiles WHERE user_id = ?', [task.creator_id]);
  const needsReview = req.user!.role !== 'ADMIN' && bpRow?.kyb_status !== 'approved';

  await update('tasks', {
    status:               needsReview ? 'PENDING_REVIEW' : 'OPEN',
    published_at:         new Date().toISOString(),
    cost_per_herald:      costPerHerald,
    commission_rate:      commissionRate,
    fast_payout,
    upload_token:         uploadToken,
    platform_review:      needsReview ? 'pending' : 'approved',
    platform_review_note: null,
    translation_status:   'pending',
    translation_attempts: 0,
    ...(stampTrial ? { trial_credit_amount: trialGrant } : {}),
  }, 'id = ?', [req.params.id]);

  // 通知商家发布结果
  if (needsReview) {
    const brandUser = await findOne<any>('SELECT id, email FROM users WHERE id = ?', [task.creator_id]);
    if (brandUser) {
      notify({
        userId: brandUser.id,
        email: brandUser.email,
        targetRole: 'BRAND',
        type: 'TASK_PENDING_REVIEW',
        variables: { task: task.title },
        metadata: { taskId: req.params.id },
      }).catch((e) => console.error('[notify] TASK_PENDING_REVIEW failed:', e));
    }
  }

  // 体验额度发放标记（一次性）：记下发放去向，之后不再有资格
  if (stampTrial) {
    await pool.query(
      'UPDATE brand_profiles SET trial_task_id = $1 WHERE user_id = $2',
      [req.params.id, task.creator_id],
    );
  }

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
    reviewPending: needsReview,
    ...(isFirstPublish ? {
      // 前端用 merchant.publish.topupReminder 词条渲染三语版本，此文案是兜底
      topupReminder: '任务发布成功。赫使完成任务后，报酬打款需要钱包有真实余额——请在赫使交付前完成充值，以免打款延迟。提前充值任务还会带上「极速打款」标签，赫使报名更积极。',
    } : {}),
  });

  // fire-and-forget：翻译不阻塞发布响应
  translateTask(String(req.params.id), String(task.title ?? ''), String(task.description ?? ''), task.source_lang ?? 'zh', task.target_communities ?? []).catch(() => {});
});

// /escrow 端点已废弃，资金锁定在 /publish 时自动完成

/** PATCH /api/tasks/:id/complete — 完成/关闭任务 */
tasksRouter.patch('/:id/complete', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const task = await findOne<any>('SELECT id, creator_id, title, mode FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator_id !== req.user!.userId) return res.status(403).json({ error: '无权限' });

  const completedAt = new Date().toISOString();
  await update('tasks', { status: 'COMPLETED', completed_at: completedAt }, 'id = ?', [req.params.id]);

  // 推广任务关闭 → 通知全部持码赫使：还有 30 天数据缓冲期，抓紧催邀请用户转化（站内信三语 + 邮件）
  if (task.mode === 'PERFORMANCE') {
    const deadline = new Date(new Date(completedAt).getTime() + GRACE_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
    const holders = await findMany<any>(
      `SELECT at.herald_id, at.unique_code, u.email FROM ambassador_tasks at JOIN users u ON u.id = at.herald_id WHERE at.task_id = ?`,
      [task.id]
    );
    for (const h of holders) {
      await notify({
        userId: h.herald_id,
        email: h.email || null,
        targetRole: 'HERALD',
        type: 'TASK_CLOSING',
        variables: { task: task.title, deadline },
        metadata: { taskId: task.id, taskTitle: task.title, code: h.unique_code, date: deadline },
      }).catch((e) => console.error('[notify] TASK_CLOSING failed:', e));
    }
    console.log(`[task-complete] task=${task.id} notified=${holders.length} graceUntil=${deadline}`);
  }

  const updated = await findOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(updated);
});
