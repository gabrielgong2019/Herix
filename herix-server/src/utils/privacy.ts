/**
 * 明细模式隐私底线（设计定稿 2026-07-17，不是可选优化）：
 *   1. 原始邮箱/用户ID 不落库不落日志——内存里算完 hash + 脱敏串立即丢弃
 *   2. 去重键 = SHA-256(归一化标识 + 全局盐)，盐走环境变量 REFERRAL_HASH_SALT
 *   3. 展示只到脱敏程度（a**@gmail.com / ab***）
 */
import crypto from 'crypto';

// 盐必须跨上传稳定（否则去重失效），所以是全局盐。生产环境务必在 launchd/环境变量里配置；
// 未配置时用应用级默认值兜底（开发可用，生产不合格——见 CLAUDE.md 部署节）
const SALT = process.env.REFERRAL_HASH_SALT || 'herix-referral-v1';

/** 归一化：小写 + 去首尾空白。同一邮箱大小写差异不算两个人 */
export function normalizeUserKey(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

export function hashUserKey(raw: string): string {
  return crypto.createHash('sha256').update(normalizeUserKey(raw) + SALT).digest('hex');
}

/** 脱敏：邮箱 → 首字符+**+@域名；非邮箱 → 前2字符+*** */
export function maskUserKey(raw: string): string {
  const s = normalizeUserKey(raw);
  const at = s.indexOf('@');
  if (at > 0) return s[0] + '**' + s.slice(at);
  return s.slice(0, 2) + '***';
}
