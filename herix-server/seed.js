// Run: node seed.js (after npm run dev in another terminal)
const API = 'http://localhost:3004/api';
async function main() {
  const fetch = (await import('node-fetch')).default || require('node-fetch');
  // Fallback: use http
  const http = require('http');
  
  function api(method, path, data, token) {
    return new Promise((resolve, reject) => {
      const body = data ? JSON.stringify(data) : undefined;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const url = new URL(API + path);
      const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers };
      const req = http.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d)); }});
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
  
  try {
    const b = await api('POST', '/auth/register', {email:'brand@d.com',password:'123456',nickname:'周大福珠宝',role:'BRAND'});
    const bt = b.token;
    console.log('✅ Brand:', b.user.nickname);
    
    for (let i = 1; i <= 3; i++) {
      const t = await api('POST', '/tasks', {title:`新品珠宝推广 #${i}`,description:'在海外华人社群推广新款珠宝，需要拍摄佩戴照片并分享体验。目标受众25-45岁海外华人女性。',budget:3000+500*i,commission:300+100*i,maxHeralds:3}, bt);
      await api('PATCH', `/tasks/${t.id}/publish`, {}, bt);
      await api('PATCH', `/tasks/${t.id}/escrow`, {}, bt);
      console.log(`✅ Task #${i} created`);
    }
    
    const h = await api('POST', '/auth/register', {email:'alice@d.com',password:'123456',nickname:'Alice海外达人',role:'HERALD'});
    await api('PATCH', '/users/profile/herald', {displayName:'Alice海外达人',country:'美国',diasporaGroup:'华人',specialties:['美妆','珠宝','生活方式']}, h.token);
    console.log('✅ Herald:', h.user.nickname);
    
    const tasks = await api('GET', '/tasks');
    console.log(`\n📋 ${tasks.pagination.total} 个任务`);
    for (const t of tasks.tasks) console.log(`  [${t.status}] ${t.title} — ¥${t.commission}/人`);
  } catch(e) { console.error('Seed error:', e.message); }
}
main();
