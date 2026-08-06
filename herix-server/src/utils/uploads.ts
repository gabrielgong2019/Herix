import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/** 固定路径覆盖上传的缓存失效方案：URL 追加内容哈希，换图即换 URL（2026-08-06） */
function versioned(url: string, buffer: Buffer): string {
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  return `${url}?v=${hash}`;
}

/** 保存品牌素材到磁盘，固定文件名覆盖更新，返回可直接用于 <img src> 的URL路径 */
export function saveBrandAsset(userId: string, type: 'logo' | 'promo' | 'kyb', buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'brands', userId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = type === 'logo' ? 'png' : 'webp';
  fs.writeFileSync(path.join(dir, `${type}.${ext}`), buffer);
  return versioned(`/uploads/brands/${userId}/${type}.${ext}`, buffer);
}

/** 保存任务产品/服务 Logo，固定文件名覆盖更新 */
export function saveTaskServiceLogo(taskId: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'service-logo.png'), buffer);
  return versioned(`/uploads/tasks/${taskId}/service-logo.png`, buffer);
}

/** 保存任务封面图，固定文件名覆盖更新 */
export function saveTaskCover(taskId: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cover.webp'), buffer);
  return versioned(`/uploads/tasks/${taskId}/cover.webp`, buffer);
}

/** 保存赫使提交的截图/成品图，时间戳文件名（同一赫使多图不覆盖） */
export function saveSubmissionImage(heraldId: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'submissions', heraldId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/submissions/${heraldId}/${filename}`;
}

export const UPLOADS_DIR = UPLOADS_ROOT;
