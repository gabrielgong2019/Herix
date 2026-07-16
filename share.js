// 分享服务器 - 合并静态文件和API代理到一个端口
// node share.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 3999;

function getMime(ext) {
  const m = { html:'text/html', js:'application/javascript', css:'text/css', png:'image/png',
              jpg:'image/jpeg', json:'application/json', svg:'image/svg+xml', ico:'image/x-icon' };
  return m[ext] || 'text/plain';
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // API 请求代理到后端 3004
  if (url.startsWith('/api/')) {
    const options = {
      hostname: 'localhost',
      port: 3004,
      path: url,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:3004' }
    };
    const proxy = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('Proxy Error'); });
    req.pipe(proxy);
    return;
  }

  // 静态文件
  let filePath = url === '/' ? '/herix.html' : url;
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': getMime(path.extname(filePath).slice(1)),
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n📡 分享服务器已启动`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   http://localhost:${PORT}/herix.html`);
  console.log(`   http://localhost:${PORT}/merchant.html`);
  console.log(`   http://localhost:${PORT}/admin.html`);
  console.log(`\n🔗 用 ngrok 分享出去:`);
  console.log(`   ngrok http ${PORT}`);
  console.log('');
});
