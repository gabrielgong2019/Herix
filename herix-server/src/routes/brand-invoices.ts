import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { findMany, findOne } from '../utils/db';
import { generateMonthlyInvoice } from '../utils/monthly-invoice';

export const brandInvoicesRouter = Router();
brandInvoicesRouter.use(requireAuth);

/** GET /api/brand/invoices
 * 查询参数：type=DEPOSIT|MONTHLY, page=1, limit=20
 */
brandInvoicesRouter.get('/', async (req: Request, res: Response) => {
  const brandId = req.user!.userId;
  const { type, page = '1', limit = '20' } = req.query;

  const params: any[] = [brandId];
  let where = 'brand_id = ?';
  if (type === 'DEPOSIT' || type === 'MONTHLY') {
    where += ' AND type = ?';
    params.push(type);
  }
  const skip = (Number(page) - 1) * Number(limit);

  const rows = await findMany<any>(
    `SELECT id, invoice_no, type, period, subtotal, tax_amount, total,
            issued_at, pdf_path IS NOT NULL AS has_pdf
     FROM merchant_invoices
     WHERE ${where}
     ORDER BY issued_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), skip],
  );

  const countRow = await findOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM merchant_invoices WHERE ${where}`,
    params,
  );

  res.json({
    invoices: rows.map((r: any) => ({
      id:        r.id,
      invoiceNo: r.invoice_no,
      type:      r.type,
      period:    r.period,
      subtotal:  Number(r.subtotal),
      taxAmount: Number(r.tax_amount),
      total:     Number(r.total),
      issuedAt:  r.issued_at,
      hasPdf:    Boolean(r.has_pdf),
    })),
    total: Number(countRow?.total || 0),
    page:  Number(page),
    limit: Number(limit),
  });
});

/** GET /api/brand/invoices/:id/pdf — 下载 PDF */
brandInvoicesRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  const brandId = req.user!.userId;
  const row = await findOne<any>(
    `SELECT * FROM merchant_invoices WHERE id = ? AND brand_id = ?`,
    [req.params.id, brandId],
  );

  if (!row) return res.status(404).json({ error: '发票不存在' });

  if (!row.pdf_path || !fs.existsSync(row.pdf_path)) {
    // PDF 尚未生成或文件丢失，尝试重新生成（仅 MONTHLY）
    if (row.type === 'MONTHLY' && row.period) {
      try {
        await generateMonthlyInvoice(brandId, row.period);
        const refreshed = await findOne<any>(
          `SELECT pdf_path FROM merchant_invoices WHERE id = ?`,
          [row.id],
        );
        if (refreshed?.pdf_path && fs.existsSync(refreshed.pdf_path)) {
          return sendPdf(res, refreshed.pdf_path, row.invoice_no);
        }
      } catch (err) {
        console.error('[invoice] regenerate failed:', err);
      }
    }
    return res.status(503).json({ error: 'PDF 生成中または生成失败，请稍后重试' });
  }

  sendPdf(res, row.pdf_path, row.invoice_no);
});

/** POST /api/brand/invoices/request-monthly?period=2026-08
 * 商家手动触发月次请求书生成（补发或首次生成）
 */
brandInvoicesRouter.post('/request-monthly', async (req: Request, res: Response) => {
  const brandId = req.user!.userId;
  const period  = String(req.query.period || req.body.period || '');
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return res.status(400).json({ error: 'period 格式应为 YYYY-MM' });
  }
  try {
    const result = await generateMonthlyInvoice(brandId, period);
    if (result.skipped && !result.id) {
      return res.status(204).json({ message: `${period} 无结算数据，无需生成` });
    }
    res.json({ id: result.id, invoiceNo: result.invoiceNo, total: result.total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function sendPdf(res: Response, filePath: string, invoiceNo: string) {
  const filename = `${invoiceNo.replace(/\//g, '-')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  fs.createReadStream(filePath).pipe(res);
}
