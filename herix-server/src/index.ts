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
app.use('/app', express.static(H5_DIR));
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
app.use('/t', shortLinksRouter);

/** GET /invite/:code — 公开邀请落地页（朋友扫码/点链接看到的页面） */
app.get('/invite/:code', async (req, res) => {
  try {
  const code = (req.params.code || '').toUpperCase();
  const row = await findOne<any>(
    `SELECT t.id as task_id, t.title, t.description, trs.register_url, t.service_logo_url,
            t.service_name,
            trs.invitee_benefit, trs.conversion_criteria,
            at.share_intro,
            bp.company_name as brand_name, bp.logo_url as brand_logo_url
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     LEFT JOIN task_referral_specs trs ON trs.task_id = t.id
     LEFT JOIN brand_profiles bp ON bp.user_id = t.creator_id
     WHERE at.unique_code = $1 AND at.status = 'active'
     LIMIT 1`,
    [code]
  );
  if (!row) return res.status(404).send('<h2 style="font-family:sans-serif;padding:40px">推广码无效或已失效</h2>');

  const base = process.env.BASE_URL || 'https://herix.huaxuex.com';
  const h5TaskUrl = `${base}/app/index.html#/pages/landing/index?task=${row.task_id}`;
  const esc = (s: string | null | undefined) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // 转化条件：register label + convert 列表（对象或字符串均支持）
  let criteriaLines: string[] = [];
  try {
    const cc = typeof row.conversion_criteria === 'string' ? JSON.parse(row.conversion_criteria) : row.conversion_criteria;
    if (cc?.register?.label) criteriaLines.push(cc.register.label);
    if (Array.isArray(cc?.convert)) {
      for (const item of cc.convert) {
        const label = typeof item === 'string' ? item : item?.label;
        if (label) criteriaLines.push(label);
      }
    }
  } catch {}

  // 服务 LOGO 优先用 service_logo_url，没有再用品牌 logo
  const logoUrl = row.service_logo_url || row.brand_logo_url;
  // 品牌/服务显示名：任务填写的 service_name > 商家公司名
  const displayBrandName = row.service_name || row.brand_name;
  // 一句话：赫使自定义文案 > 任务标题（不用 description 避免内部细节泄漏）
  const oneliner = row.share_intro || row.title;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(row.title)} — Herix 邀请</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#F2F2F7;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;font-size:14px}
.page{max-width:390px;margin:0 auto;padding:16px 16px 130px}
/* 顶栏 */
.topbar{display:flex;align-items:center;gap:6px;margin-bottom:16px;padding:0 2px}
.herix-logo{width:24px;height:24px;border-radius:6px;object-fit:cover;flex-shrink:0}
.herix-name{font-size:14px;font-weight:600;color:#1C1C1E}
.topbar-sep{color:#C7C7CC;font-size:12px;margin:0 2px}
.invite-label{font-size:13px;color:#8E8E93}
/* 卡片 */
.card{background:#FFFFFF;border-radius:16px;overflow:hidden;margin-bottom:10px}
/* 品牌区 */
.brand-section{padding:18px 18px 16px}
.brand-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.service-logo{width:44px;height:44px;border-radius:12px;object-fit:contain;background:#F2F2F7;flex-shrink:0}
.brand-name{font-size:15px;font-weight:600;color:#1C1C1E;line-height:1.3}
.oneliner{font-size:13px;color:#8E8E93;margin-top:2px;line-height:1.45}
.benefit-hero{font-size:32px;font-weight:700;color:#1C1C1E;line-height:1.2;letter-spacing:-.5px;word-break:break-all}
/* 邀请码区 */
.code-section{padding:18px}
.code-label{font-size:12px;font-weight:500;color:#d43b27;margin-bottom:10px;letter-spacing:.03em}
.code-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.scode{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:24px;font-weight:700;color:#1C1C1E;letter-spacing:2px}
.scopy{flex-shrink:0;background:#d43b27;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.code-hint{font-size:12px;color:#8E8E93;margin-top:10px;line-height:1.5}
/* 步骤区 */
.steps-section{padding:18px}
.steps-label{font-size:12px;font-weight:500;color:#8E8E93;margin-bottom:14px;letter-spacing:.02em}
.steps{display:flex;align-items:flex-start}
.step{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;position:relative;padding:0 4px}
.step+.step::before{content:'';position:absolute;top:13px;left:calc(-50% + 13px);right:calc(50% + 13px);height:1px;background:#E5E5EA}
.step-num{width:26px;height:26px;border-radius:50%;background:#FFE8E5;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#d43b27;position:relative;z-index:1;flex-shrink:0}
.step-main{font-size:11px;font-weight:500;color:#1C1C1E;text-align:center;line-height:1.5}
.step-hint{font-size:10px;color:#8E8E93;text-align:center;line-height:1.4;margin-top:2px}
/* 分割线 */
.divider{height:1px;background:#F2F2F7;margin:0 18px}
/* 条件小字 */
.conditions-section{padding:14px 18px;font-size:11px;color:#8E8E93;line-height:1.7}
/* CTA */
.ctawrap{position:fixed;bottom:0;left:0;right:0;padding:12px 16px 34px;background:linear-gradient(to top,#F2F2F7 70%,transparent)}
.ctainner{max-width:390px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.ctabtn{width:100%;padding:15px;background:#d43b27;color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.02em}
.ctabtn-sec{width:100%;padding:13px;background:#fff;color:#1C1C1E;border:none;border-radius:14px;font-size:15px;font-weight:500;cursor:pointer;font-family:inherit}
.toast{position:fixed;bottom:150px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;font-weight:500;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;z-index:100}
.toast.show{opacity:1}
</style></head><body>
<div class="page">

  <div class="topbar">
    <img class="herix-logo" src="/merchant/logo.png" alt="Herix">
    <span class="herix-name">Herix</span>
    <span class="topbar-sep">|</span>
    <span class="invite-label">大使邀请</span>
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
      ${row.invitee_benefit ? `<div class="benefit-hero">${esc(row.invitee_benefit)}</div>` : ''}
    </div>

    <div class="divider"></div>

    <div class="code-section">
      <div class="code-label">使用邀请码享受专属优惠</div>
      <div class="code-row">
        <div class="scode">${esc(code)}</div>
        <button class="scopy" id="scopyBtn" onclick="copyCode()">复制</button>
      </div>
      <div class="code-hint">注册完成后请确保正确使用邀请码，如有问题请咨询邀请你的大使</div>
    </div>

    <div class="divider"></div>

    <div class="steps-section">
      <div class="steps-label">领取步骤</div>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-main">复制邀请码</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-main">完成注册并确保<br>正确使用邀请码</div>
        </div>
        ${row.invitee_benefit ? `
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-main">${esc(row.invitee_benefit)}</div>
        </div>` : ''}
      </div>
    </div>

    ${criteriaLines.length ? `<div class="divider"></div><div class="conditions-section"><div style="font-weight:600;color:#636366;margin-bottom:6px">参与条件</div>${criteriaLines.map(l => `<div>· ${esc(l)}</div>`).join('')}</div>` : ''}
  </div>

</div>

<div class="ctawrap"><div class="ctainner">
  ${row.register_url
    ? `<button class="ctabtn" onclick="openApp()">立即注册</button>
       <button class="ctabtn-sec" onclick="copyCode()">复制邀请码</button>`
    : `<button class="ctabtn" onclick="copyCode()">复制邀请码</button>`}
</div></div>

<div class="toast" id="toast">邀请码已复制 ✓</div>
<script>
function copyCode(){
  navigator.clipboard&&navigator.clipboard.writeText('${code}');
  var b=document.getElementById('scopyBtn');
  b.textContent='已复制';b.style.background='#34C759';
  showToast('邀请码已复制 ✓');
  setTimeout(function(){b.textContent='复制';b.style.background='';},2200);
}
function openApp(){
  var url='${esc(row.register_url || '')}';
  if(url)window.open(url,'_blank');
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
