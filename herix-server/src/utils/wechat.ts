/**
 * 微信小程序服务端 API 封装：URL Link（外部链接拉起小程序）+ 小程序码。
 *
 * 凭据走环境变量（launchd plist）：
 *   WECHAT_MINI_APPID / WECHAT_MINI_SECRET —— 未配置时 isWechatConfigured()=false，
 *   调用方应优雅降级（分享区块显示"小程序发布后可用"），不报错。
 *   WECHAT_MINI_ENV —— 可选 release(默认)/trial/develop，小程序未过审时用 trial 测试。
 *
 * ⚠️ 前提：小程序已发布（正式版或体验版），否则微信 API 返回错误。
 */

const APPID  = process.env.WECHAT_MINI_APPID || '';
const SECRET = process.env.WECHAT_MINI_SECRET || '';
const ENV_VERSION = process.env.WECHAT_MINI_ENV || 'release';

export function isWechatConfigured(): boolean {
  return !!(APPID && SECRET);
}

// access_token 内存缓存（微信有效期 7200s，提前 5 分钟过期）
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const r = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${SECRET}`
  );
  const d: any = await r.json();
  if (!d.access_token) {
    throw Object.assign(new Error(`微信 access_token 获取失败: ${d.errcode} ${d.errmsg}`), { code: 'WECHAT_TOKEN_FAILED' });
  }
  tokenCache = { token: d.access_token, expiresAt: Date.now() + (d.expires_in - 300) * 1000 };
  return d.access_token;
}

/** 生成 URL Link（https 链接，浏览器/短信里点击拉起小程序）。有效期 30 天，调用方负责缓存续期。 */
export async function generateUrlLink(path: string, query: string): Promise<{ link: string; expiresAt: string }> {
  const token = await getAccessToken();
  const r = await fetch(`https://api.weixin.qq.com/wxa/generate_urllink?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      query,
      env_version: ENV_VERSION,
      expire_type: 1,       // 按天过期
      expire_interval: 30,  // 微信允许的最长 30 天
    }),
  });
  const d: any = await r.json();
  if (d.errcode || !d.url_link) {
    throw Object.assign(new Error(`URL Link 生成失败: ${d.errcode} ${d.errmsg}`), { code: 'WECHAT_URLLINK_FAILED' });
  }
  const expiresAt = new Date(Date.now() + 29 * 24 * 3600 * 1000).toISOString(); // 提前1天当过期，留续期余量
  return { link: d.url_link, expiresAt };
}

/** 生成小程序码 PNG（getwxacodeunlimit，永久有效，数量不限）。scene 最长 32 字符。 */
export async function getUnlimitedQRCode(scene: string, page: string): Promise<Buffer> {
  if (scene.length > 32) {
    throw Object.assign(new Error(`scene 超长(${scene.length}>32)`), { code: 'WECHAT_SCENE_TOO_LONG' });
  }
  const token = await getAccessToken();
  const r = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, page, env_version: ENV_VERSION, width: 430, check_path: ENV_VERSION === 'release' }),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  // 失败时微信返回 JSON 而不是图片
  if (buf.length < 1000 && buf.slice(0, 1).toString() === '{') {
    const d = JSON.parse(buf.toString());
    throw Object.assign(new Error(`小程序码生成失败: ${d.errcode} ${d.errmsg}`), { code: 'WECHAT_QRCODE_FAILED' });
  }
  return buf;
}
