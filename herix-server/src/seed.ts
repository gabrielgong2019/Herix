import pool from './db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const genId = () => crypto.randomBytes(16).toString('hex');
const genCode = () => 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();

export async function seedIfEmpty(): Promise<void> {
  const result = await pool.query("SELECT COUNT(*)::int as cnt FROM users");
  if (parseInt(result.rows[0].cnt) > 0) return;

  console.log('[seed] 空数据库，开始初始化种子数据...');
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  // 图片基础 URL
  const img = (id: string) => `https://images.unsplash.com/${id}?w=400&h=260&fit=crop`;

  // ── 1. 用户 ──
  const uBrand = genId(), uAlice = genId(), uAdmin = genId(), uGabriel = genId();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, nickname, role, roles) VALUES ($1,$2,$3,$4,$5,$6)",
    [uBrand, 'brand@d.com', await hash('123456'), '周大福珠宝', 'BRAND', JSON.stringify(['BRAND'])]
  );
  await pool.query(
    "INSERT INTO users (id, email, password_hash, nickname, role, roles) VALUES ($1,$2,$3,$4,$5,$6)",
    [uAlice, 'alice@d.com', await hash('123456'), 'Alice海外达人', 'HERALD', JSON.stringify(['HERALD'])]
  );
  await pool.query(
    "INSERT INTO users (id, email, password_hash, nickname, role, roles) VALUES ($1,$2,$3,$4,$5,$6)",
    [uAdmin, 'admin@herix.com', await hash('123456'), 'Herix运营', 'ADMIN', JSON.stringify(['ADMIN'])]
  );
  await pool.query(
    "INSERT INTO users (id, email, password_hash, nickname, role, roles) VALUES ($1,$2,$3,$4,$5,$6)",
    [uGabriel, 'gabrielgong2019@outlook.com', await hash('123456'), 'Gabriel', 'HERALD', JSON.stringify(['HERALD','BRAND'])]
  );

  // ── 2. 品牌/Herald 资料 ──
  await pool.query("INSERT INTO brand_profiles (id, user_id, contact_name) VALUES ($1,$2,$3)", [genId(), uBrand, '周大福珠宝']);
  await pool.query("INSERT INTO brand_profiles (id, user_id, contact_name) VALUES ($1,$2,$3)", [genId(), uAdmin, 'Herix运营']);
  await pool.query("INSERT INTO brand_profiles (id, user_id, contact_name, company_name, industry, is_onboarded) VALUES ($1,$2,$3,$4,$5,$6)",
    [genId(), uGabriel, 'Gabriel', 'Gabriel Studio', '品牌营销', 1]);
  await pool.query("INSERT INTO herald_profiles (id, user_id, display_name, country, diaspora_group, specialties, is_onboarded, kyc_status, declaration_status, residence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [genId(), uAlice, 'Alice海外达人', '美国', '华人', JSON.stringify(['美妆','珠宝','生活方式']), 1, 'approved', 'approved', 'usa']);
  await pool.query("INSERT INTO herald_profiles (id, user_id, display_name, is_onboarded, kyc_status, declaration_status, residence) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [genId(), uGabriel, 'Gabriel', 1, 'approved', 'approved', 'japan']);

  // ── 3. 品牌任务（周大福珠宝 7 个）──
  const brandTasks: [string, string, number, number, number, string, string][] = [
    ['新品珠宝推广 #1', '在海外华人社群推广新款珠宝，需要拍摄佩戴照片并分享体验。', 3500, 400, 3, 'STANDARD', 'photo-1605100804763-247f67b3557e'],
    ['新品珠宝推广 #2', '在海外华人社群推广新款珠宝。', 4000, 500, 3, 'STANDARD', 'photo-1605100804763-247f67b3557e'],
    ['新品珠宝推广 #3', '在海外华人社群推广新款珠宝。', 4500, 600, 3, 'STANDARD', 'photo-1605100804763-247f67b3557e'],
    ['Remitly 品牌大使', '分享 Remitly 汇款推荐码，每成功转化一位注册用户获得奖励。', 300000, 3000, 100, 'PERFORMANCE', 'photo-1563013544-824ae1b704d3'],
    ['熊猫外卖拉新大使', '在中国社群分享熊猫外卖推荐码，新注册用户即算成功。', 200000, 2000, 100, 'PERFORMANCE', 'photo-1504674900247-0877df9cc836'],
    ['母婴产品体验', '体验并分享母婴产品使用心得，需拍摄使用照片。', 200000, 20000, 3, 'STANDARD', 'photo-1519689680058-324335c77eba'],
    ['口红新品测评', '试色并分享口红新品，发布到小红书或Instagram。', 200000, 20000, 3, 'STANDARD', 'photo-1586495777744-4413f21062fa'],
  ];
  const bIds: string[] = [];
  for (const [title, desc, budget, comm, maxH, mode, cover] of brandTasks) {
    const tid = genId(); bIds.push(tid);
    await pool.query(
      "INSERT INTO tasks (id, creator_id, mode, title, description, budget, commission, max_heralds, cover_image, status, published_at, escrow_amount, is_escrowed, code_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'),$10,1,'auto')",
      [tid, uBrand, mode, title, desc, budget, comm, maxH, img(cover), comm * maxH]
    );
  }
  // bIds: 0=珠宝#1, 1=珠宝#2, 2=珠宝#3, 3=Remitly, 4=熊猫外卖, 5=母婴, 6=口红

  // ── 4. Gabriel 的任务（4 个）──
  const gabrielTasks: [string, string, number, number, number, string, string][] = [
    ['体验漂亮的房子', '拍摄并分享高端住宅体验，需入住体验并产出图文内容。', 200000, 20000, 3, 'STANDARD', 'photo-1600585154340-be6161a56a0c'],
    ['美食探店任务', '前往指定餐厅用餐并拍摄短视频，分享真实用餐体验。', 150000, 15000, 5, 'STANDARD', 'photo-1504674900247-0877df9cc836'],
    ['Gabriel体验任务', '拍摄并分享你的生活方式，面向海外华人群体。', 100000, 10000, 3, 'STANDARD', 'photo-1600585154340-be6161a56a0c'],
    ['发小红书任务', '在小红书发布品牌体验笔记，需包含真实使用感受和高质量图片。', 80000, 8000, 5, 'STANDARD', 'photo-1611162617213-7d7a39e9b1d7'],
  ];
  const gIds: string[] = [];
  for (const [title, desc, budget, comm, maxH, mode, cover] of gabrielTasks) {
    const tid = genId(); gIds.push(tid);
    await pool.query(
      "INSERT INTO tasks (id, creator_id, mode, title, description, budget, commission, max_heralds, cover_image, status, published_at, escrow_amount, is_escrowed, code_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'),$10,1,'auto')",
      [tid, uGabriel, mode, title, desc, budget, comm, maxH, img(cover), comm * maxH]
    );
  }
  // gIds: 0=漂亮房子, 1=美食探店, 2=Gabriel体验, 3=发小红书

  // ── 5. Alice 报名 ──
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')", [genId(), bIds[0], uAlice]);
  await pool.query("INSERT INTO task_submissions (id, task_id, herald_id, status, content_url, description) VALUES ($1,$2,$3,'APPROVED',$4,$5)",
    [genId(), bIds[0], uAlice, 'https://instagram.com/p/test', '完成了品牌体验拍摄，发布了3篇图文笔记']);
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')", [genId(), bIds[3], uAlice]);
  await pool.query("INSERT INTO ambassador_tasks (id, task_id, herald_id, unique_code, status) VALUES ($1,$2,$3,$4,'active')", [genId(), bIds[3], uAlice, genCode()]);
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')", [genId(), bIds[5], uAlice]);
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id) VALUES ($1,$2,$3)", [genId(), bIds[4], uAlice]);

  // ── 6. Gabriel 报名 ──
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')", [genId(), bIds[6], uGabriel]);
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')", [genId(), bIds[3], uGabriel]);
  await pool.query("INSERT INTO ambassador_tasks (id, task_id, herald_id, unique_code, status) VALUES ($1,$2,$3,$4,'active')", [genId(), bIds[3], uGabriel, genCode()]);
  await pool.query("INSERT INTO task_applications (id, task_id, herald_id) VALUES ($1,$2,$3)", [genId(), gIds[3], uGabriel]);

  // ── 7. 资金托管 ──
  for (let i = 0; i < 3; i++) {
    await pool.query(
      "INSERT INTO transactions (id, user_id, task_id, type, amount, status, note, completed_at) VALUES ($1,$2,$3,'ESCROW_DEPOSIT',$4,'COMPLETED',$5,TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))",
      [genId(), uBrand, bIds[i], brandTasks[i][3] * brandTasks[i][4], `任务 ${brandTasks[i][0]} 资金托管`]
    );
  }
  await pool.query(
    "INSERT INTO transactions (id, user_id, type, amount, platform_fee, status, completed_at) VALUES ($1,$2,'ESCROW_RELEASE',$3,$4,'COMPLETED',TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))",
    [genId(), uAlice, 20000, 3000]
  );

  console.log('[seed] 种子数据初始化完成');
  console.log('[seed] 测试账号 (密码: 123456): admin@herix.com | brand@d.com | alice@d.com | gabrielgong2019@outlook.com');
}
