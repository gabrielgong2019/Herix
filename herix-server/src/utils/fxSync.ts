/**
 * 汇率中间价自动同步（2026-07-17）。
 * 来源：frankfurter.app（欧央行 ECB，免费无 key，工作日更新）→ 失败退 open.er-api.com（每日）。
 * 同步哪些币对：由 payout_fee_rules 的跨境线路推导（JP→CN ⇒ JPY_CNY）。
 * 护栏：新值与库内现值偏离超过 ±15% 视为数据源异常，拒写并告警日志——锁价基准是钱，宁旧勿错。
 * 运营在 admin 手动改的值会被下一次同步覆盖（市场价为准）；启动时同步一次，此后每 6 小时。
 */
import pool from '../db';
import { setSetting, getSetting } from './settings';

const COUNTRY_CURRENCY: Record<string, string> = { JP: 'JPY', CN: 'CNY' };
const BASE = 'JPY';

async function fetchRate(target: string): Promise<{ rate: number; source: string } | null> {
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=${BASE}&to=${target}`, { signal: AbortSignal.timeout(10_000) });
    const d: any = await r.json();
    const rate = Number(d?.rates?.[target]);
    if (rate > 0) return { rate, source: 'frankfurter(ECB)' };
  } catch { /* 退下一源 */ }
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${BASE}`, { signal: AbortSignal.timeout(10_000) });
    const d: any = await r.json();
    const rate = Number(d?.rates?.[target]);
    if (rate > 0) return { rate, source: 'open.er-api' };
  } catch { /* 两源都挂 */ }
  return null;
}

export async function syncFxRates(): Promise<void> {
  try {
    const rules = await pool.query(
      `SELECT DISTINCT to_country FROM payout_fee_rules WHERE from_country <> to_country`
    );
    for (const row of rules.rows) {
      const target = COUNTRY_CURRENCY[row.to_country];
      if (!target) continue;
      const key = `fx_mid_${BASE}_${target}`;
      const fetched = await fetchRate(target);
      if (!fetched) {
        console.error(`[fx-sync] ${key} 两个数据源均失败，保留现值`);
        continue;
      }
      const current = Number(await getSetting(key));
      if (current > 0 && Math.abs(fetched.rate - current) / current > 0.15) {
        console.error(`[fx-sync] ${key} 新值 ${fetched.rate} 偏离现值 ${current} 超 15%，疑似数据源异常，拒写`);
        continue;
      }
      await setSetting(key, String(fetched.rate), 'fx-sync', `自动同步自 ${fetched.source}`);
      console.log(`[fx-sync] ${key} = ${fetched.rate} (${fetched.source})`);
    }
  } catch (e: any) {
    console.error('[fx-sync] 同步失败:', e.message);
  }
}

/** 启动时同步一次 + 每 6 小时；失败不影响服务（锁价用库内现值） */
export function startFxSync(): void {
  setTimeout(syncFxRates, 10_000); // 等 initDatabase 建完表
  setInterval(syncFxRates, 6 * 3600_000);
}
