/**
 * Vantikus ↔ Herix 对账脚本（任务级别）
 * 在 ECS 上跑：
 *   cd /home/herix/Herix/herix-server
 *   export $(grep -v '^#' .env | grep '=' | xargs)
 *   VANTIKUS_API_KEY=vtk_... npx tsx scripts/reconcile-vantikus.ts
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
  // 0. Herix 最新同步日期（已结算记录中最晚的 converted_at）
  const latestRow = await pool.query(
    `SELECT MAX(converted_at) AS latest FROM referral_records WHERE settled_txn_id IS NOT NULL`
  );
  const latestConverted: string | null = latestRow.rows[0]?.latest ?? null;
  // 截止到"最新同步月"的月末（e.g. 2026-09-23 → 截止 2026-09）
  const cutoffMonth = latestConverted ? latestConverted.slice(0, 7) : null;
  console.log(`Herix 最新已结算日期: ${latestConverted ?? '无'}`);
  console.log(`对账截止月份: ${cutoffMonth ?? '全部'}\n`);

  // 1. Vantikus：每个 task 的净转化数 + 该 task 下的所有码（只算截止月份内）
  const summary = await vantikusGet('/api/partner/promo-code-summary');

  type VTask = { codes: string[]; net: number; months: { periodStart: string; net: number }[] };
  const vTasks: VTask[] = (summary.tasks ?? []).map((t: any) => {
    const months = (t.months ?? [])
      .filter((m: any) => !cutoffMonth || m.periodStart.slice(0, 7) <= cutoffMonth)
      .filter((m: any) => m.net > 0)
      .map((m: any) => ({ periodStart: m.periodStart, net: m.net }));
    return {
      codes: (t.codes ?? []).map(String),
      net:   months.reduce((s: number, m) => s + m.net, 0),
      months,
    };
  });

  // 码 → vTask 索引
  const codeToVTask = new Map<string, number>();
  vTasks.forEach((t, i) => t.codes.forEach(c => codeToVTask.set(c, i)));

  // 2. Herix 生产库：按 task_id 汇总
  const herixRows = await pool.query(`
    SELECT
      task_id,
      COUNT(*)::int                                        AS total_records,
      COUNT(settled_txn_id)::int                           AS settled,
      COUNT(*) FILTER (WHERE settled_txn_id IS NULL)::int  AS unsettled,
      MAX(converted_at)                                    AS latest_converted,
      array_agg(DISTINCT code)                             AS codes
    FROM referral_records
    GROUP BY task_id
    ORDER BY task_id
  `);

  // 3. 任务级别汇总：将 Herix task_id 和 Vantikus task 通过 code 对应
  // Vantikus task index → Herix settled/unsettled
  const herixByVTask = new Map<number, { settled: number; unsettled: number; latest: string | null; taskId: string }>();
  const herixUnmatched: typeof herixRows.rows = [];

  for (const row of herixRows.rows) {
    const codes: string[] = row.codes ?? [];
    // 找第一个能匹配上 Vantikus task 的码
    const vIdx = codes.map(c => codeToVTask.get(c)).find(i => i !== undefined);
    if (vIdx !== undefined) {
      const existing = herixByVTask.get(vIdx);
      herixByVTask.set(vIdx, {
        settled:   (existing?.settled   ?? 0) + row.settled,
        unsettled: (existing?.unsettled ?? 0) + row.unsettled,
        latest:    existing?.latest && existing.latest > (row.latest_converted ?? '') ? existing.latest : (row.latest_converted ?? null),
        taskId:    row.task_id,
      });
    } else {
      herixUnmatched.push(row);
    }
  }

  // 4. 输出报告
  console.log('\n=== Vantikus ↔ Herix 对账报告（任务级别）===\n');
  console.log(
    '任务码前缀'.padEnd(14),
    '码数'.padEnd(6),
    'Vantikus净转化'.padEnd(16),
    'Herix已结算'.padEnd(13),
    'Herix未结算'.padEnd(13),
    '差值'.padEnd(8),
    '月度明细(Vantikus)',
  );
  console.log('-'.repeat(100));

  let totalDiff = 0;
  vTasks.forEach((vt, idx) => {
    const prefix = vt.codes[0]?.replace(/\d+$/, '') ?? '?';
    const h = herixByVTask.get(idx);
    const settled   = h?.settled   ?? 0;
    const unsettled = h?.unsettled ?? 0;
    const diff = vt.net - settled;
    totalDiff += Math.abs(diff);
    const flag = diff !== 0 ? ' ←' : ' ✓';
    const monthDetail = vt.months.map(m => `${m.periodStart.slice(0,7)}:${m.net}`).join(' ');
    console.log(
      prefix.padEnd(14),
      String(vt.codes.length).padEnd(6),
      String(vt.net).padEnd(16),
      String(settled).padEnd(13),
      String(unsettled).padEnd(13),
      (String(diff) + flag).padEnd(12),
      monthDetail,
    );
  });

  if (herixUnmatched.length > 0) {
    console.log('\n⚠️  Herix 有转化记录但在 Vantikus 找不到对应任务：');
    for (const row of herixUnmatched) {
      console.log(`  task_id=${row.task_id} settled=${row.settled} unsettled=${row.unsettled} codes=${row.codes.slice(0,3).join(',')}`);
    }
  }

  console.log('-'.repeat(100));
  console.log(`总差异: ${totalDiff} 条`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
