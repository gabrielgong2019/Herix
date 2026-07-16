import sharp from 'sharp';

const LOGO_SIZE = 400;
const PROMO_WIDTH = 1200;
const PROMO_HEIGHT = 675; // 16:9
const COVER_WIDTH = 1200;
const COVER_HEIGHT = 675;

/** 品牌LOGO：统一适配为正方形。非方形图片用 contain + 透明背景填充，不裁切文字Logo */
export async function processLogo(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
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
