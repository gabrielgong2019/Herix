/**
 * Vantikus ↔ Herix 对账脚本
 * 在 ECS 上跑：
 *   export $(grep -v '^#' .env | grep '=' | xargs)
 *   npx tsx scripts/reconcile-vantikus.ts
 */

import pool from '../src/db.js';

const VANTIKUS_API = 'https://app.vantikus.com';
const KEY = process.env.VANTIKUS_API_KEY;
if (!KEY) { console.error('缺少 VANTIKUS_API_KEY'); process.exit(1); }

async function vantikusGet(path: string) {
  const res = await fetch(`${VANTIKUS_API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`Vantikus ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function main() {
  // 1. Herix 生产库：每个码的转化汇总
  const herixRows = await pool.query(`
    SELECT
      code,
      COUNT(*)::int                                        AS total_records,
      COUNT(settled_txn_id)::int                           AS settled,
      COUNT(*) FILTER (WHERE settled_txn_id IS NULL)::int  AS unsettled,
      MAX(converted_at)                                    AS latest_converted
    FROM referral_records
    GROUP BY code
    ORDER BY code
  `);

  const herixMap = new Map<string, { settled: number; unsettled: number; latest: string | null }>();
  for (const r of herixRows.rows) {
    herixMap.set(r.code, {
      settled:   r.settled,
      unsettled: r.unsettled,
      latest:    r.latest_converted ?? null,
    });
  }

  // 2. Vantikus API：/promo-code-summary（当前月往前 24 个月）
  const summary = await vantikusGet('/api/partner/promo-code-summary');
  // summary.tasks[].codes[].code / .months[].payableCount
  const vantikusMap = new Map<string, number>();
  for (const task of summary.tasks ?? []) {
    for (const codeEntry of task.codes ?? []) {
      const total = (codeEntry.months ?? []).reduce((s: number, m: any) => s + (m.payableCount ?? 0), 0);
      vantikusMap.set(codeEntry.code, (vantikusMap.get(codeEntry.code) ?? 0) + total);
    }
  }

  // 3. 合并输出
  const allCodes = new Set([...herixMap.keys(), ...vantikusMap.keys()]);

  console.log('\n=== Vantikus ↔ Herix 对账报告 ===\n');
  console.log(
    'Code'.padEnd(16),
    'Vantikus合计'.padEnd(14),
    'Herix已结算'.padEnd(13),
    'Herix未结算'.padEnd(13),
    '差值'.padEnd(8),
    'Herix最晚转化日',
  );
  console.log('-'.repeat(90));

  let totalDiff = 0;
  for (const code of [...allCodes].sort()) {
    const v = vantikusMap.get(code) ?? 0;
    const h = herixMap.get(code);
    const settled   = h?.settled   ?? 0;
    const unsettled = h?.unsettled ?? 0;
    const diff = v - settled;
    totalDiff += Math.abs(diff);

    const flag = diff !== 0 ? ' ←' : '';
    console.log(
      code.padEnd(16),
      String(v).padEnd(14),
      String(settled).padEnd(13),
      String(unsettled).padEnd(13),
      String(diff).padEnd(8),
      (h?.latest ?? '-') + flag,
    );
  }

  console.log('-'.repeat(90));
  console.log(`总差异条数: ${totalDiff}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
