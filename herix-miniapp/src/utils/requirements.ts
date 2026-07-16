/**
 * 任务平台要求校验 — 从 herix.html 的 checkRequirements() 原样移植（纯函数，逻辑不变）。
 * 是任务详情页资质预检面板、以及报名失败提示两处共用的唯一逻辑来源。
 */

export interface PlatformRequirement {
  platformId: string;
  required: boolean;
  minFollowers?: number;
}

export interface SocialPlatformEntry {
  platformId: string;
  followers?: number;
  [key: string]: any;
}

export type RequirementFailure =
  | { platformId: string; type: 'MISSING' }
  | { platformId: string; type: 'INSUFFICIENT'; required: number; current: number };

export interface RequirementsCheckResult {
  status: 'ok' | 'missing' | 'insufficient';
  failures: RequirementFailure[];
  /** 满足模式：ALL=required项全须满足；ANY_N=候选项满足任意 needCount 项即可 */
  mode: 'ALL' | 'ANY_N';
  needCount: number;
  satisfiedCount: number;
}

interface TaskLike {
  platform_requirements?: string | null;
  req_mode?: string | null;
  req_min_count?: number | null;
}

interface AmbassadorProfileLike {
  social_platforms?: string | null;
}

export function checkRequirements(
  task: TaskLike | null | undefined,
  ambassadorProfile: AmbassadorProfileLike | null | undefined,
): RequirementsCheckResult {
  const OK: RequirementsCheckResult = { status: 'ok', failures: [], mode: 'ALL', needCount: 0, satisfiedCount: 0 };
  if (!task || !task.platform_requirements) return OK;

  let reqs: PlatformRequirement[] = [];
  try {
    reqs = JSON.parse(task.platform_requirements);
  } catch {
    return OK;
  }

  // 模式语义与服务端 applications.ts 保持一致，改动须两边同步：
  //   ALL(默认)：required=true 的项全部必须满足，required=false 仅展示
  //   ANY_N：列出的所有项都算候选，满足任意 needCount 项即可（忽略单项 required 标志）
  const mode: 'ALL' | 'ANY_N' = task.req_mode === 'ANY_N' ? 'ANY_N' : 'ALL';
  const candidates = mode === 'ANY_N' ? reqs : reqs.filter(r => r.required);
  if (!candidates.length) return OK;

  let platforms: SocialPlatformEntry[] = [];
  try {
    const ap = ambassadorProfile || {};
    platforms = ap.social_platforms ? JSON.parse(ap.social_platforms) : [];
  } catch {
    // ignore malformed data, treat as no platforms
  }

  const failures: RequirementFailure[] = [];
  for (const req of candidates) {
    const match = platforms.find(p => p.platformId === req.platformId);
    if (!match) {
      failures.push({ platformId: req.platformId, type: 'MISSING' });
    } else if (req.minFollowers && (match.followers || 0) < req.minFollowers) {
      failures.push({
        platformId: req.platformId,
        type: 'INSUFFICIENT',
        required: req.minFollowers,
        current: match.followers || 0,
      });
    }
  }

  const needCount = mode === 'ANY_N'
    ? Math.min(Math.max(1, Number(task.req_min_count) || 1), candidates.length)
    : candidates.length;
  const satisfiedCount = candidates.length - failures.length;
  const passed = mode === 'ANY_N' ? satisfiedCount >= needCount : failures.length === 0;

  // ANY_N 通过时 failures 保留（供面板逐项显示状态），status=ok 表示可报名
  if (passed) return { status: 'ok', failures, mode, needCount, satisfiedCount };
  if (failures.some(f => f.type === 'INSUFFICIENT')) return { status: 'insufficient', failures, mode, needCount, satisfiedCount };
  return { status: 'missing', failures, mode, needCount, satisfiedCount };
}
