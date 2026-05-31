import pool from './db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const genId = () => crypto.randomBytes(16).toString('hex');
const genCode = () => 'HERIX-' + crypto.randomBytes(3).toString('hex').toUpperCase();

/** 如果数据库为空则自动灌入种子数据 */
export async function seedIfEmpty(): Promise<void> {
  const result = await pool.query("SELECT COUNT(*)::int as cnt FROM users");
  if (parseInt(result.rows[0].cnt) > 0) return;

  console.log('[seed] 空数据库，开始初始化种子数据...');
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  // 1. 用户
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

  // 2. 资料
  await pool.query(
    "INSERT INTO brand_profiles (id, user_id, contact_name) VALUES ($1,$2,$3)",
    [genId(), uBrand, '周大福珠宝']
  );
  await pool.query(
    "INSERT INTO brand_profiles (id, user_id, contact_name, company_name, industry, is_onboarded) VALUES ($1,$2,$3,$4,$5,$6)",
    [genId(), uGabriel, 'Gabriel', 'Gabriel Studio', '品牌营销', 1]
  );
  await pool.query(
    "INSERT INTO herald_profiles (id, user_id, display_name, country, diaspora_group, specialties, is_onboarded, kyc_status, declaration_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [genId(), uAlice, 'Alice海外达人', '美国', '华人', JSON.stringify(['美妆','珠宝','生活方式']), 1, 'approved', 'approved']
  );
  await pool.query(
    "INSERT INTO herald_profiles (id, user_id, display_name, is_onboarded, kyc_status, declaration_status) VALUES ($1,$2,$3,$4,$5,$6)",
    [genId(), uGabriel, 'Gabriel', 1, 'approved', 'approved']
  );

  // 3. 任务
  const taskDefs: [string, string, number, number, number, string][] = [
    ['新品珠宝推广 #1', '在海外华人社群推广新款珠宝', 3500, 400, 3, 'STANDARD'],
    ['新品珠宝推广 #2', '在海外华人社群推广新款珠宝', 4000, 500, 3, 'STANDARD'],
    ['新品珠宝推广 #3', '在海外华人社群推广新款珠宝', 4500, 600, 3, 'STANDARD'],
    ['Remitly 品牌大使', '分享 Remitly 汇款推荐码，转化奖励', 300000, 3000, 100, 'PERFORMANCE'],
    ['熊猫外卖拉新大使', '分享熊猫外卖推荐码，新注册即算成功', 200000, 2000, 100, 'PERFORMANCE'],
    ['母婴产品体验', '体验并分享母婴产品使用心得', 200000, 20000, 3, 'STANDARD'],
    ['口红新品测评', '试色并分享口红新品', 200000, 20000, 3, 'STANDARD'],
  ];
  const taskIds: string[] = [];
  for (const [title, desc, budget, comm, maxH, mode] of taskDefs) {
    const tid = genId();
    taskIds.push(tid);
    await pool.query(
      "INSERT INTO tasks (id, creator_id, mode, title, description, budget, commission, max_heralds, status, published_at, escrow_amount, is_escrowed, code_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'),$9,1,'auto')",
      [tid, uBrand, mode, title, desc, budget, comm, maxH, comm * maxH]
    );
  }

  // 4. Alice: 报名 + 审核通过 珠宝#1, 提交作品并通过
  await pool.query(
    "INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')",
    [genId(), taskIds[0], uAlice]
  );
  await pool.query(
    "INSERT INTO task_applications (id, task_id, herald_id) VALUES ($1,$2,$3)",
    [genId(), taskIds[3], uAlice]
  );
  await pool.query(
    "INSERT INTO task_submissions (id, task_id, herald_id, status, content_url, description) VALUES ($1,$2,$3,'APPROVED',$4,$5)",
    [genId(), taskIds[0], uAlice, 'https://instagram.com/p/test', '完成了品牌体验拍摄']
  );

  // 5. Gabriel: 报名 口红(APPROVED) + Remitly(APPROVED)
  await pool.query(
    "INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')",
    [genId(), taskIds[6], uGabriel]
  );
  await pool.query(
    "INSERT INTO task_applications (id, task_id, herald_id, status) VALUES ($1,$2,$3,'APPROVED')",
    [genId(), taskIds[3], uGabriel]
  );

  // 6. 推广码
  await pool.query(
    "INSERT INTO ambassador_tasks (id, task_id, herald_id, unique_code, status) VALUES ($1,$2,$3,$4,'active')",
    [genId(), taskIds[3], uGabriel, genCode()]
  );

  // 7. 资金托管
  await pool.query(
    "INSERT INTO transactions (id, user_id, task_id, type, amount, status, note, completed_at) VALUES ($1,$2,$3,'ESCROW_DEPOSIT',$4,'COMPLETED',$5,TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))",
    [genId(), uBrand, taskIds[0], 1200, '任务 新品珠宝推广 #1 资金托管']
  );
  await pool.query(
    "INSERT INTO transactions (id, user_id, task_id, type, amount, status, note, completed_at) VALUES ($1,$2,$3,'ESCROW_DEPOSIT',$4,'COMPLETED',$5,TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))",
    [genId(), uBrand, taskIds[1], 1500, '任务 新品珠宝推广 #2 资金托管']
  );
  await pool.query(
    "INSERT INTO transactions (id, user_id, task_id, type, amount, status, note, completed_at) VALUES ($1,$2,$3,'ESCROW_DEPOSIT',$4,'COMPLETED',$5,TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))",
    [genId(), uBrand, taskIds[2], 1800, '任务 新品珠宝推广 #3 资金托管']
  );
  await pool.query(
    "INSERT INTO transactions (id, user_id, type, amount, platform_fee, status, completed_at) VALUES ($1,$2,'ESCROW_RELEASE',$3,$4,'COMPLETED',TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))",
    [genId(), uAlice, 20000, 3000]
  );

  console.log('[seed] 种子数据初始化完成');
  console.log('[seed] 测试账号 (密码: 123456): admin@herix.com | brand@d.com | alice@d.com | gabrielgong2019@outlook.com');
}
