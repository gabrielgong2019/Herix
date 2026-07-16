import { View, Text } from '@tarojs/components';
import { checkRequirements, PlatformRequirement, SocialPlatformEntry } from '../utils/requirements';
import { platformById } from '../utils/platforms';
import { t } from '../utils/i18n';

/**
 * 任务详情页的资质预检面板 —— 从 herix.html 的 detailHTML() 里对应区块移植。
 * 纯展示组件，逻辑全部来自 checkRequirements()。
 */

interface Props {
  task: { platform_requirements?: string | null };
  ambassadorProfile: { social_platforms?: string | null } | null;
}

export default function RequirementsChecklist({ task, ambassadorProfile }: Props) {
  if (!task.platform_requirements) return null;

  let reqs: PlatformRequirement[] = [];
  try {
    reqs = JSON.parse(task.platform_requirements);
  } catch {
    return null;
  }
  if (!reqs.length) return null;

  const check = checkRequirements(task, ambassadorProfile);
  const requiredItems = reqs.filter(r => r.required);
  const optionalItems = reqs.filter(r => !r.required);

  let ownedPlatforms: SocialPlatformEntry[] = [];
  try {
    ownedPlatforms = ambassadorProfile?.social_platforms ? JSON.parse(ambassadorProfile.social_platforms) : [];
  } catch {
    // ignore
  }
  const missingOptionalCount = optionalItems.filter(
    o => !ownedPlatforms.find(p => p.platformId === o.platformId),
  ).length;

  return (
    <View className='requirements-checklist'>
      <Text className='requirements-title'>{t('req.title')}</Text>

      {requiredItems.map(req => {
        const platform = platformById(req.platformId);
        const failure = check.failures.find(f => f.platformId === req.platformId);
        let icon = '✓';
        let color = '#10b981';
        let desc = req.minFollowers ? t('req.followersOk', { n: req.minFollowers.toLocaleString() }) : t('req.added');
        if (failure) {
          if (failure.type === 'INSUFFICIENT') {
            icon = '✗';
            color = '#ef4444';
            desc = t('req.insufficient', { c: failure.current.toLocaleString(), r: failure.required.toLocaleString() });
          } else {
            icon = '○';
            color = '#f59e0b';
            desc = t('req.notAdded');
          }
        }
        return (
          <View key={req.platformId} className='requirement-row'>
            <Text className='requirement-icon'>{platform.icon}</Text>
            <Text className='requirement-name'>{platform.name}</Text>
            <Text style={{ fontSize: '12px', color, fontWeight: 500 }}>
              {icon} {desc}
            </Text>
          </View>
        );
      })}

      {optionalItems.map(opt => {
        const platform = platformById(opt.platformId);
        const has = ownedPlatforms.find(p => p.platformId === opt.platformId);
        return (
          <View key={opt.platformId} className='requirement-row'>
            <Text className='requirement-icon'>{platform.icon}</Text>
            <Text className='requirement-name muted'>{platform.name}</Text>
            {has ? (
              <Text style={{ fontSize: '12px', color: '#10b981' }}>{t('req.addedCheck')}</Text>
            ) : (
              <Text className='optional-badge'>{t('req.optional')}</Text>
            )}
          </View>
        );
      })}

      {missingOptionalCount > 0 && (
        <View className='requirements-hint'>
          <Text>{t('req.hint')}</Text>
        </View>
      )}
    </View>
  );
}
