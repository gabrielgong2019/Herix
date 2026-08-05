import pool from '../db';
import { findOne, insert } from './db';
import { getSetting } from './settings';
import { nextInvoiceNo } from './invoice-number';
import { generateMonthlyPdf, MonthlyLineItem, detectJurisdiction, type Jurisdiction } from './invoice-pdf';

/**
 * 为指定商家生成某月的月次適格請求書。
 * 幂等：同一 brand+period 已存在则直接返回已有记录 id。
 *
 * @param brandId  商家 user_id
 * @param period   'YYYY-MM'（JST 月份）
 */
export async function generateMonthlyInvoice(
  brandId: string,
  period: string,
): Promise<{ id: string; invoiceNo: string; total: number; skipped?: boolean }> {

  // 幂等检查
  const existing = await findOne<{ id: string; invoice_no: string; total: number }>(
    `SELECT id, invoice_no, total FROM merchant_invoices
     WHERE brand_id = $1 AND type = 'MONTHLY' AND period = $2`,
    [brandId, period],
  );
  if (existing) {
    return { id: existing.id, invoiceNo: existing.invoice_no, total: existing.total, skipped: true };
  }

  // 月份边界（UTC，但 JST 月份语义：JST=UTC+9）
  const [y, m] = period.split('-').map(Number);
  // JST 月初 = UTC 当月1日 00:00:00 JST = 前日 15:00:00 UTC
  const periodStart = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600_000).toISOString();
  // JST 月末 = 次月1日 00:00:00 JST
  const periodEnd   = new Date(Date.UTC(y, m, 1)     - 9 * 3600_000).toISOString();

  // 查询该月所有结算事务
  const { rows: txRows } = await pool.query(
    `SELECT tt.id, tt.amount, tt.platform_fee, tt.created_at, t.title
     FROM task_transactions tt
     JOIN tasks t ON t.id = tt.task_id
     WHERE tt.from_user_id = $1
       AND tt.type = 'TASK_RELEASE'
       AND tt.status = 'completed'
       AND tt.created_at >= $2
       AND tt.created_at <  $3
     ORDER BY tt.created_at ASC`,
    [brandId, periodStart, periodEnd],
  );

  if (txRows.length === 0) {
    return { id: '', invoiceNo: '', total: 0, skipped: true };
  }

  // 税额计算（与 TaskForm 前端对齐：ceil 整数，基数=报酬+手续费）
  const items: MonthlyLineItem[] = txRows.map((r: any) => ({
    taskTitle:    r.title,
    heraldPayout: Math.round(Number(r.amount)),
    platformFee:  Math.round(Number(r.platform_fee)),
    settledAt:    r.created_at,
  }));
  const subtotal  = items.reduce((s, i) => s + i.heraldPayout + i.platformFee, 0);
  const taxAmount = Math.ceil(subtotal * 0.1);
  const total     = subtotal + taxAmount;

  // 拉取发行方 + 收件方信息
  const [issuerSettings, brand, brandUser] = await Promise.all([
    loadIssuerSettings(),
    findOne<any>(`SELECT company_name, billing_address, billing_postal, country as brand_country FROM brand_profiles WHERE user_id = $1`, [brandId]),
    findOne<any>(`SELECT email, nickname FROM users WHERE id = $1`, [brandId]),
  ]);

  const jurisdiction: Jurisdiction = detectJurisdiction(brand?.brand_country);

  const recipientName = brand?.company_name || brandUser?.nickname || brandUser?.email || '';

  // 生成发票号（在事务内，使用独立 client 保证序列化）
  const client = await pool.connect();
  let invoiceNo: string;
  let invoiceId: string;
  const issuedAt = new Date();

  try {
    await client.query('BEGIN');
    invoiceNo = await nextInvoiceNo('MONTHLY', issuedAt, client as any);

    // PDF 生成（事务外动作，先在事务内占号）
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();

  // 生成 PDF（I/O 较慢，不放事务内）
  let pdfPath: string | null = null;
  try {
    pdfPath = await generateMonthlyPdf({
      invoiceNo,
      period,
      issuedAt,
      issuer: issuerSettings,
      recipient: {
        name:    recipientName,
        address: brand?.billing_address || '',
        postal:  brand?.billing_postal  || '',
      },
      items,
      subtotal,
      taxAmount,
      total,
    }, jurisdiction);
  } catch (err) {
    console.error('[invoice] PDF generation failed, storing record without PDF:', err);
  }

  // 持久化到 DB
  invoiceId = await insert('merchant_invoices', {
    invoice_no:      invoiceNo,
    brand_id:        brandId,
    type:            'MONTHLY',
    period,
    subtotal,
    tax_amount:      taxAmount,
    total,
    recipient_name:  recipientName,
    recipient_address: brand?.billing_address || '',
    recipient_postal:  brand?.billing_postal  || '',
    issuer_name:     issuerSettings.name,
    issuer_reg_no:   issuerSettings.regNo,
    issuer_address:  issuerSettings.address,
    pdf_path:        pdfPath ?? null,
    jurisdiction,
    issued_at:       issuedAt.toISOString(),
  });

  return { id: invoiceId, invoiceNo, total };
}

