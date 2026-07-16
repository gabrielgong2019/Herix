import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';

export const qrRouter = Router();

/** GET /api/qr?data=URL — 生成 QR 码 SVG（无需鉴权，内容本身是公开链接） */
qrRouter.get('/', async (req: Request, res: Response) => {
  const data = String(req.query.data || '');
  if (!data) return res.status(400).json({ error: 'data 参数不能为空' });
  if (data.length > 2048) return res.status(400).json({ error: '链接过长' });

  const svg = await QRCode.toString(data, {
    type: 'svg',
    margin: 1,
    color: { dark: '#111827', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});
