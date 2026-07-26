/**
 * 手动触发一轮订阅生命周期扫描（待付激活/到期续费/宽限重试/提醒）。
 * 用途：e2e 测试、运维手动补扫。服务进程内每小时自动跑，不依赖本脚本。
 *   cd herix-server && npx tsx scripts/run-subs-once.ts
 */
import 'dotenv/config';
import { sweepSubscriptionsOnce } from '../src/utils/subscriptions';
import pool from '../src/db';

sweepSubscriptionsOnce()
  .then(async (r) => { console.log(JSON.stringify(r)); await pool.end(); })
  .catch(async (e) => { console.error(e); process.exitCode = 1; await pool.end(); });
