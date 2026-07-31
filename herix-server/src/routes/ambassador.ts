import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth } from '../middleware/auth';
import { calcTier } from '../types';
import { isContactPlatform, socialPlatformMeta, SOCIAL_PLATFORM_IDS } from '../shared/contracts';
import { VALID_COMMUNITIES } from '../constants/communities';

/** 根据 social_platforms JSON 计算各平台段位快照 */
// 联系类平台(微信/LINE等)的数字是"好友数"而非公开粉丝，不代表 KOL 影响力，不参与段位计算。
// isContactPlatform 来自共享契约，加平台无需改这里（2026-07-29）
function buildTierSnapshot(socialPlatforms: any[]): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const p of socialPlatforms) {
    if (p.followers != null && p.platformId && !isContactPlatform(p.platformId)) {
      snapshot[p.platformId] = calcTier(Number(p.followers));
    }
  }
  return snapshot;
}

export const ambassadorRouter = Router();

/** GET /api/ambassador/status — 检查大使身份状态 */
ambassadorRouter.get('/profile', requireAuth, async (req: Request, res: Response) => {
  const profile = await findOne<any>('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
  res.json(profile || null);
});

ambassadorRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  const profile = await findOne<any>(
    'SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]
  );

  if (!profile) {
    return res.json({ registered: false, canApply: false, reason: '请先完善个人资料' });
  }

  const status = {
    registered: true,
    residence: profile.residence || null,
    residenceCountry: profile.residence_country || null,
    kycStatus: profile.kyc_status || 'pending',
    declarationStatus: profile.declaration_status || 'pending',
    visaType: profile.visa_type || null,
    canApply: true,
    requirements: [] as string[],
  };

  // 居住地未设置 → 不能申请
  if (!profile.residence) {
    status.canApply = false;
    status.requirements.push('请设置居住地');
  }

  // KYC 未通过 → 不能申请
  if (profile.kyc_status !== 'approved') {
    status.canApply = false;
    status.requirements.push('请完成身份核验（KYC）');
  }

  // 在日赫使 → 需要提交在留资格声明
  if (profile.residence === 'japan' && profile.declaration_status !== 'approved' && profile.declaration_status !== 'exempt') {
    status.canApply = false;
    status.requirements.push('请提交在留资格声明');
  }

  res.json(status);
});

