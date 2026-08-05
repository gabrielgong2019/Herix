import nodemailer from 'nodemailer';

// 配置：环境变量（launchd plist）SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM
// 未配置时只打印日志，不实际发送
// SendGrid 示例：SMTP_HOST=smtp.sendgrid.net SMTP_USER=apikey SMTP_PASS=<API Key> SMTP_FROM=<已验证发件邮箱>
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
// 发件人地址：SendGrid/Resend 等服务 SMTP 用户名是字面量不是邮箱，必须单独配
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
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
  // 失败必须抛出，调用方据此告知用户/重试；不能静默吞掉假装已发送（2026-08-06）
  await transporter.sendMail({ from: `"${FROM_NAME}" <${SMTP_FROM}>`, to, subject, text });
}
