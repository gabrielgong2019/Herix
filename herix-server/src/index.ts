// 必须是第一个 import：后续所有模块(db/mailer/…)都在模块加载期读 process.env。
// 之前不加载 .env、全靠 pm2 首次启动缓存的 shell 环境——后来加进 .env 的变量
// (如 SMTP_*)进程永远看不到，邮件静默降级成只打日志(2026-07-17 生产事故)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { initDatabase } from './db';
import { authRouter } from './routes/auth';
import { tasksRouter } from './routes/tasks';
import { submissionsRouter } from './routes/submissions';
import { applicationRouter } from './routes/applications';
import { usersRouter } from './routes/users';
import { ratingsRouter } from './routes/ratings';
import { ambassadorRouter } from './routes/ambassador';
import { referralsRouter } from './routes/referrals';
import { adminRouter } from './routes/admin';
import { walletRouter } from './routes/wallet';
import { uploadsRouter } from './routes/uploads';
import { qrRouter } from './routes/qr';
import { notificationsRouter } from './routes/notifications';
import { categoriesRouter } from './routes/categories';
import { specialtyTagsRouter } from './routes/specialty-tags';
import { communitiesRouter } from './routes/communities';
import { sitesRouter } from './routes/sites';
import { i18nPublicRouter } from './routes/i18n';
import { arbitrationsRouter } from './routes/arbitrations';
import { subscriptionsRouter } from './routes/subscriptions';
import { brandsRouter } from './routes/brands';
import { shortLinksRouter } from './routes/shortLinks';
import { legalRouter } from './routes/legal';
import { brandInvoicesRouter } from './routes/brand-invoices';
import { UPLOADS_DIR } from './utils/uploads';
import { findOne } from './utils/db';

(async () => {
  await initDatabase();
  // seedIfEmpty 已删除：旧 demo seed 写的是 PG schema 里不存在的旧表 transactions，
  // 一旦在空库执行就会崩（现库有数据早退才没炸）。需要 demo 数据时另写对齐新 schema 的脚本
})();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
// H5 应用挂在 /app 路径（hash 路由，深链形如 /app/#/pages/...）。
// 曾试过 app.herix.huaxuex.com 子域名：三级子域名超出 Universal SSL 覆盖（*.huaxuex.com 只到一级），弃用
const H5_DIR = path.join(__dirname, '../../herix-miniapp/dist/h5');
// H5 产物已是内容哈希文件名（app.<hash>.js）：哈希资源可长缓存 immutable，
// index.html 保持 no-cache 以在发布时拿到新哈希引用（2026-08-05）
app.use('/app', express.static(H5_DIR, {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, max-age=0');
  },
}));
app.get('/app/*', (_req, res) => res.sendFile(path.join(H5_DIR, 'index.html')));
// 新版商家后台（React SPA）挂在 /merchant；旧 merchant.html 保留在 /merchant.html 过渡期并存
const MERCHANT_DIR = path.join(__dirname, '../../herix-merchant/dist');
app.use('/merchant', express.static(MERCHANT_DIR));
app.get('/merchant/*', (_req, res) => res.sendFile(path.join(MERCHANT_DIR, 'index.html')));
// 根路径 → 项目根目录（营销主页、merchant.html 等）
app.use('/', express.static(path.join(__dirname, '../../')));
// 用户上传的品牌素材（LOGO/宣传图）
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());
// 轻量请求日志（2026-08-06 排查小程序首屏加载）：记录 method/path/状态/耗时/返回大小
// DEBUG_REQ=1 时追加时间戳与客户端 IP，便于对会话（默认关）
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const extra = process.env.DEBUG_REQ === '1'
      ? ` ts=${new Date().toISOString()} ip=${req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''}`
      : '';
    console.log(`[req] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms len=${res.getHeader('content-length') || 0}${extra}`);
  });
  next();
});

