import sharp from 'sharp';

const LOGO_SIZE = 400;
const PROMO_WIDTH = 1200;
const PROMO_HEIGHT = 675; // 16:9
const COVER_WIDTH = 1200;
const COVER_HEIGHT = 675;

/** 品牌LOGO：先 trim 去除周围留白，再 contain 适配正方形，透明背景保留 */
export async function processLogo(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .trim({ threshold: 10 })   // 剪掉周围接近透明/白色的留白
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 8 })
    .toBuffer();
}

/** 等比缩放不裁切（提交截图/KYB 证件用）：最长边不超过 maxDimension，保留原比例。
 *  16:9 cover 会把竖屏手机截图裁成横版、证件边缘裁掉，这里只缩不放 */
export async function processInside(buffer: Buffer, maxDimension = 1200, quality = 85): Promise<Buffer> {
  return sharp(buffer)
    .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

/** 品牌宣传图：统一适配为16:9横版，非该比例图片自动 center-crop */
export async function processPromo(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(PROMO_WIDTH, PROMO_HEIGHT, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toBuffer();
}

/** 任务封面图：16:9，webp，典型输出 150~500KB */
export async function processCover(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover', position: 'centre' })
    .webp({ quality: 75 })
    .toBuffer();
}
