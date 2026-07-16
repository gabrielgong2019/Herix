import multer from 'multer';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB 原始文件上限，sharp 处理后存储约 150~500KB

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('仅支持图片文件'));
    }
    cb(null, true);
  },
});
