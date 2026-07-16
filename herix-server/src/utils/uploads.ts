import fs from 'fs';
import path from 'path';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/** 保存品牌素材到磁盘，固定文件名覆盖更新，返回可直接用于 <img src> 的URL路径 */
export function saveBrandAsset(userId: string, type: 'logo' | 'promo', buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'brands', userId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = type === 'logo' ? 'png' : 'webp';
  fs.writeFileSync(path.join(dir, `${type}.${ext}`), buffer);
  return `/uploads/brands/${userId}/${type}.${ext}`;
}

/** 保存任务封面图，文件名带时间戳避免冲突 */
export function saveTaskCover(taskId: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_ROOT, 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${taskId}.webp`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/tasks/${filename}`;
}

export const UPLOADS_DIR = UPLOADS_ROOT;
