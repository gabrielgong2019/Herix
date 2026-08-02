import fs from 'fs';
import path from 'path';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/** 保存品牌素材到磁盘，固定文件名覆盖更新，返回可直接用于 <img src> 的URL路径 */
export function saveBrandAsset(userId: string, type: 'logo' | 'promo' | 'kyb', buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'brands', userId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = type === 'logo' ? 'png' : 'webp';
  fs.writeFileSync(path.join(dir, `${type}.${ext}`), buffer);
  return `/uploads/brands/${userId}/${type}.${ext}`;
}

/** 保存任务产品/服务 Logo，固定文件名覆盖更新 */
export function saveTaskServiceLogo(taskId: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'service-logo.png'), buffer);
  return `/uploads/tasks/${taskId}/service-logo.png`;
}

/** 保存任务封面图，固定文件名覆盖更新 */
export function saveTaskCover(taskId: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cover.webp'), buffer);
  return `/uploads/tasks/${taskId}/cover.webp`;
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
