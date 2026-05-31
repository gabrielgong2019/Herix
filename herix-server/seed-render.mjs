// Render 种子数据 — 通过 API 创建完整示例数据
// 部署后在 Render Shell 运行: node seed-render.mjs

const BASE = process.env.RENDER_EXTERNAL_URL 
  ? `https://${process.env.RENDER_EXTERNAL_URL}/api` 
  : 'http://localhost:3005/api';

async function api(method, path, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: data ? JSON.stringify(data) : undefined });
  if (res.status >= 400) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  console.log('Seeding at:', BASE);

  // 1. Register admin
  console.log('1. Admin');
  const admin = await api('POST', '/auth/register', {
    email: 'admin@herix.com', password: '123456', nickname: 'Herix运营', role: 'BRAND'
  });
  console.log('   admin created:', admin.user.nickname);

  // 2. Register brand
  console.log('2. Brand');
  const brand = await api('POST', '/auth/register', {
    email: 'brand@d.com', password: '123456', nickname: '周大福珠宝', role: 'BRAND'
  });
  const bt = brand.token;
  console.log('   brand created:', brand.user.nickname);

  // 3. Create tasks for brand
  console.log('3. Brand tasks');
  const taskData = [
    { title: '新品珠宝推广 #1', description: '在海外华人社群推广新款珠宝，需要拍摄佩戴照片并分享体验。', budget: 3500, commission: 400, maxHeralds: 3 },
    { title: '新品珠宝推广 #2', description: '在海外华人社群推广新款珠宝，需要拍摄佩戴照片并分享体验。', budget: 4000, commission: 500, maxHeralds: 3 },
    { title: '新品珠宝推广 #3', description: '在海外华人社群推广新款珠宝，需要拍摄佩戴照片并分享体验。', budget: 4500, commission: 600, maxHeralds: 3 },
    { title: 'Remitly 品牌大使', description: '分享 Remitly 汇款推荐码，每成功转化一位注册用户获得奖励。', budget: 300000, commission: 3000, maxHeralds: 100, mode: 'PERFORMANCE' },
    { title: '熊猫外卖拉新大使', description: '在中国社群分享熊猫外卖推荐码，新注册用户即算成功。', budget: 200000, commission: 2000, maxHeralds: 100, mode: 'PERFORMANCE' },
    { title: '母婴产品体验', description: '体验并分享母婴产品使用心得，需拍摄使用照片。', budget: 200000, commission: 20000, maxHeralds: 3 },
    { title: '口红新品测评', description: '试色并分享口红新品，发布到小红书或Instagram。', budget: 200000, commission: 20000, maxHeralds: 3 },
  ];

  for (const td of taskData) {
    const t = await api('POST', '/tasks', {
      mode: td.mode || 'STANDARD',
      title: td.title,
      description: td.description,
      budget: td.budget,
      commission: td.commission,
      maxHeralds: td.maxHeralds,
    }, bt);
    await api('PATCH', `/tasks/${t.id}/publish`, {}, bt);
    await api('PATCH', `/tasks/${t.id}/escrow`, {}, bt);
    console.log('   task:', td.title);
  }

  // 4. Register heralds
  console.log('4. Heralds');
  
  const gabriel = await api('POST', '/auth/register', {
    email: 'gabrielgong2019@outlook.com', password: '123456', nickname: 'Gabriel', role: 'HERALD'
  });
  const gt = gabriel.token;
  await api('PATCH', '/users/profile/herald', {
    displayName: 'Gabriel', residence: 'japan', kyc_status: 'approved'
  }, gt);
  console.log('   Gabriel created');

  const alice = await api('POST', '/auth/register', {
    email: 'alice@d.com', password: '123456', nickname: 'Alice海外达人', role: 'HERALD'
  });
  const at = alice.token;
  await api('PATCH', '/users/profile/herald', {
    displayName: 'Alice海外达人', country: '美国', diasporaGroup: '华人', specialties: ['美妆', '珠宝', '生活方式'],
    residence: 'usa', kyc_status: 'approved'
  }, at);
  console.log('   Alice created');

  // 5. Get task IDs for applications
  const tasks = await api('GET', '/tasks', {}, bt);
  const findTask = (title) => tasks.tasks.find(t => t.title === title);
  
  const tJewelry1 = findTask('新品珠宝推广 #1');
  const tRemitly = findTask('Remitly 品牌大使');
  const tMom = findTask('母婴产品体验');
  const tLipstick = findTask('口红新品测评');

  // 6. Alice applies to #1 + Remitly
  console.log('5. Applications');
  await api('POST', `/applications/${tJewelry1.id}`, {}, at);
  await api('POST', `/applications/${tRemitly.id}`, {}, at);
  console.log('   Alice applied to 珠宝#1 + Remitly');

  // 7. Brand approves Alice for #1
  const brandApps = await api('GET', '/applications/my', { headers: { Authorization: 'Bearer ' + bt } });
  // Actually need admin or brand review endpoint... let me use direct admin access
  // For simplicity, login as admin and review
  const adminLogin = await api('POST', '/auth/login', { account: 'admin@herix.com', password: '123456' });
  const adminToken = adminLogin.token;
  
  // Get the applications (admin can review)
  const allApps = await fetch(BASE + '/tasks/' + tJewelry1.id, {
    headers: { Authorization: 'Bearer ' + bt }
  }).then(r => r.json());
  
  const aliceApp = allApps.applications.find(a => a.nickname === 'Alice海外达人');
  if (aliceApp) {
    await api('PATCH', `/applications/${aliceApp.id}/review`, { status: 'APPROVED' }, bt);
    console.log('   Alice jewelry#1: APPROVED');
  }

  // 8. Alice submits to #1
  await api('POST', `/submissions/${tJewelry1.id}`, {
    contentUrl: 'https://instagram.com/p/test',
    description: '完成了品牌体验拍摄，发布了3篇图文笔记'
  }, at);
  console.log('   Alice submitted to 珠宝#1');
  
  // Brand approves submission
  const subs = await api('GET', '/submissions/my', {}, at);
  const sub1 = subs.find(s => s.task_id === tJewelry1.id && s.status === 'PENDING_REVIEW');
  if (sub1) {
    await api('PATCH', `/submissions/${sub1.id}/review`, { status: 'APPROVED' }, bt);
    console.log('   Alice submission: APPROVED');
  }

  // 9. Gabriel applies to lipstick + remitly
  await api('POST', `/applications/${tLipstick.id}`, {}, gt);
  await api('POST', `/applications/${tRemitly.id}`, {}, gt);
  console.log('   Gabriel applied to 口红 + Remitly');

  // Approve Gabriel
  const remitlyDetail = await fetch(BASE + '/tasks/' + tRemitly.id, {
    headers: { Authorization: 'Bearer ' + bt }
  }).then(r => r.json());
  const gabrielRemitlyApp = remitlyDetail.applications.find(a => a.nickname === 'Gabriel');
  if (gabrielRemitlyApp) {
    await api('PATCH', `/applications/${gabrielRemitlyApp.id}/review`, { status: 'APPROVED' }, bt);
    console.log('   Gabriel Remitly: APPROVED (auto code assigned)');
  }

  const lipstickDetail = await fetch(BASE + '/tasks/' + tLipstick.id, {
    headers: { Authorization: 'Bearer ' + bt }
  }).then(r => r.json());
  const gabrielLipApp = lipstickDetail.applications.find(a => a.nickname === 'Gabriel');
  if (gabrielLipApp) {
    await api('PATCH', `/applications/${gabrielLipApp.id}/review`, { status: 'APPROVED' }, bt);
    console.log('   Gabriel 口红: APPROVED');
  }

  console.log('\nSeed complete!');
  console.log('Test accounts (password: 123456):');
  console.log('  admin@herix.com (ADMIN)');
  console.log('  brand@d.com (BRAND)');
  console.log('  gabrielgong2019@outlook.com (HERALD)');
  console.log('  alice@d.com (HERALD)');
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
