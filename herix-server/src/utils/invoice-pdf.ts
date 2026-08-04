import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// ─── Jurisdiction ─────────────────────────────────────────────────────────────
// 每个 Jurisdiction 对应一套税务规则 + 发票格式。
// 新增市场：实现 InvoiceLocaleStrategy 并注册到 INVOICE_STRATEGIES。
// ──────────────────────────────────────────────────────────────────────────────
export type Jurisdiction = 'JP' | 'CN';

export interface InvoiceLocaleStrategy {
  buildDepositHtml(data: DepositInvoiceData): string;
  buildMonthlyHtml(data: MonthlyInvoiceData): string;
}

/** 根据品牌归属国推断司法管辖区。未知/空均默认 JP（当前主站） */
export function detectJurisdiction(brandCountry?: string | null): Jurisdiction {
  if (brandCountry === 'CN') return 'CN';
  return 'JP';
}

export interface IssuerInfo {
  name: string;
  regNo: string;    // JP: インボイス登録番号 T+13桁 / CN: 纳税人识别号（留空=免税）
  address: string;
  postal: string;
  bankName: string;
  bankBranch: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

export interface RecipientInfo {
  name: string;
  address: string;
  postal: string;
}

export interface DepositInvoiceData {
  invoiceNo: string;
  issuedAt: Date;
  issuer: IssuerInfo;
  recipient: RecipientInfo;
  amount: number;       // 入金額（税なし）
  note?: string;
}

export interface MonthlyLineItem {
  taskTitle: string;
  heraldPayout: number;
  platformFee: number;
  settledAt: string;
}

export interface MonthlyInvoiceData {
  invoiceNo: string;
  period: string;       // '2026-08'
  issuedAt: Date;
  issuer: IssuerInfo;
  recipient: RecipientInfo;
  items: MonthlyLineItem[];
  subtotal: number;     // 税抜合計
  taxAmount: number;    // 消費税額
  total: number;        // 税込合計
}

// ─── HTML テンプレート ────────────────────────────────────────────────────

function baseStyle() {
  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', Meiryo, sans-serif;
        font-size: 13px;
        color: #1a1a1a;
        background: #fff;
        padding: 40px 48px;
      }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
      .doc-title { font-size: 22px; font-weight: 700; }
      .doc-subtitle { font-size: 12px; color: #666; margin-top: 4px; }
      .issuer-block { text-align: right; font-size: 12px; line-height: 1.7; }
      .issuer-block .company { font-size: 14px; font-weight: 700; }
      .reg-badge {
        display: inline-block;
        background: #f0f4ff;
        border: 1px solid #c7d4f8;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 11px;
        color: #3b5bdb;
        margin-top: 4px;
      }
      .meta-row { display: flex; gap: 32px; margin-bottom: 28px; }
      .meta-box { flex: 1; }
      .meta-label { font-size: 11px; color: #888; font-weight: 500; letter-spacing: .5px; margin-bottom: 6px; }
      .meta-value { font-size: 13px; font-weight: 600; }
      .recipient-block {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px 20px;
        margin-bottom: 28px;
        background: #fafafa;
      }
      .recipient-block .company { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
      .recipient-block .addr { font-size: 12px; color: #555; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      thead th {
        background: #1a1a2e;
        color: #fff;
        padding: 10px 12px;
        font-size: 11px;
        font-weight: 600;
        text-align: left;
        letter-spacing: .5px;
      }
      thead th.num { text-align: right; }
      tbody tr:nth-child(even) { background: #f9fafb; }
      tbody td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
      tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .subtable { width: 340px; margin-left: auto; margin-bottom: 24px; }
      .subtable td { padding: 7px 0; font-size: 13px; }
      .subtable td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
      .subtable tr.divider td { border-top: 1px solid #e5e7eb; padding-top: 10px; }
      .subtable tr.total td { font-size: 16px; font-weight: 700; color: #1a1a2e; }
      .notice-box {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        padding: 14px 18px;
        font-size: 12px;
        color: #1e40af;
        line-height: 1.7;
        margin-bottom: 24px;
      }
      .bank-box {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px 20px;
        font-size: 12px;
        line-height: 1.8;
        margin-bottom: 24px;
      }
      .bank-box .title { font-size: 11px; font-weight: 700; color: #888; letter-spacing: .5px; margin-bottom: 8px; }
      .footer { font-size: 11px; color: #aaa; text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px; }
    </style>
  `;
}

function fmtDate(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return `${jst.getFullYear()}年${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function fmtMoney(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

function fmtPeriod(period: string): string {
  const [y, m] = period.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

function issuerBlock(issuer: IssuerInfo) {
  return `
    <div class="issuer-block">
      <div class="company">${esc(issuer.name)}</div>
      ${issuer.postal ? `<div>〒${esc(issuer.postal)}</div>` : ''}
      ${issuer.address ? `<div>${esc(issuer.address)}</div>` : ''}
      ${issuer.regNo
        ? `<div><span class="reg-badge">登録番号 ${esc(issuer.regNo)}</span></div>`
        : '<div style="font-size:11px;color:#aaa;margin-top:4px;">※ 適格請求書発行事業者登録前</div>'
      }
    </div>
  `;
}

function recipientBlock(recipient: RecipientInfo) {
  return `
    <div class="recipient-block">
      ${recipient.postal ? `<div class="addr">〒${esc(recipient.postal)}</div>` : ''}
      ${recipient.address ? `<div class="addr">${esc(recipient.address)}</div>` : ''}
      <div class="company">${esc(recipient.name)} 御中</div>
    </div>
  `;
}

function bankBlock(issuer: IssuerInfo) {
  if (!issuer.bankName) return '';
  return `
    <div class="bank-box">
      <div class="title">お振込先</div>
      ${esc(issuer.bankName)}　${esc(issuer.bankBranch)}
      ${esc(issuer.bankAccountType)}　${esc(issuer.bankAccountNumber)}
      （${esc(issuer.bankAccountName)}）
    </div>
  `;
}

export function buildDepositHtml(data: DepositInvoiceData): string {
  const { invoiceNo, issuedAt, issuer, recipient, amount, note } = data;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${esc(invoiceNo)}</title>
  ${baseStyle()}
</head>
<body>
  <div class="header">
    <div>
      <div class="doc-title">請求書</div>
      <div class="doc-subtitle">前受金（サービスデポジット）</div>
    </div>
    ${issuerBlock(issuer)}
  </div>

  <div class="meta-row">
    <div class="meta-box"><div class="meta-label">請求番号</div><div class="meta-value">${esc(invoiceNo)}</div></div>
    <div class="meta-box"><div class="meta-label">発行日</div><div class="meta-value">${fmtDate(issuedAt)}</div></div>
    <div class="meta-box"><div class="meta-label">お支払期日</div><div class="meta-value">発行日より30日以内</div></div>
  </div>

  ${recipientBlock(recipient)}

  <table>
    <thead>
      <tr>
        <th>件名</th>
        <th class="num">金額</th>
        <th class="num">消費税</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Herix プラットフォーム デポジット（前受金）${note ? `<br><span style="color:#888;font-size:11px">${esc(note)}</span>` : ''}</td>
        <td class="num">${fmtMoney(amount)}</td>
        <td class="num" style="color:#888;">対象外</td>
      </tr>
    </tbody>
  </table>

  <table class="subtable">
    <tr>
      <td>ご請求金額</td>
      <td style="font-size:18px;font-weight:700;">${fmtMoney(amount)}</td>
    </tr>
  </table>

  <div class="notice-box">
    本書は前受金（デポジット）のご入金依頼書です。消費税は対象外となります。<br>
    役務提供（タスク完了）に係る適格請求書は、毎月末締めで翌月初に別途発行いたします。
  </div>

  ${bankBlock(issuer)}

  <div class="footer">${esc(issuer.name)} — ${esc(invoiceNo)}</div>
</body>
</html>`;
}

export function buildMonthlyHtml(data: MonthlyInvoiceData): string {
  const { invoiceNo, period, issuedAt, issuer, recipient, items, subtotal, taxAmount, total } = data;
  const periodStr = fmtPeriod(period);
  const [y, m] = period.split('-');
  const daysInMonth = new Date(Number(y), Number(m), 0).getDate();
  const periodRange = `${y}年${parseInt(m, 10)}月1日 〜 ${parseInt(m, 10)}月${daysInMonth}日`;

  const rows = items.map((item) => `
    <tr>
      <td>${esc(item.taskTitle)}</td>
      <td class="num">${fmtMoney(item.heraldPayout)}</td>
      <td class="num">${fmtMoney(item.platformFee)}</td>
      <td class="num">${fmtMoney(item.heraldPayout + item.platformFee)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${esc(invoiceNo)}</title>
  ${baseStyle()}
</head>
<body>
  <div class="header">
    <div>
      <div class="doc-title">${issuer.regNo ? '適格請求書' : '請求書'}</div>
      <div class="doc-subtitle">${periodStr}分　サービス利用料</div>
    </div>
    ${issuerBlock(issuer)}
  </div>

  <div class="meta-row">
    <div class="meta-box"><div class="meta-label">請求番号</div><div class="meta-value">${esc(invoiceNo)}</div></div>
    <div class="meta-box"><div class="meta-label">発行日</div><div class="meta-value">${fmtDate(issuedAt)}</div></div>
    <div class="meta-box"><div class="meta-label">対象期間</div><div class="meta-value">${periodRange}</div></div>
  </div>

  ${recipientBlock(recipient)}

  <table>
    <thead>
      <tr>
        <th>案件名</th>
        <th class="num">アンバサダー報酬</th>
        <th class="num">プラットフォーム手数料</th>
        <th class="num">小計（税抜）</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <table class="subtable">
    <tr>
      <td style="color:#666;">サービス合計（税抜 10%対象）</td>
      <td>${fmtMoney(subtotal)}</td>
    </tr>
    <tr class="divider">
      <td style="color:#666;">消費税（10%）</td>
      <td>${fmtMoney(taxAmount)}</td>
    </tr>
    <tr class="total">
      <td>合計（税込）</td>
      <td>${fmtMoney(total)}</td>
    </tr>
  </table>

  ${!issuer.regNo
    ? `<div class="notice-box" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">
        ※ 当社は現在、消費税の適格請求書発行事業者登録申請中（または免税期間中）です。
        本書は適格請求書ではないため、仕入税額控除の対象とならない場合があります。
      </div>`
    : ''
  }

  ${bankBlock(issuer)}

  <div class="footer">${esc(issuer.name)} — ${esc(invoiceNo)}</div>
</body>
</html>`;
}

// ─── PDF 生成 ─────────────────────────────────────────────────────────────

const PDF_DIR = path.join(process.cwd(), 'uploads', 'invoices');

async function ensureDir() {
  if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
}

async function htmlToPdf(html: string, filename: string): Promise<string> {
  await ensureDir();
  const filePath = path.join(PDF_DIR, filename);

  const execPath = process.env.CHROMIUM_PATH;
  const browser = await puppeteer.launch({
    ...(execPath ? { executablePath: execPath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }
  return filePath;
}

// ─── JP strategy（当前完整实现） ────────────────────────────────────────────
const jpStrategy: InvoiceLocaleStrategy = {
  buildDepositHtml,
  buildMonthlyHtml,
};

// ─── CN strategy（存根：架构占位，格式待实现） ─────────────────────────────
// 中国站点发票格式说明：
//   - 充值凭证（DEPOSIT）→ 收款收据；正式增值税普通/专用发票另行开具（需对接税控系统）
//   - 月度结算（MONTHLY）→ 服务费结算单；增值税发票由财务团队在税务系统内手工开具
// 待实现时：参考 buildDepositHtml/buildMonthlyHtml，把日语术语替换为中文，
//   税率改为适用增值税率（服务类通常 6%），添加纳税人识别号字段。
const cnStrategy: InvoiceLocaleStrategy = {
  buildDepositHtml(data: DepositInvoiceData): string {
    return buildCnStubHtml('收款收据', data.invoiceNo, data.issuedAt, data.issuer.name, data.recipient.name, data.amount, '不含税', '充值到账后，正式增值税发票将由财务团队另行开具。');
  },
  buildMonthlyHtml(data: MonthlyInvoiceData): string {
    return buildCnStubHtml('服务费结算单', data.invoiceNo, data.issuedAt, data.issuer.name, data.recipient.name, data.total, `含税合计（税率待定）`, '增值税专用/普通发票将由财务团队在税控系统内另行开具，邮寄或电子送达。');
  },
};

function buildCnStubHtml(
  docType: string, invoiceNo: string, issuedAt: Date,
  issuerName: string, recipientName: string, amount: number,
  amountLabel: string, notice: string,
): string {
  const dateStr = `${issuedAt.getFullYear()}年${issuedAt.getMonth() + 1}月${issuedAt.getDate()}日`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${esc(invoiceNo)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"PingFang SC","Microsoft YaHei","SimHei",sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:40px 48px}
.title{font-size:22px;font-weight:700;margin-bottom:4px}
.sub{font-size:12px;color:#666;margin-bottom:32px}
.row{display:flex;justify-content:space-between;margin-bottom:10px;font-size:13px}
.label{color:#888}
.notice{background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:14px 18px;font-size:12px;color:#854d0e;line-height:1.7;margin-top:24px}
.amount-row{font-size:20px;font-weight:700;margin:24px 0 8px}
.footer{font-size:11px;color:#aaa;text-align:center;margin-top:48px;border-top:1px solid #eee;padding-top:16px}
</style></head>
<body>
<div class="title">${esc(docType)}</div>
<div class="sub">${esc(invoiceNo)}</div>
<div class="row"><span class="label">发行日期</span><span>${esc(dateStr)}</span></div>
<div class="row"><span class="label">收款方</span><span>${esc(issuerName)}</span></div>
<div class="row"><span class="label">付款方</span><span>${esc(recipientName)}</span></div>
<hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb">
<div class="amount-row">¥ ${amount.toLocaleString('zh-CN')}</div>
<div style="color:#888;font-size:12px">${esc(amountLabel)}</div>
<div class="notice">⚠️ ${esc(notice)}</div>
<div class="footer">${esc(issuerName)} — ${esc(invoiceNo)}</div>
</body></html>`;
}

// ─── 策略注册表 ────────────────────────────────────────────────────────────
const INVOICE_STRATEGIES: Record<Jurisdiction, InvoiceLocaleStrategy> = {
  JP: jpStrategy,
  CN: cnStrategy,
};

function getStrategy(jurisdiction: Jurisdiction): InvoiceLocaleStrategy {
  return INVOICE_STRATEGIES[jurisdiction] ?? jpStrategy;
}

// ─── 公开 generate 函数（带 jurisdiction 参数） ───────────────────────────
export async function generateDepositPdf(data: DepositInvoiceData, jurisdiction: Jurisdiction = 'JP'): Promise<string> {
  const html = getStrategy(jurisdiction).buildDepositHtml(data);
  const filename = `${data.invoiceNo.replace(/\//g, '-')}.pdf`;
  return htmlToPdf(html, filename);
}

export async function generateMonthlyPdf(data: MonthlyInvoiceData, jurisdiction: Jurisdiction = 'JP'): Promise<string> {
  const html = getStrategy(jurisdiction).buildMonthlyHtml(data);
  const filename = `${data.invoiceNo.replace(/\//g, '-')}.pdf`;
  return htmlToPdf(html, filename);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
