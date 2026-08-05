import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth';
import { runKybAutoChecks, qualifiesForAutoApprove } from '../utils/kyb';
import { getSetting, getEffectiveCommissionRate } from '../utils/settings';
import { createNotification } from './notifications';

export const brandsRouter = Router();

/** GET /api/brands/budget-config — 商家端预算估算配置（费率为该商家实际协议价，
 *  数值在 platform_settings 维护；仅用于前端估算展示，非结算依据）
 *  ⚠️ 必须注册在 GET /:userId 之前，防止被参数路由吃掉 */
brandsRouter.get('/budget-config', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  const { rate } = await getEffectiveCommissionRate(req.user!.userId);
  const consumptionTaxRate = Number(await getSetting('consumption_tax_rate')) || 0.10;
  const avgConversionsPerCode = Number(await getSetting('referral_avg_conversions_per_code')) || 1;
  const maxCustomCodesPerUpload = Number(await getSetting('max_custom_codes_per_upload')) || 2000;
  res.json({ platformFeeRate: rate, consumptionTaxRate, avgConversionsPerCode, maxCustomCodesPerUpload });
});

/** POST /api/brands/kyb — 结构化提交企业认证（2026-07-29 流程化改造）
 *  取代"传图即提交"：公司名/注册国/法人番号 + 证件图 URL 一起提交，
 *  提交时跑自动核验（校验位恒开；国税厅名称比对需 HOUJIN_API_ID）；
 *  核验全过 + admin 开了 kyb_auto_approve 才自动通过，否则带核验结果进人工队列。
 *  ⚠️ 必须注册在 GET /:userId 之前，防止路径被参数路由吃掉 */
brandsRouter.post('/kyb', requireAuth, requireRole('BRAND'), async (req: Request, res: Response) => {
  try {
    const { companyName, country, corporateNumber, docUrl } = req.body as {
      companyName?: string; country?: string; corporateNumber?: string; docUrl?: string;
    };
    if (!companyName?.trim()) return res.status(400).json({ error: '请填写公司名称', code: 'COMPANY_NAME_REQUIRED' });
    if (!docUrl?.trim()) return res.status(400).json({ error: '请先上传证件（登記簿謄本/营业执照）', code: 'DOC_REQUIRED' });

    const bp = await findOne<any>('SELECT kyb_status FROM brand_profiles WHERE user_id = ?', [req.user!.userId]);
    if (!bp) return res.status(404).json({ error: '商家档案不存在' });
    if (bp.kyb_status === 'approved') return res.status(400).json({ error: '已通过认证，无需重复提交', code: 'ALREADY_APPROVED' });
    if (bp.kyb_status === 'pending') return res.status(409).json({ error: '已有认证申请在审核中', code: 'ALREADY_PENDING' });

    // 日本公司填了法人番号先做格式硬校验（校验位不过直接打回，不产生提交记录）
    const num = (corporateNumber || '').replace(/[^\d]/g, '');
    const checks = await runKybAutoChecks({ corporateNumber: num, companyName, country });
    if (num && checks.checksumValid === false) {
      return res.status(400).json({
        error: '法人番号校验位不符，请核对后重新输入（13位，来自登記簿謄本或国税厅法人番号公表サイト）',
        code: 'CORPORATE_NUMBER_INVALID',
      });
    }

    const submittedAt = new Date().toISOString();
    const autoApproveEnabled = (await getSetting('kyb_auto_approve')) === '1';
    const autoApproved = autoApproveEnabled && qualifiesForAutoApprove(checks);
    const status = autoApproved ? 'approved' : 'pending';

    await insert('kyb_submissions', {
      user_id: req.user!.userId, doc_url: docUrl, status,
      company_name: companyName.trim(), country: country || null,
      corporate_number: num || null, auto_checks: JSON.stringify(checks),
      submitted_at: submittedAt,
      ...(autoApproved ? { reviewed_at: submittedAt, note: '自动通过：法人番号校验+国税厅名称比对一致' } : {}),
    });
    await update('brand_profiles', {
      company_name: companyName.trim(),
      kyb_doc_url: docUrl, kyb_status: status, kyb_note: null, kyb_submitted_at: submittedAt,
    }, 'user_id = ?', [req.user!.userId]);

    if (autoApproved) {
      await createNotification({
        userId: req.user!.userId, type: 'KYB_APPROVED', targetRole: 'BRAND',
        title: '企业认证通过',
        body: '法人番号与国税厅登记信息核验一致，企业认证已自动通过。此后发布的任务免平台审核直接上线。',
      });
    }
    res.json({ success: true, kybStatus: status, autoChecks: checks, autoApproved });
  } catch (err) {
    console.error('KYB submit error:', err);
    res.status(500).json({ error: '认证提交失败' });
  }
});

/** GET /api/brands/:userId — 公开品牌主页（无需登录） */
brandsRouter.get('/:userId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const profile = await findOne<any>(
      `SELECT u.id, u.nickname, u.created_at,
              bp.company_name, bp.company_desc, bp.website, bp.industry,
              bp.logo_url, bp.promo_image_url, bp.is_agency,
              (SELECT COUNT(*)::int FROM tasks WHERE creator_id = u.id) AS total_tasks,
              (SELECT COUNT(*)::int FROM tasks WHERE creator_id = u.id AND status = 'COMPLETED') AS completed_tasks,
              (SELECT COUNT(DISTINCT ta.herald_id)::int
               FROM task_applications ta
               JOIN tasks t2 ON t2.id = ta.task_id
               WHERE t2.creator_id = u.id AND ta.status = 'APPROVED') AS total_heralds
       FROM users u
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       WHERE u.id = ? AND bp.is_onboarded = 1`,
      [userId]
    );

    if (!profile) return res.status(404).json({ error: 'brand_not_found', code: 'BRAND_NOT_FOUND' });

    const tasks = await findMany<any>(
      `SELECT t.*, u.nickname AS creator_name,
              bp.logo_url AS brand_logo_url,
              bp.promo_image_url AS brand_promo_image_url,
              (SELECT ROUND(AVG(score)::numeric, 1) FROM task_ratings tr WHERE tr.task_id = t.id) AS avg_rating
       FROM tasks t
       JOIN users u ON u.id = t.creator_id
       LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
       WHERE t.creator_id = ? AND t.status = 'OPEN'
       ORDER BY t.created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({ profile, tasks });
  } catch (err) {
    console.error('Brand profile error:', err);
    res.status(500).json({ error: '获取品牌主页失败' });
  }
});
