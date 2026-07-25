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
import { UPLOADS_DIR } from './utils/uploads';

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

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// Express 4 不会把 async handler 的 rejection 交给上面的错误中间件，
// 缺了这层任何一个路由抛异常都会打崩整个进程（2026-07-16 实测：结算路径 FK 错误导致全站宕机）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// 汇率中间价自动同步（锁价基准），启动+每6小时
import { startFxSync } from './utils/fxSync';
startFxSync();

// 交付双向计时器（催审/超时自动通过/名额释放），启动30秒后首跑+每小时
import { startSubmissionTimers } from './utils/submissionTimers';
startSubmissionTimers();

app.listen(PORT, () => {
  console.log(`Herix server running on http://localhost:${PORT}`);
});
