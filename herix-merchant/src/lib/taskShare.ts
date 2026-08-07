import type { Task } from './api'

export interface TaskShareConfig {
  taskId: string
  mode: string
  title: string
  description: string
  typeLabel: string
  typeBadgeColor: string
  payoutLabel: string
  payoutDisplay: string
  coverImage?: string
  brandLogo?: string
}

/**
 * 任务类型 → 分享展示配置的唯一映射点。
 * 新增任务类型只改这里的 switch，海报/卡片生成代码不需要改。
 */
export function buildTaskShareConfig(
  task: Task,
  t: (k: string) => string,
): TaskShareConfig {
  const base = {
    taskId: task.id,
    mode: task.mode,
    title: task.title,
    description: task.description || '',
    coverImage: task.cover_image ?? undefined,
    brandLogo: task.brand_logo_url ?? undefined,
  }
  switch (task.mode) {
    case 'PERFORMANCE':
      return {
        ...base,
        typeLabel: t('share.typePerf'),
        typeBadgeColor: '#7c3aed',
        payoutLabel: t('share.payoutPerConv'),
        payoutDisplay: `¥${task.payout_per_herald}`,
      }
    case 'STANDARD':
    default:
      return {
        ...base,
        typeLabel: t('share.typeStandard'),
        typeBadgeColor: '#0891b2',
        payoutLabel: t('share.payoutPerHerald'),
        payoutDisplay: `¥${task.payout_per_herald}`,
      }
  }
}