// 客户端诊断上报（2026-08-06）：小程序首屏失败/超时时主动上报，抓"请求没到服务器"的场景
app.post('/api/diag/miniapp', (req, res) => {
  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : [body];
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  for (const e of events) {
    console.log('[diag]', JSON.stringify({
      path: e.path || '', method: e.method || '', err: String(e.err || '').slice(0, 200),
      status: e.status ?? null, elapsed: e.elapsed ?? null, env: e.env || '',
      hasToken: e.hasToken ?? null, locale: e.locale || '', ts: e.ts || new Date().toISOString(),
      ip,
    }));
  }
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 平台公开信息（运营主体等，服务协议渲染用；值在 platform_settings 维护）
app.get('/api/platform-info', async (_req, res) => {
  const { getSetting } = await import('./utils/settings');
  res.json({ operatorEntity: (await getSetting('operator_entity')) || 'AfterWork株式会社' });
});

app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/applications', applicationRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/users', usersRouter);
app.use('/api/ratings', ratingsRouter);
app.use('/api/ambassador', ambassadorRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/qr', qrRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/specialty-tags', specialtyTagsRouter);
app.use('/api/communities', communitiesRouter);
app.use('/api/sites', sitesRouter);
app.use('/api/i18n', i18nPublicRouter);
app.use('/api/arbitrations', arbitrationsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/legal', legalRouter);
app.use('/api/brand/invoices', brandInvoicesRouter);
app.use('/t', shortLinksRouter);

const INVITE_I18N: Record<string, Record<string, string>> = {
  zh: {
    topLabel: '大使邀请',
    step3: '获得专属优惠',
    wechatOpenHint: '请在右上角「在浏览器打开」后继续注册，邀请码已复制备用',
    codeLabel: '使用邀请码享受专属优惠',
    copyBtn: '复制',
    codeHint: '注册完成后请确保正确使用邀请码，如有问题请咨询邀请你的大使',
    stepsLabel: '领取步骤',
    step1: '复制邀请码',
    step2: '完成注册并确保<br>正确使用邀请码',
    conditionsLabel: '参与条件',
    registerBtn: '立即注册',
    copyPrimBtn: '复制邀请码',
    copied: '邀请码已复制 ✓',
  },
  ja: {
    topLabel: 'アンバサダー招待',
    step3: '特典を受け取る',
    wechatOpenHint: '右上の「ブラウザで開く」から続けてください。紹介コードはコピー済みです',
    codeLabel: '紹介コードで特典をゲット',
    copyBtn: 'コピー',
    codeHint: '登録後、紹介コードを必ず使用してください。ご不明な点はご紹介いただいたアンバサダーへご連絡ください。',
    stepsLabel: '受け取り手順',
    step1: '紹介コードをコピー',
    step2: '登録を完了し、<br>紹介コードを正しく使用',
    conditionsLabel: '参加条件',
    registerBtn: '今すぐ登録',
    copyPrimBtn: '紹介コードをコピー',
    copied: '紹介コードをコピーしました ✓',
  },
  en: {
    topLabel: 'Ambassador Invitation',
    step3: 'Get your reward',
    wechatOpenHint: 'Tap “Open in Browser” in the top-right corner to continue. Your referral code is copied.',
    codeLabel: 'Get your exclusive reward with referral code',
    copyBtn: 'Copy',
    codeHint: 'After registration, make sure to use the referral code correctly. Contact your Ambassador if you have questions.',
    stepsLabel: 'How to claim',
    step1: 'Copy referral code',
    step2: 'Complete registration<br>and use the referral code',
    conditionsLabel: 'Eligibility',
    registerBtn: 'Register now',
    copyPrimBtn: 'Copy referral code',
    copied: 'Referral code copied ✓',
  },
};

function detectInviteLocale(req: any): string {
  const qLang = typeof req.query?.lang === 'string' ? req.query.lang.split('-')[0].toLowerCase() : null;
  if (qLang && INVITE_I18N[qLang]) return qLang;
  const accept: string = req.headers?.['accept-language'] || '';
  for (const part of accept.split(',')) {
    const l = part.trim().split(/[-;]/)[0].toLowerCase();
    if (INVITE_I18N[l]) return l;
  }
  return 'zh';
}

/** GET /invite/:code — 公开邀请落地页（朋友扫码/点链接看到的页面） */
app.get('/invite/:code', async (req, res) => {
  try {
  const code = (req.params.code || '').toUpperCase();
  const locale = detectInviteLocale(req);
  const i = INVITE_I18N[locale] ?? INVITE_I18N.zh;
  const row = await findOne<any>(
    `SELECT t.id as task_id, t.title, t.description, trs.register_url, t.service_logo_url,
            t.service_name,
            trs.invitee_benefit, trs.conversion_criteria,
            at.share_intro,
            bp.company_name as brand_name, bp.logo_url as brand_logo_url,
            tt.invitee_benefit as invitee_benefit_tr,
            tt.conversion_criteria_json as conversion_criteria_tr,
            tt.title as title_tr,
            tt.service_name as service_name_tr
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     LEFT JOIN task_referral_specs trs ON trs.task_id = t.id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     LEFT JOIN task_translations tt ON tt.task_id = t.id AND tt.locale = $2
     WHERE at.unique_code = $1 AND at.status = 'active'
     LIMIT 1`,
    [code, locale]
  );
  if (!row) return res.status(404).send('<h2 style="font-family:sans-serif;padding:40px">推广码无效或已失效</h2>');

  const base = process.env.BASE_URL || 'https://herix.huaxuex.com';
  const h5TaskUrl = `${base}/app/index.html#/pages/landing/index?task=${row.task_id}`;
  const esc = (s: string | null | undefined) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // 转化条件：优先用翻译版，fallback 原文；register label + convert 列表
  let criteriaLines: string[] = [];
  try {
    const ccRaw = row.conversion_criteria_tr
      ? (typeof row.conversion_criteria_tr === 'string' ? JSON.parse(row.conversion_criteria_tr) : row.conversion_criteria_tr)
      : (typeof row.conversion_criteria === 'string' ? JSON.parse(row.conversion_criteria) : row.conversion_criteria);
    if (ccRaw?.register?.label) criteriaLines.push(ccRaw.register.label);
    if (Array.isArray(ccRaw?.convert)) {
      for (const item of ccRaw.convert) {
        const label = typeof item === 'string' ? item : item?.label;
        if (label) criteriaLines.push(label);
      }
    }
  } catch {}

  // 有翻译时覆盖 invitee_benefit
  const inviteeBenefit = row.invitee_benefit_tr || row.invitee_benefit;
  // 标题与服务名同样取翻译（2026-08-05：此前邀请页只有 invitee_benefit/转化条件本地化）
  const title = row.title_tr || row.title;

  // 服务 LOGO 优先用 service_logo_url，没有再用品牌 logo
  const logoUrl = row.service_logo_url || row.brand_logo_url;
  // 品牌/服务显示名：任务填写的 service_name > 商家公司名
  const displayBrandName = row.service_name_tr || row.service_name || row.brand_name;
  // 一句话：赫使自定义文案 > 任务标题（不用 description 避免内部细节泄漏）
  const oneliner = row.share_intro || title;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="${locale}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Herix 邀请</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#f5f5f7;color:#111;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;font-size:14px;line-height:1.5}
.page{max-width:390px;margin:0 auto;padding:16px 16px 132px}
/* 顶栏 */
.topbar{display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:0 4px}
.herix-logo{width:24px;height:24px;border-radius:6px;object-fit:cover;flex-shrink:0}
.herix-name{font-size:14px;font-weight:600;color:#111}
.topbar-sep{color:#c7c7cc;font-size:12px}
.invite-label{font-size:12px;color:#8a8a8e}
/* 卡片 */
.card{background:#fff;border-radius:16px;overflow:hidden;margin-bottom:12px;border:1px solid rgba(0,0,0,0.04)}
/* 品牌区 */
.brand-section{padding:20px 20px 18px}
.brand-row{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.service-logo{width:48px;height:48px;border-radius:12px;object-fit:contain;background:#f5f5f7;flex-shrink:0}
.brand-name{font-size:16px;font-weight:700;color:#111;line-height:1.3}
.oneliner{font-size:13px;color:#8a8a8e;margin-top:3px;line-height:1.5}
.benefit-hero{font-size:26px;font-weight:700;color:#111;line-height:1.4;letter-spacing:-.3px;overflow-wrap:break-word}
/* 邀请码区 */
.code-section{padding:18px 20px 20px}
.code-label{font-size:12px;font-weight:600;color:#d43b27;margin-bottom:12px;letter-spacing:.02em}
.code-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.scode{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:22px;font-weight:700;color:#111;letter-spacing:1.5px}
.scopy{flex-shrink:0;background:#d43b27;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.scopy:active{background:#b33120}
.code-hint{font-size:12px;color:#8a8a8e;margin-top:10px;line-height:1.6}
/* 步骤区 */
.steps-section{padding:18px 20px 20px}
.steps-label{font-size:12px;font-weight:600;color:#444;margin-bottom:16px}
.steps{display:flex;align-items:flex-start}
.step{flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;position:relative;padding:0 6px;min-width:0}
.step+.step::before{content:'';position:absolute;top:13px;left:calc(-50% + 14px);right:calc(50% + 14px);height:1px;background:#e5e5ea}
.step-num{width:27px;height:27px;border-radius:50%;background:#ffece9;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#d43b27;position:relative;z-index:1;flex-shrink:0}
.step-main{font-size:12px;font-weight:500;color:#111;text-align:center;line-height:1.5;word-break:break-word}
/* 分割线 */
.divider{height:1px;background:#f2f2f7;margin:0 20px}
/* 条件小字 */
.conditions-section{padding:14px 20px 18px;font-size:12px;color:#8a8a8e;line-height:1.8}
.conditions-title{font-weight:600;color:#444;margin-bottom:6px}
/* CTA */
.ctawrap{position:fixed;bottom:0;left:0;right:0;padding:12px 16px 34px;background:linear-gradient(to top,#f5f5f7 72%,transparent)}
.ctainner{max-width:390px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
.ctabtn{width:100%;padding:15px;background:#d43b27;color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.02em}
.ctabtn:active{background:#b33120}
.ctabtn-sec{width:100%;padding:13px;background:#fff;color:#111;border:1px solid #e5e5ea;border-radius:14px;font-size:15px;font-weight:500;cursor:pointer;font-family:inherit}
.toast{position:fixed;bottom:150px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;font-weight:500;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;z-index:100}
.toast.show{opacity:1}
</style></head><body>
<div class="page">

  <div class="topbar">
    <img class="herix-logo" src="/merchant/logo.png" alt="Herix">
    <span class="herix-name">Herix</span>
    <span class="topbar-sep">|</span>
    <span class="invite-label">${i.topLabel}</span>
  </div>

  <div class="card">
    <div class="brand-section">
      <div class="brand-row">
        ${logoUrl ? `<img class="service-logo" src="${esc(logoUrl)}" alt="logo">` : ''}
        <div>
          ${displayBrandName ? `<div class="brand-name">${esc(displayBrandName)}</div>` : ''}
          <div class="oneliner">${esc(oneliner)}</div>
        </div>
      </div>
      ${inviteeBenefit ? `<div class="benefit-hero">${esc(inviteeBenefit)}</div>` : ''}
    </div>

    <div class="divider"></div>

    <div class="code-section">
      <div class="code-label">${i.codeLabel}</div>
      <div class="code-row">
        <div class="scode">${esc(code)}</div>
        <button class="scopy" id="scopyBtn" onclick="copyCode()">${i.copyBtn}</button>
      </div>
      <div class="code-hint">${i.codeHint}</div>
    </div>

    <div class="divider"></div>

    <div class="steps-section">
      <div class="steps-label">${i.stepsLabel}</div>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-main">${i.step1}</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-main">${i.step2}</div>
        </div>
        ${inviteeBenefit ? `
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-main">${i.step3}</div>
        </div>` : ''}
      </div>
    </div>

    ${criteriaLines.length ? `<div class="divider"></div><div class="conditions-section"><div class="conditions-title">${i.conditionsLabel}</div>${criteriaLines.map(l => `<div>· ${esc(l)}</div>`).join('')}</div>` : ''}
  </div>

</div>

<div class="ctawrap"><div class="ctainner">
  ${row.register_url
    ? `<button class="ctabtn" onclick="openApp()">${i.registerBtn}</button>
       <button class="ctabtn-sec" onclick="copyCode()">${i.copyPrimBtn}</button>`
    : `<button class="ctabtn" onclick="copyCode()">${i.copyPrimBtn}</button>`}
</div></div>

<div class="toast" id="toast">${i.copied}</div>
<script>
function copyCode(){
  navigator.clipboard&&navigator.clipboard.writeText('${code}');
  var b=document.getElementById('scopyBtn');
  b.textContent='${i.copied}';b.style.background='#34C759';
  showToast('${i.copied}');
  setTimeout(function(){b.textContent='${i.copyBtn}';b.style.background='';},2200);
}
function isWechat(){
  return /MicroMessenger/i.test(navigator.userAgent||'');
}
function openApp(){
  var url='${esc(row.register_url || '')}';
  if(!url){copyCode();return;}
  if(isWechat()){
    // 微信内置浏览器会拦截 window.open/App Store 跳转，引导右上角浏览器打开
    showToast('${i.wechatOpenHint}');
    copyCode();
    return;
  }
  window.open(url,'_blank');
  copyCode();
}
function showToast(m){
  var t=document.getElementById('toast');
  t.textContent=m;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2000);
}
</script>
</body></html>`);
  } catch (e) {
    console.error('/invite error:', e);
    res.status(500).send('<h2 style="font-family:sans-serif;padding:40px">页面加载失败，请稍后重试</h2>');
  }
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// Express 4 不会把 async handler 的 rejection 交给上面的错误中间件，
// 缺了这层任何一个路由抛异常都会打崩整个进程（2026-07-16 实测：结算路径 FK 错误导致全站宕机）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// 后台任务统一调度：所有轮询收拢到 jobs/registry，单实例 pg advisory lock 防多副本双跑
import { startJobs } from './jobs/scheduler';
import { JOBS } from './jobs/registry';
startJobs(JOBS);

app.listen(PORT, () => {
  console.log(`Herix server running on http://localhost:${PORT}`);
});
