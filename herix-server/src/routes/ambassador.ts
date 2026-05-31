import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth } from '../middleware/auth';

export const ambassadorRouter = Router();

/** GET /api/ambassador/status — 检查大使身份状态 */
ambassadorRouter.get('/status', requireAuth, (req: Request, res: Response) => {
  const profile = findOne<any>(
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
ambassadorRouter.patch('/profile', requireAuth, (req: Request, res: Response) => {
  const { residence, residenceCountry, kycStatus, visaType, bankAccount } = req.body;

  const data: Record<string, any> = {};
  if (residence) data.residence = residence;
  if (residenceCountry) data.residence_country = residenceCountry;
  if (kycStatus) data.kyc_status = kycStatus;
  if (visaType) data.visa_type = visaType;
  if (bankAccount) data.bank_account = JSON.stringify(bankAccount);

  // 查找或创建 profile
  const existing = findOne<{ id: string }>(
    'SELECT id FROM herald_profiles WHERE user_id = ?', [req.user!.userId]
  );

  if (existing) {
    update('herald_profiles', data, 'user_id = ?', [req.user!.userId]);
  } else {
    insert('herald_profiles', { user_id: req.user!.userId, display_name: '', ...data });
  }

  const profile = findOne('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
  res.json(profile);
});

/** POST /api/ambassador/declaration — 提交在留资格声明（在日赫使） */
ambassadorRouter.post('/declaration', requireAuth, (req: Request, res: Response) => {
  const { visaType, hasWorkPermit, workPermitHours } = req.body;

  if (!visaType) {
    return res.status(400).json({ error: '请选择在留资格类型' });
  }

  // 检查是否已提交过
  const existing = findOne<{ id: string }>(
    "SELECT id FROM declarations WHERE user_id = ? AND status = 'pending'",
    [req.user!.userId]
  );
  if (existing) {
    return res.status(409).json({ error: '已有待审核的声明' });
  }

  const id = insert('declarations', {
    user_id: req.user!.userId,
    visa_type: visaType,
    has_work_permit: hasWorkPermit ? 1 : 0,
    work_permit_hours_per_week: workPermitHours || null,
  });

  // 更新 profile 状态
  update('herald_profiles', {
    visa_type: visaType,
    declaration_status: 'submitted',
    declaration_submitted_at: new Date().toISOString(),
  }, 'user_id = ?', [req.user!.userId]);

  const decl = findOne('SELECT * FROM declarations WHERE id = ?', [id]);
  res.status(201).json(decl);
});

/** POST /api/ambassador/onboard — 一次性完成大使入驻 */
ambassadorRouter.post('/onboard', requireAuth, (req: Request, res: Response) => {
  const { residence, residenceCountry, visaType, hasWorkPermit, bankAccountType, bankDetails } = req.body;

  if (!residence || !['japan', 'overseas'].includes(residence)) {
    return res.status(400).json({ error: '请选择居住地（japan 或 overseas）' });
  }

  const profileData: Record<string, any> = {
    residence,
    residence_country: residenceCountry || null,
    is_onboarded: 1,
    bank_account: bankDetails ? JSON.stringify({ type: bankAccountType, ...bankDetails }) : null,
  };

  if (residence === 'japan') {
    if (!visaType) return res.status(400).json({ error: '在日赫使请选择在留资格类型' });
    profileData.visa_type = visaType;
    profileData.kyc_status = 'pending';
    profileData.declaration_status = 'submitted';
    profileData.declaration_submitted_at = new Date().toISOString();

    // 记录声明
    const existing = findOne<{ id: string }>(
      "SELECT id FROM declarations WHERE user_id = ?", [req.user!.userId]
    );
    if (!existing) {
      insert('declarations', {
        user_id: req.user!.userId,
        visa_type: visaType,
        has_work_permit: hasWorkPermit ? 1 : 0,
        work_permit_hours_per_week: req.body.workPermitHours || null,
        status: 'pending',
      });
    }
  } else {
    // 海外大使：MVP 简化，直接通过
    profileData.kyc_status = 'approved';
    profileData.declaration_status = 'exempt';
  }

  update('herald_profiles', profileData, 'user_id = ?', [req.user!.userId]);

  const profile = findOne('SELECT * FROM herald_profiles WHERE user_id = ?', [req.user!.userId]);
  res.json({ success: true, profile });
});

/** POST /api/ambassador/declaration/:id/review — 审核声明（Admin） */
ambassadorRouter.post('/declaration/:id/review', requireAuth, (req: Request, res: Response) => {
  const { status, reason } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '状态必须是 approved 或 rejected' });
  }

  const decl = findOne<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM declarations WHERE id = ?', [req.params.id]
  );
  if (!decl) return res.status(404).json({ error: '声明不存在' });
  if (decl.status !== 'pending') return res.status(400).json({ error: '该声明已审核' });

  update('declarations', {
    status,
    reviewed_at: new Date().toISOString(),
  }, 'id = ?', [req.params.id]);

  // 同步更新 profile
  const declStatus = status === 'approved' ? 'approved' : 'pending';
  update('herald_profiles', { declaration_status: declStatus }, 'user_id = ?', [decl.user_id]);

  const updated = findOne('SELECT * FROM declarations WHERE id = ?', [req.params.id]);
  res.json(updated);
});
