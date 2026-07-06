import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { imageUpload } from '../middleware/upload';
import { processLogo, processPromo } from '../utils/image';
import { saveBrandAsset } from '../utils/uploads';
import { update } from '../utils/db';

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
