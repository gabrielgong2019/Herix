import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { imageUpload } from '../middleware/upload';
import { processLogo, processPromo, processCover, processInside } from '../utils/image';
import { saveBrandAsset, saveTaskCover, saveTaskServiceLogo, saveSubmissionImage } from '../utils/uploads';
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

/** POST /api/uploads/brand/kyb-doc — 商家认证证件上传（纯上传返回URL；
 *  2026-07-29 流程化改造：提交动作移交 POST /api/brands/kyb（带公司名/法人番号结构化信息+自动核验），
 *  本路由不再有"传图即提交"副作用） */
uploadsRouter.post('/brand/kyb-doc', requireAuth, requireRole('BRAND'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const processed = await processInside(req.file.buffer); // 证件等比缩放不裁切，边缘文字保留可读
    const url = saveBrandAsset(req.user!.userId, 'kyb', processed);
    res.json({ success: true, url });
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
    const processed = await processInside(req.file.buffer); // 截图等比缩放不裁切，竖屏内容完整保留
    const url = saveSubmissionImage(req.user!.userId, processed);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Submission image upload error:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

/** POST /api/uploads/task/:taskId/service-logo — 产品/服务 Logo 上传 */
uploadsRouter.post('/task/:taskId/service-logo', requireAuth, requireRole('BRAND', 'ADMIN'), imageUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: '未提供文件' });
  try {
    const taskId = String(req.params.taskId);
    const processed = await processLogo(req.file.buffer);
    const url = saveTaskServiceLogo(taskId, processed);
    await update('tasks', { service_logo_url: url }, 'id = ? AND creator_id = ?', [taskId, req.user!.userId]);
    res.json({ success: true, url });
  } catch (err) {
    console.error('Service logo upload error:', err);
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
