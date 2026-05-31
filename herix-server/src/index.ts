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

// 初始化数据库
initDatabase();

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.static(path.join(__dirname, '../../'), {
  setHeaders: (res: any, filePath: string) => {
    const ext = path.extname(filePath);
    if (ext === '.html') res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (ext === '.js') res.setHeader('Content-Type', 'application/javascript');
    if (ext === '.css') res.setHeader('Content-Type', 'text/css');
  }
}));
app.use(express.json());

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 路由
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

// 全局错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`Herix server running on http://localhost:${PORT}`);
});
