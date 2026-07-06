/**
 * 汇率工具 — 仅用于展示换算（赫使端"约 ¥xxx"提示、钱包多币种汇总）
 * 不参与实际结算：结算永远使用任务/钱包自身的原始币种。
 *
 * 数据来源：Frankfurter（免费、无需 key），每天最多调用一次，结果缓存在 exchange_rates 表。
 * API 失败时继续使用上一次缓存的汇率，不阻塞业务。
 */

import pool from '../db';

const STALE_MS = 24 * 60 * 60 * 1000; // 24小时

/** 获取 1 CNY = ? JPY 的汇率（懒刷新） */
async function getCnyJpyRate(): Promise<number> {
  const row = await pool.query(
    `SELECT rate, updated_at FROM exchange_rates WHERE base_currency = 'CNY' AND quote_currency = 'JPY'`
  );
  const cached = row.rows[0];
  const isStale = !cached || (Date.now() - new Date(cached.updated_at).getTime()) > STALE_MS;

  if (isStale) {
    try {
      const fresh = await fetchCnyJpyRate();
      await pool.query(
        `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, updated_at)
         VALUES ('CNY_JPY','CNY','JPY',$1,TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS'))
         ON CONFLICT (id) DO UPDATE SET rate = $1, updated_at = TO_CHAR(CURRENT_TIMESTAMP,'YYYY-MM-DD HH24:MI:SS')`,
        [fresh]
      );
      return fresh;
    } catch (e) {
      console.error('[exchangeRate] 汇率API刷新失败，使用缓存值:', e);
      if (cached) return Number(cached.rate);
      return 20.5; // 兜底初始值
    }
  }

  return Number(cached.rate);
}

async function fetchCnyJpyRate(): Promise<number> {
  const res = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=JPY');
  if (!res.ok) throw new Error(`Frankfurter API ${res.status}`);
  const data = await res.json() as { rates: { JPY: number } };
  if (!data.rates?.JPY) throw new Error('Frankfurter API 返回数据缺少 JPY 汇率');
  return data.rates.JPY;
}

/** 货币换算：amount 单位为 from，返回 to 单位的金额 */
export async function convertCurrency(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount;
  const cnyToJpy = await getCnyJpyRate();
  if (from === 'CNY' && to === 'JPY') return amount * cnyToJpy;
  if (from === 'JPY' && to === 'CNY') return amount / cnyToJpy;
  throw new Error(`不支持的币种换算: ${from} -> ${to}`);
}

/** 查询当前汇率（用于前端展示） */
export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const cnyToJpy = await getCnyJpyRate();
  if (from === 'CNY' && to === 'JPY') return cnyToJpy;
  if (from === 'JPY' && to === 'CNY') return 1 / cnyToJpy;
  throw new Error(`不支持的币种换算: ${from} -> ${to}`);
}
