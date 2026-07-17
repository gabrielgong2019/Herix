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
import { i18nPublicRouter } from './routes/i18n';
import { UPLOADS_DIR } from './utils/uploads';

(async () => {
  await initDatabase();
  // seedIfEmpty 已删除：旧 demo seed 写的是 PG schema 里不存在的旧表 transactions，
  // 一旦在空库执行就会崩（现库有数据早退才没炸）。需要 demo 数据时另写对齐新 schema 的脚本
})();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
// app.herix.huaxuex.com → H5 小程序
const h5Static = express.static(path.join(__dirname, '../../herix-miniapp/dist/h5'));
app.use((req, res, next) => {
  // app.localhost 供本地开发预览 H5（浏览器原生支持 *.localhost 解析）
  if (req.hostname === 'app.herix.huaxuex.com' || req.hostname === 'app.localhost') {
    return h5Static(req, res, () => res.sendFile(path.join(__dirname, '../../herix-miniapp/dist/h5/index.html')));
  }
  next();
});
// 其他域名 → 项目根目录（营销主页、merchant.html 等）
app.use('/', express.static(path.join(__dirname, '../../')));
// 用户上传的品牌素材（LOGO/宣传图）
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.use('/api/i18n', i18nPublicRouter);

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

app.listen(PORT, () => {
  console.log(`Herix server running on http://localhost:${PORT}`);
});
