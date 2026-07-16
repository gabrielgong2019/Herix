import { createNotification } from '../routes/notifications';
import { sendMail } from './mailer';

export interface NotifyOptions {
  userId: string;
  email?: string | null;
  type: string;
  title: string;
  body: string;
  targetRole?: string;
  emailSubject?: string;
  metadata?: Record<string, any>;
}

/**
 * 统一通知入口：写站内信 + 发邮件（若有）。
 * 后续接推送 / 企微 / 微信只需在此扩展，调用方不改。
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  await createNotification({
    userId: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    targetRole: opts.targetRole,
    metadata: opts.metadata,
  });
  if (opts.email) {
    const subject = opts.emailSubject ?? `【Herix】${opts.title}`;
    sendMail(opts.email, subject, opts.body).catch((e) => console.error('[notify] sendMail failed:', e));
  }
}
