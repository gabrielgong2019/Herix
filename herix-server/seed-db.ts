// 一键重灌种子数据
// 本地: npx tsx seed-db.ts
// Render Shell: npx tsx seed-db.ts

import pool, { initDatabase } from './db';
import { seedIfEmpty } from './seed';

async function main() {
  console.log('[seed-db] 清空现有数据...');
  const tables = [
    'referrals', 'withdrawal_methods', 'declarations', 'payouts',
    'transactions', 'task_ratings', 'task_submissions', 'task_promo_codes',
    'ambassador_tasks', 'task_applications',
    'tasks', 'herald_profiles', 'brand_profiles', 'users',
  ];
  for (const t of tables) {
    await pool.query(`DELETE FROM ${t}`);
  }

  console.log('[seed-db] 填充种子数据...');
  await seedIfEmpty();

  const r = await pool.query(
    "SELECT (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM tasks) as tasks, (SELECT COUNT(*) FROM task_applications) as apps"
  );
  console.log(`[seed-db] 完成: ${r.rows[0].users} users, ${r.rows[0].tasks} tasks, ${r.rows[0].apps} applications`);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('[seed-db] 失败:', err);
  process.exit(1);
});
