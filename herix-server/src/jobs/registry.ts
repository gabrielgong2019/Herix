/**
 * 所有后台轮询的唯一登记处。加/删/改周期只动这里。
 * 每个条目的 runOnce 是对应 util 的纯函数（幂等、自包含），触发方式由 scheduler 决定。
 */
import { Job } from './scheduler';
import { syncFxRates } from '../utils/fxSync';
import { runSubmissionTimersOnce } from '../utils/submissionTimers';
import { sweepSubscriptionsOnce } from '../utils/subscriptions';
import { runTranslationRetryOnce } from '../utils/translateRetry';

const MIN = 60_000;
const HOUR = 3600_000;

export const JOBS: Job[] = [
  // 汇率中间价自动同步（锁价基准）
  { name: 'fx-sync',            everyMs: 6 * HOUR, firstDelayMs: 10_000, runOnce: syncFxRates },
  // 交付双向计时器（催审 / 超时自动通过 / 名额释放 / 草稿已过待交终稿催办）
  { name: 'submission-timers',  everyMs: 1 * HOUR, firstDelayMs: 30_000, runOnce: runSubmissionTimersOnce },
  // 订阅生命周期（待付激活 / 到期续费 / 宽限重试 / 提醒）
  { name: 'subscription-sweep', everyMs: 1 * HOUR, firstDelayMs: 45_000, runOnce: sweepSubscriptionsOnce },
  // 翻译重试（发布时 fire-and-forget 失败的 + 编辑后 pending 的，批量补翻）
  { name: 'translation-retry',  everyMs: 30 * MIN, firstDelayMs: 20_000, runOnce: runTranslationRetryOnce },
];
