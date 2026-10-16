/**
 * Vantikus → Herix 自动同步（每日一次，由 jobs/registry.ts 调度）
 *
 * 同步 eventType='converted' 和 'cancelled' 事件，跳过 tracked/duplicate。
 * converted → INSERT event_type='converted' 行（ON CONFLICT DO NOTHING 幂等）
 * cancelled → INSERT event_type='cancelled' 行（扣减记录，赫使可见哪个用户被取消）
 * 结算时 net = converted行数 − cancelled行数，floor=0；同一 user_hash 只能各有一行（唯一索引）。
 * Herix 的 referral_records 是结算台账，未转化的跟踪数据不需要落库，
 * Vantikus 本身有完整的 pipeline 视图。
 *
 * Hash 边界说明（不可改动以下常量前必须重读）：
 *   2026-09-24 之前：Herix 通过手工 CSV 上传，user_hash = SHA256(maskedEmail + SALT)
 *   2026-09-24 起：Herix 通过此同步，user_hash = SHA256(externalId + SALT)
 *   两套 hash 不互通。CONVERTED_EVENTS_SINCE 是两种模式的分界线，保证已结算的 133 条
 *   历史记录不会被 API 同步产生的新行重复覆盖。
 */

import pool from '../db.js';
import { genId } from './db.js';
import { hashUserKey, maskUserKey } from './privacy.js';
import { findOne } from './db.js';

const VANTIKUS_API = 'https://app.vantikus.com';

// 2026-09-24：Herix 由手工 CSV 切换为 Vantikus API 自动同步的日期。
// 此前 converted 事件已通过 CSV 入库（user_hash 基于 maskedEmail），
// 此后走 API（user_hash 基于 externalId）。修改此值前必须确认历史已结算记录不会被重复写入。
const CONVERTED_EVENTS_SINCE = '2026-09-24';

type VantikusEvent = {
  eventType: string;
  externalId: string;
  occurredAt: string;
  maskedIdentifier?: string;
};

type VantikusCodeEntry = {
  code: string;
  mode: string;
  events: VantikusEvent[];
  truncated: boolean;
};

export async function runVantikusSyncOnce(): Promise<void> {
  const apiKey = process.env.VANTIKUS_API_KEY;
  if (!apiKey) {
    console.log('[vantikus-sync] VANTIKUS_API_KEY not set, skipping');
    return;
  }

  const dryRun = process.env.VANTIKUS_DRY_RUN === 'true';

  // Rolling window: 当月 + 上月，但不早于 CONVERTED_EVENTS_SINCE 所在月份。
  // 覆盖两个月足以捡回任何迟到的事件；ON CONFLICT DO NOTHING 保证已入库的幂等跳过。
  const now = new Date();
  const toMonth   = now.toISOString().slice(0, 7); // 当前月份 e.g. '2026-10'
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const cutoffMonth = CONVERTED_EVENTS_SINCE.slice(0, 7); // '2026-09'
  const fromMonth = prevMonth >= cutoffMonth ? prevMonth : cutoffMonth;

  const res = await fetch(
    `${VANTIKUS_API}/api/partner/promo-code-events?from=${fromMonth}&to=${toMonth}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) {
    throw new Error(`Vantikus API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { codes: VantikusCodeEntry[] };

  let newRows = 0;
  let duplicates = 0;
  let cancelled = 0;
  let noCode = 0;
  // codes that received new insertions → need ambassador_tasks counter refresh
  const touchedCodes = new Set<string>();

  for (const entry of data.codes) {
    if (entry.mode !== 'detail') continue;
    if (entry.truncated) {
      console.warn(`[vantikus-sync] ⚠️  code ${entry.code} truncated — narrow the date range if counts look off`);
    }

    // Resolve task_id + herald_id via ambassador_tasks
    const at = await findOne<{ task_id: string; herald_id: string }>(
      'SELECT task_id, herald_id FROM ambassador_tasks WHERE unique_code = ?',
      [entry.code],
    );
    if (!at) {
      console.warn(`[vantikus-sync] code ${entry.code} not found in ambassador_tasks — skipping`);
      noCode++;
      continue;
    }

    for (const ev of entry.events) {
      if (ev.occurredAt < CONVERTED_EVENTS_SINCE) continue;

      if (ev.eventType !== 'converted' && ev.eventType !== 'cancelled' && ev.eventType !== 'tracked') continue;

      const userHash   = hashUserKey(ev.externalId);
      const userMasked = ev.maskedIdentifier ?? maskUserKey(ev.externalId);
      const evType     = ev.eventType; // 'converted' | 'cancelled' | 'tracked'

      if (dryRun) {
        console.log(
          `[vantikus-sync] DRY_RUN would insert ${evType}: code=${entry.code} date=${ev.occurredAt} hash=${userHash.slice(0, 8)}...`,
        );
        evType === 'converted' ? newRows++ : evType === 'cancelled' ? cancelled++ : newRows++;
        continue;
      }

      const ts = new Date().toISOString();
      const result = await pool.query(
        `INSERT INTO referral_records
           (id, task_id, code, herald_id, user_hash, user_masked,
            registered_at, converted_at, date_source, event_type, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'brand',$9,$10,$10)
         ON CONFLICT (task_id, code, user_hash, event_type) DO NOTHING
         RETURNING id`,
        [genId(), at.task_id, entry.code, at.herald_id, userHash, userMasked,
         ev.occurredAt, ev.occurredAt, evType, ts],
      );

      if (result.rowCount && result.rowCount > 0) {
        evType === 'cancelled' ? cancelled++ : newRows++;
        touchedCodes.add(entry.code);
      } else {
        duplicates++;
      }
    }
  }

  // Refresh ambassador_tasks counters for any code that received new rows.
  // Mirrors the same recalc in tasks.ts CSV upload path (lines 1046-1048).
  if (!dryRun && touchedCodes.size > 0) {
    for (const code of touchedCodes) {
      await pool.query(
        `UPDATE ambassador_tasks SET
           registered_count = (SELECT COUNT(*) FROM referral_records WHERE task_id = (SELECT task_id FROM ambassador_tasks WHERE unique_code = $1) AND code = $1 AND event_type = 'tracked'),
           used_count       = (SELECT COUNT(*) FILTER (WHERE event_type = 'converted') - COUNT(*) FILTER (WHERE event_type = 'cancelled')
                               FROM referral_records WHERE task_id = (SELECT task_id FROM ambassador_tasks WHERE unique_code = $1) AND code = $1),
           paid_conversions = (SELECT COUNT(*) FILTER (WHERE event_type = 'converted' AND settled_txn_id IS NOT NULL) - COUNT(*) FILTER (WHERE event_type = 'cancelled' AND settled_txn_id IS NOT NULL)
                               FROM referral_records WHERE task_id = (SELECT task_id FROM ambassador_tasks WHERE unique_code = $1) AND code = $1),
           updated_at       = NOW()
         WHERE unique_code = $1`,
        [code],
      );
    }
  }

  console.log(
    `[vantikus-sync] done — new=${newRows} duplicate=${duplicates} cancelled=${cancelled} noCode=${noCode} touchedCodes=${touchedCodes.size}${dryRun ? ' (DRY_RUN)' : ''}`,
  );
}