/** PATCH /api/ambassador/profile — 更新大使身份 */
ambassadorRouter.patch('/profile', requireAuth, async (req: Request, res: Response) => {
  const { residence, residenceCountry, kycStatus, visaType, bankAccount, socialPlatforms, community } = req.body;

  const data: Record<string, any> = {};
  if (residence) {
    // 枚举校验：曾出现前端把显示串("🇨🇳 中国")整个写进来的脏数据，这里挡死。
    // 取值域为 onboard(japan/overseas) 与收款地区(china) 的并集
    if (!['japan', 'china', 'overseas'].includes(residence)) {
      return res.status(400).json({ error: 'residence 取值无效，允许: japan / china / overseas', code: 'INVALID_RESIDENCE' });
    }
    data.residence = residence;
  }
  if (residenceCountry) data.residence_country = residenceCountry;
  if (kycStatus) data.kyc_status = kycStatus;
  if (visaType) data.visa_type = visaType;
  if (bankAccount) data.bank_account = JSON.stringify(bankAccount);
  if (socialPlatforms !== undefined) {
    // platformId 必须在注册表内，挡掉非法/拼错的平台进档案（否则永远匹配不上任务要求）
    const bad = (Array.isArray(socialPlatforms) ? socialPlatforms : []).find((p: any) => p?.platformId && !socialPlatformMeta(p.platformId));
    if (bad) return res.status(400).json({ error: `未知社交平台：${bad.platformId}`, code: 'UNKNOWN_PLATFORM' });
    data.social_platforms = JSON.stringify(socialPlatforms);
    data.tier_snapshot = JSON.stringify(buildTierSnapshot(socialPlatforms));
    data.social_platforms_updated_at = new Date().toISOString();
  }
  if (community !== undefined) {
    data.community = community && VALID_COMMUNITIES.has(community) ? community : null;
  }

  // 查找或创建 profile
  const existing = await findOne<{ id: string }>(
    'SELECT id FROM herald_profiles WHERE user_id = ?', [req.user!.userId]
  );

  if (existing) {
    await update('herald_profiles', data, 'user_id = ?', [req.user!.userId]);
  } else {
    await insert('herald_profiles', { user_id: req.user!.userId, display_name: '', ...data });
  }

  const profile = await findOne('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
  res.json(profile);
});

/** POST /api/ambassador/declaration — 提交在留资格声明（在日赫使） */
ambassadorRouter.post('/declaration', requireAuth, async (req: Request, res: Response) => {
  const { visaType, hasWorkPermit, workPermitHours } = req.body;

  if (!visaType) {
    return res.status(400).json({ error: '请选择在留资格类型' });
  }

  // 检查是否已提交过
  const existing = await findOne<{ id: string }>(
    "SELECT id FROM declarations WHERE user_id = ? AND status = 'pending'",
    [req.user!.userId]
  );
  if (existing) {
    return res.status(409).json({ error: '已有待审核的声明' });
  }

  const id = await insert('declarations', {
    user_id: req.user!.userId,
    visa_type: visaType,
    has_work_permit: hasWorkPermit ? 1 : 0,
    work_permit_hours_per_week: workPermitHours || null,
  });

  // 更新 profile 状态
  await update('herald_profiles', {
    visa_type: visaType,
    declaration_status: 'submitted',
    declaration_submitted_at: new Date().toISOString(),
  }, 'user_id = ?', [req.user!.userId]);

  const decl = await findOne('SELECT * FROM declarations WHERE id = ?', [id]);
  res.status(201).json(decl);
});

/** POST /api/ambassador/onboard — 一次性完成大使入驻 */
ambassadorRouter.post('/onboard', requireAuth, async (req: Request, res: Response) => {
  const { residence, residenceCountry, visaType, hasWorkPermit, bankAccountType, bankDetails, socialPlatforms, community } = req.body;

  // 居住地选填：有就保存，没有也能完成入驻
  const profileData: Record<string, any> = {
    is_onboarded: 1,
    social_platforms: socialPlatforms ? JSON.stringify(socialPlatforms) : null,
    tier_snapshot: socialPlatforms ? JSON.stringify(buildTierSnapshot(socialPlatforms)) : null,
    social_platforms_updated_at: socialPlatforms ? new Date().toISOString() : null,
  };
  if (community && VALID_COMMUNITIES.has(community)) profileData.community = community;

  if (residence && ['japan', 'overseas'].includes(residence)) {
    profileData.residence = residence;
    profileData.residence_country = residenceCountry || null;
    profileData.bank_account = bankDetails ? JSON.stringify({ type: bankAccountType, ...bankDetails }) : null;

    if (residence === 'japan') {
      if (visaType) {
        profileData.visa_type = visaType;
        profileData.kyc_status = 'pending';
        profileData.declaration_status = 'submitted';
        profileData.declaration_submitted_at = new Date().toISOString();

        const existing = await findOne<{ id: string }>(
          'SELECT id FROM declarations WHERE user_id = ?', [req.user!.userId]
        );
        if (!existing) {
          await insert('declarations', {
            user_id: req.user!.userId,
            visa_type: visaType,
            has_work_permit: hasWorkPermit ? 1 : 0,
            work_permit_hours_per_week: req.body.workPermitHours || null,
            status: 'pending',
          });
        }
      }
    } else {
      profileData.kyc_status = 'approved';
      profileData.declaration_status = 'exempt';
    }
  }

  await update('herald_profiles', profileData, 'user_id = ?', [req.user!.userId]);

  const profile = await findOne('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
  res.json({ success: true, profile });
});

/** POST /api/ambassador/declaration/:id/review — 审核声明（Admin） */
ambassadorRouter.post('/declaration/:id/review', requireAuth, async (req: Request, res: Response) => {
  const { status, reason } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '状态必须是 approved 或 rejected' });
  }

  const decl = await findOne<{ id: string; user_id: string; status: string }>(
    'SELECT id, user_id FROM declarations WHERE id = ?', [req.params.id]
  );
  if (!decl) return res.status(404).json({ error: '声明不存在' });
  if (decl.status !== 'pending') return res.status(400).json({ error: '该声明已审核' });

  await update('declarations', {
    status,
    reviewed_at: new Date().toISOString(),
  }, 'id = ?', [req.params.id]);

  // 同步更新 profile
  const declStatus = status === 'approved' ? 'approved' : 'pending';
  await update('herald_profiles', { declaration_status: declStatus }, 'user_id = ?', [decl.user_id]);

  const updated = await findOne('SELECT * FROM declarations WHERE id = ?', [req.params.id]);
  res.json(updated);
});