/**
 * 月初 cron：为上月有结算的所有商家生成月次请求书。
 * 设计：失败单个商家不阻断其他商家的生成。
 */
export async function runMonthlyCron(): Promise<void> {
  const now   = new Date();
  const jst   = new Date(now.getTime() + 9 * 3600_000);
  // 上月
  const year  = jst.getMonth() === 0 ? jst.getFullYear() - 1 : jst.getFullYear();
  const month = jst.getMonth() === 0 ? 12 : jst.getMonth();
  const period = `${year}-${String(month).padStart(2, '0')}`;

  const periodStart = new Date(Date.UTC(year, month - 1, 1) - 9 * 3600_000).toISOString();
  const periodEnd   = new Date(Date.UTC(year, month, 1)     - 9 * 3600_000).toISOString();

  // 取上月有 TASK_RELEASE 的所有商家
  const { rows } = await pool.query(
    `SELECT DISTINCT from_user_id FROM task_transactions
     WHERE type = 'TASK_RELEASE' AND status = 'completed'
       AND created_at >= $1 AND created_at < $2`,
    [periodStart, periodEnd],
  );

  console.log(`[invoice cron] period=${period}, brands=${rows.length}`);
  for (const row of rows) {
    try {
      const result = await generateMonthlyInvoice(row.from_user_id, period);
      if (!result.skipped) {
        console.log(`[invoice cron] generated ${result.invoiceNo} for brand ${row.from_user_id}`);
      }
    } catch (err) {
      console.error(`[invoice cron] failed for brand ${row.from_user_id}:`, err);
    }
  }
}

// ─── 发行方信息从 platform_settings 加载 ──────────────────────────────────

async function loadIssuerSettings() {
  const keys = ['operator_entity','issuer_invoice_reg_no','issuer_address','issuer_postal',
                 'bank_name','bank_branch','bank_account_type','bank_account_number','bank_account_name'];
  const vals = await Promise.all(keys.map((k) => getSetting(k)));
  const s: Record<string, string> = {};
  keys.forEach((k, i) => { s[k] = vals[i] || ''; });

  return {
    name:              s['operator_entity']       || 'Herix',
    regNo:             s['issuer_invoice_reg_no'] || '',
    address:           s['issuer_address']         || '',
    postal:            s['issuer_postal']           || '',
    bankName:          s['bank_name']               || '',
    bankBranch:        s['bank_branch']             || '',
    bankAccountType:   s['bank_account_type']       || '普通',
    bankAccountNumber: s['bank_account_number']     || '',
    bankAccountName:   s['bank_account_name']       || '',
  };
}

export { loadIssuerSettings };
