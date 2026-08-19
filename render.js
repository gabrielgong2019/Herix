/**
 * Herix - Render 部署入口
 * 合并静态文件服务和 API 代理，单端口运行
 */

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = process.env.PORT || 10000;

// 静态文件 - 从项目根目录提供
app.use(express.static(path.join(__dirname, 'herix-server', 'public')));
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath);
    if (ext === '.html') res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (ext === '.js' || ext === '.mjs') res.setHeader('Content-Type', 'application/javascript');
    if (ext === '.css') res.setHeader('Content-Type', 'text/css');
  }
}));

// 默认页面
app.get('/', (_req, res) => res.redirect('/herix.html'));

// 启动 API 服务（内嵌）
const { initDatabase } = require('./herix-server/dist/db');
initDatabase();

const { authRouter } = require('./herix-server/dist/routes/auth');
const { tasksRouter } = require('./herix-server/dist/routes/tasks');
const { submissionsRouter } = require('./herix-server/dist/routes/submissions');
const { applicationRouter } = require('./herix-server/dist/routes/applications');
const { usersRouter } = require('./herix-server/dist/routes/users');
const { ratingsRouter } = require('./herix-server/dist/routes/ratings');
const { ambassadorRouter } = require('./herix-server/dist/routes/ambassador');
const { referralsRouter } = require('./herix-server/dist/routes/referrals');
const { adminRouter } = require('./herix-server/dist/routes/admin');
const { walletRouter } = require('./herix-server/dist/routes/wallet');

app.use(express.json());
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

app.use((err, _req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Herix running on http://0.0.0.0:${PORT}`);
  console.log(`  Preview: /herix.html`);
  console.log(`  Merchant: /merchant/`);
  console.log(`  Admin: /admin.html`);
});
