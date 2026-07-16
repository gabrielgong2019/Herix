import express from 'express';
import path from 'path';
import cors from 'cors';
import { initDatabase } from './db';
import { seedIfEmpty } from './seed';
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
  await seedIfEmpty().catch(err => console.error('seed failed:', err));
})();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
// 优先：小程序的 H5 版
app.use('/', express.static(path.join(__dirname, '../../herix-miniapp/dist/h5')));
// 后备：项目根目录的静态文件
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

app.listen(PORT, () => {
  console.log(`Herix server running on http://localhost:${PORT}`);
});
