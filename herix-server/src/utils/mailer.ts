import nodemailer from 'nodemailer';

// 配置：在 .env 或环境变量中设置 SMTP_USER / SMTP_PASS
// 未配置时只打印日志，不实际发送
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_NAME = 'Herix 赫使平台';

const transporter = SMTP_USER ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: 465,
  secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
}) : null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transporter) {
    console.log(`[MAIL] To: ${to} | ${subject}\n${text}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: `"${FROM_NAME}" <${SMTP_USER}>`, to, subject, text });
  } catch (err) {
    console.error('[MAIL ERROR]', err);
  }
}
