/**
 * 手动触发一轮交付计时器扫描（催审/超时自动通过/名额释放）。
 * 用途：e2e 测试、运维手动补扫。服务进程内是每小时自动跑，不依赖本脚本。
 *   cd herix-server && npx tsx scripts/run-timers-once.ts
 */
import 'dotenv/config';
import { runSubmissionTimersOnce } from '../src/utils/submissionTimers';
import pool from '../src/db';

// 不用 process.exit()：管道 stdout 是异步 flush，exit 会截断最后一行 JSON；
// 关掉连接池让进程自然退出
runSubmissionTimersOnce()
  .then(async (r) => { console.log(JSON.stringify(r)); await pool.end(); })
  .catch(async (e) => { console.error(e); process.exitCode = 1; await pool.end(); });
