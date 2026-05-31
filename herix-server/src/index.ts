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

initDatabase();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
// 优先：小程序的 H5 版
app.use('/', express.static(path.join(__dirname, '../../herix-miniapp/dist')));
// 后备：项目根目录的静态文件
app.use('/', express.static(path.join(__dirname, '../../')));
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

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`Herix server running on http://localhost:${PORT}`);
});
