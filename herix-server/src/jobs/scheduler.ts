/**
 * 后台任务统一调度（2026-08-02）：把散落在各处的 setInterval 收拢成一处。
 *
 * 接缝设计——「跑什么」与「何时/何地触发」解耦：
 *   · 跑什么 = 各 util 的 runOnce 纯函数（幂等、自包含、状态从 DB 读不靠内存）+ registry（纯数据）
 *   · 何时触发 = 本模块（进程内 setInterval）
 * 将来若要独立 worker / 外部 cron（方案 B），registry 与 runOnce 一行不动，只换本触发层。
 *
 * 单实例守卫：pg advisory lock。in-process setInterval 在每个实例都会各跑一遍，
 * 一旦扩容到多副本，碰钱的结算/计费会重复执行（=资金事故）。咨询锁保证同名任务
 * 全局同一时刻只有一个在跑（也顺带防同实例上一轮没跑完就叠下一轮）。
 */
import pool from '../db';

export interface Job {
  /** 唯一名，同时用作咨询锁 key 的来源 */
  name: string;
  /** 轮询周期（毫秒） */
  everyMs: number;
  /** 首跑延时（毫秒），错开启动峰值 */
  firstDelayMs: number;
  /** 单轮工作：必须幂等、自包含，不依赖被谁触发 */
  runOnce: () => Promise<unknown>;
}

/**
 * 咨询锁包裹：同名任务全局同一时刻只有一个能进 fn。
 * 锁 key 由名字 hashtext 派生；会话级、跑完即释放。拿不到锁返回 null（跳过本轮）。
 */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS got', [name]);
    if (!rows[0]?.got) return null; // 别的实例 / 上一轮还在跑，本轮跳过
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}

let started = false;

/** 注册并启动所有后台任务（进程内触发层）。重复调用无副作用。 */
export function startJobs(jobs: Job[]): void {
  if (started) return;
  started = true;
  for (const job of jobs) {
    const tick = () =>
      withJobLock(job.name, job.runOnce).catch((e: any) =>
        console.error(`[jobs] ${job.name} failed:`, e?.message || e)
      );
    setTimeout(tick, job.firstDelayMs);
    setInterval(tick, job.everyMs);
  }
}
