import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const SQLITE_PATH = path.join(__dirname, 'data', 'herix.db');

async function main() {
  // Open SQLite
  const sq = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err); else resolve(db);
    });
  });

  // Open PG
  const pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Delete order: children first, parents last
  const deleteOrder = [
    'referrals', 'withdrawal_methods', 'declarations', 'payouts',
    'transactions', 'task_ratings', 'task_submissions', 'task_promo_codes',
    'ambassador_tasks', 'task_applications',
    'tasks', 'herald_profiles', 'brand_profiles', 'users',
  ];

  // Insert order: parents first, children last
  const tables = [
    'users', 'brand_profiles', 'herald_profiles', 'tasks',
    'task_applications', 'ambassador_tasks', 'task_promo_codes',
    'task_submissions', 'task_ratings', 'transactions', 'payouts',
    'declarations', 'withdrawal_methods', 'referrals'
  ];

  console.log('=== 清空 PostgreSQL 数据 ===');
  for (const table of deleteOrder) {
    try {
      await pgPool.query(`DELETE FROM ${table}`);
    } catch (err) {
      console.log(`  ⚠️  ${table}: ${err.message.slice(0, 80)}`);
    }
  }

  let total = 0;
  console.log('\n=== 从 SQLite 迁移数据 ===');
  for (const table of tables) {
    // Get columns
    const colInfo = await new Promise((resolve, reject) => {
      sq.all(`PRAGMA table_info(${table})`, (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    if (!colInfo || colInfo.length === 0) continue;
    const cols = colInfo.map(r => r.name);

    // Get data
    const rows = await new Promise((resolve, reject) => {
      sq.all(`SELECT * FROM ${table}`, (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    if (rows.length === 0) {
      console.log(`  ⏭️  ${table}: 0 rows`);
      continue;
    }

    for (const row of rows) {
      const keys = Object.keys(row);
      const insertVals = keys.map(k => row[k]);
      const placeholders = keys.map((_, i) => `$${i + 1}`);

      try {
        await pgPool.query(
          `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`,
          insertVals
        );
        total++;
      } catch (err) {
        console.error(`  ❌ ${table} (${row.id || row.email || '?'}): ${err.message.slice(0, 120)}`);
      }
    }
    console.log(`  ✅ ${table}: ${rows.length} rows`);
  }

  console.log(`\n🎉 迁移完成！共 ${total} 行数据已导入 PostgreSQL`);
  sq.close();
  await pgPool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
