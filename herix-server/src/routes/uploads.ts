import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { imageUpload } from '../middleware/upload';
import { processLogo, processPromo, processCover } from '../utils/image';
import { saveBrandAsset, saveTaskCover, saveSubmissionImage } from '../utils/uploads';
import { update, insert } from '../utils/db';

export const uploadsRouter = Router();

/** POST /api/uploads/brand/logo — 品牌自助上传 LOGO */
uploadsRouter.post('/brand/logo', requireAuth, requireRole('BRAND'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const processed = await processLogo(req.file.buffer);
    const url = saveBrandAsset(req.user!.userId, 'logo', processed);
    await update('brand_profiles', { logo_url: url }, 'user_id = ?', [req.user!.userId]);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/** POST /api/uploads/brand/promo — 品牌自助上传宣传图 */
uploadsRouter.post('/brand/promo', requireAuth, requireRole('BRAND'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const processed = await processPromo(req.file.buffer);
    const url = saveBrandAsset(req.user!.userId, 'promo', processed);
    await update('brand_profiles', { promo_image_url: url }, 'user_id = ?', [req.user!.userId]);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Promo upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/** POST /api/uploads/brand/kyb-doc — 商家认证证件上传（登記簿謄本/营业执照，上传即提交审核） */
uploadsRouter.post('/brand/kyb-doc', requireAuth, requireRole('BRAND'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const processed = await processPromo(req.file.buffer); // 文档照片沿用宣传图压缩参数（长边保留较大，文字可读）
    const url = saveBrandAsset(req.user!.userId, 'kyb', processed);
    const submittedAt = new Date().toISOString();
    // 写业务发生源：每次提交一行审计记录（write-once，永久保留），
    // brand_profiles.kyb_* 只是"当前状态"快照，两者不冲突（快照给审核页筛选用，
    // 审计表给"这是第几次提交/历史拒绝原因"用）
    await insert('kyb_submissions', { user_id: req.user!.userId, doc_url: url, status: 'pending', submitted_at: submittedAt });
    await update('brand_profiles', {
      kyb_doc_url: url, kyb_status: 'pending', kyb_note: null,
      kyb_submitted_at: submittedAt,
    }, 'user_id = ?', [req.user!.userId]);
    res.json({ success: true, url, kybStatus: 'pending' });
  } catch (err) {
    console.error('KYB doc upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/** POST /api/uploads/submission-image — 赫使提交截图/成品图上传（草稿成品图与终稿证明截图共用）。
 *  此前小程序提交页没有任何图片上传能力，min_images 闸机对小程序用户形同永久封锁（2026-07-26 补） */
uploadsRouter.post('/submission-image', requireAuth, requireRole('HERALD'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const processed = await processPromo(req.file.buffer); // 沿用宣传图参数：长边保留较大，成品文字可读
    const url = saveSubmissionImage(req.user!.userId, processed);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Submission image upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/** POST /api/uploads/task/:taskId/cover — 任务封面图上传 */
uploadsRouter.post('/task/:taskId/cover', requireAuth, requireRole('BRAND', 'ADMIN'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const taskId = String(req.params.taskId);
    const processed = await processCover(req.file.buffer);
    const url = saveTaskCover(taskId, processed);
    await update('tasks', { cover_image: url }, 'id = ? AND creator_id = ?', [taskId, req.user!.userId]);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Cover upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});
