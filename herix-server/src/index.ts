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
  const code = (req.params.code || '').toUpperCase();
  const row = await findOne<any>(
    `SELECT t.id as task_id, t.title, t.description, t.app_download_url,
            trs.invitee_benefit,
            at.share_intro
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     LEFT JOIN task_referral_specs trs ON trs.task_id = t.id
     WHERE at.unique_code = $1 AND at.status = 'active'
     LIMIT 1`,
    [code]
  );
  if (!row) return res.status(404).send('<h2 style="font-family:sans-serif;padding:40px">推广码无效或已失效</h2>');

  const base = process.env.BASE_URL || 'https://herix.huaxuex.com';
  const h5TaskUrl = `${base}/app/index.html#/pages/landing/index?task=${row.task_id}`;
  // 优先用赫使保存的自定义文案，没有则用任务简介
  row.display_description = row.share_intro || row.description;
  const esc = (s: string | null) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(row.title)} — Herix 邀请</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#F5F4FF;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.page{max-width:420px;margin:0 auto;padding:0 0 110px}
.topbar{display:flex;align-items:center;gap:8px;padding:18px 20px 14px}
.hbadge{display:flex;align-items:center;gap:6px;background:#5B4EFC;border-radius:20px;padding:4px 10px 4px 6px}
.hdot{width:20px;height:20px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#5B4EFC}
.hlabel{font-size:12px;font-weight:700;color:#fff;letter-spacing:.04em}
.from{font-size:12px;color:#9CA3AF;margin-left:4px}
.chip{display:inline-flex;align-items:center;background:#EEE9FF;color:#5B4EFC;border-radius:20px;padding:1px 8px;font-size:12px;font-weight:600}
.card{margin:0 16px;background:#fff;border-radius:20px;padding:24px 22px;border:1px solid #E5E7EB;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#5B4EFC,#9B8FFF)}
.brand{font-size:13px;color:#9CA3AF;margin-bottom:6px}
.intro{font-size:15px;color:#4B5563;line-height:1.6;margin-bottom:22px}
.stamp{background:#EDE9FF;border:2px dashed #5B4EFC;border-radius:14px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer}
.slabel{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5B4EFC;margin-bottom:4px}
.scode{font-family:monospace;font-size:26px;font-weight:800;color:#4134D4;letter-spacing:2px}
.scopy{flex-shrink:0;background:#5B4EFC;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.shint{font-size:11px;color:#9CA3AF;margin-top:8px;text-align:center}
.benefit{margin:12px 16px 0;background:#fff;border-radius:16px;padding:16px 18px;border:1px solid #E5E7EB;display:flex;align-items:flex-start;gap:12px}
.bicon{width:36px;height:36px;border-radius:10px;background:#FFF0E8;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.blabel{font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.bval{font-size:15px;font-weight:600;color:#111827;line-height:1.4}
.join-bar{margin:12px 16px 0;background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.jleft{}
.jtitle{font-size:13px;font-weight:700;color:#111827;margin-bottom:2px}
.jsub{font-size:12px;color:#9CA3AF}
.jbtn{flex-shrink:0;background:#EEE9FF;color:#5B4EFC;border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap}
.ctawrap{position:fixed;bottom:0;left:0;right:0;padding:12px 16px 28px;background:linear-gradient(to top,#F5F4FF 70%,transparent)}
.ctainner{max-width:420px;margin:0 auto}
.ctabtn{width:100%;padding:15px;background:#FF6B35;color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,107,53,.3)}
.ctanote{text-align:center;font-size:11px;color:#9CA3AF;margin-top:8px}
.toast{position:fixed;bottom:110px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:9px 18px;border-radius:20px;font-size:13px;font-weight:600;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;z-index:100}
.toast.show{opacity:1}
</style></head><body>
<div class="page">
  <div class="topbar">
    <div class="hbadge"><div class="hdot">H</div><span class="hlabel">HERIX</span></div>
    <span class="from">　<span class="chip">大使</span> 邀请你</span>
  </div>
  <div class="card">
    <div class="brand">Remitly</div>
    <div class="intro">${esc(row.display_description || row.title)}</div>
    <div class="stamp" onclick="copyCode()">
      <div><div class="slabel">你的专属推广码</div><div class="scode">${esc(code)}</div></div>
      <button class="scopy" id="scopyBtn">复制</button>
    </div>
    <div class="shint">注册时填入此码，福利自动到账</div>
  </div>
  ${row.invitee_benefit ? `
  <div class="benefit">
    <div class="bicon">🎁</div>
    <div><div class="blabel">好友专享优惠</div><div class="bval">${esc(row.invitee_benefit)}</div></div>
  </div>` : ''}
  <div class="join-bar">
    <div class="jleft">
      <div class="jtitle">你也想推广赚钱？</div>
      <div class="jsub">加入 Herix，接品牌推广任务</div>
    </div>
    <a class="jbtn" href="${esc(h5TaskUrl)}">了解 →</a>
  </div>
</div>
<div class="ctawrap"><div class="ctainner">
  ${row.app_download_url
    ? `<button class="ctabtn" onclick="openApp()">下载 App，立即注册 →</button>`
    : `<button class="ctabtn" onclick="copyCode()">复制推广码，前往 App 注册</button>`}
  <div class="ctanote">App Store · Google Play</div>
</div></div>
<div class="toast" id="toast">已复制 ✓</div>
<script>
function copyCode(){
  navigator.clipboard&&navigator.clipboard.writeText('${code}');
  var b=document.getElementById('scopyBtn');
  b.textContent='已复制';b.style.background='#059669';
  showToast('推广码已复制 ✓');
  setTimeout(function(){b.textContent='复制';b.style.background='';},2000);
}
function openApp(){
  var ua=navigator.userAgent;
  var url='${esc(row.app_download_url || '')}';
  if(!url)return;
  window.open(url,'_blank');
}
function showToast(m){
  var t=document.getElementById('toast');
  t.textContent=m;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2000);
}
</script>
</body></html>`);
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
