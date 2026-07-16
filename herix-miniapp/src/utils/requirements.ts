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
}

interface TaskLike {
  platform_requirements?: string | null;
}

interface AmbassadorProfileLike {
  social_platforms?: string | null;
}

export function checkRequirements(
  task: TaskLike | null | undefined,
  ambassadorProfile: AmbassadorProfileLike | null | undefined,
): RequirementsCheckResult {
  if (!task || !task.platform_requirements) {
    return { status: 'ok', failures: [] };
  }

  let reqs: PlatformRequirement[] = [];
  try {
    reqs = JSON.parse(task.platform_requirements);
  } catch {
    return { status: 'ok', failures: [] };
  }

  const required = reqs.filter(r => r.required);
  if (!required.length) {
    return { status: 'ok', failures: [] };
  }

  let platforms: SocialPlatformEntry[] = [];
  try {
    const ap = ambassadorProfile || {};
    platforms = ap.social_platforms ? JSON.parse(ap.social_platforms) : [];
  } catch {
    // ignore malformed data, treat as no platforms
  }

  const failures: RequirementFailure[] = [];
  for (const req of required) {
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

  if (!failures.length) return { status: 'ok', failures: [] };
  if (failures.some(f => f.type === 'INSUFFICIENT')) return { status: 'insufficient', failures };
  return { status: 'missing', failures };
}
