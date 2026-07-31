import { View, Text } from '@tarojs/components';
import { checkRequirements, PlatformRequirement, SocialPlatformEntry } from '../utils/requirements';
import { platformById } from '../utils/platforms';
import { t } from '../utils/i18n';

/**
 * 任务详情页的资质预检面板 —— 从 herix.html 的 detailHTML() 里对应区块移植。
 * 纯展示组件，逻辑全部来自 checkRequirements()。
 */

interface Props {
  task: { platform_requirements?: string | null; req_mode?: string | null; req_min_count?: number | null };
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
  // ANY_N：所有项都是候选，逐项显示满足状态；ALL：按 required/选填 分组（现行为）
  const anyN = check.mode === 'ANY_N';
  const requiredItems = anyN ? reqs : reqs.filter(r => r.required);
  const optionalItems = anyN ? [] : reqs.filter(r => !r.required);

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
      {anyN && (
        <View className='requirements-hint' style={{ marginBottom: '8px' }}>
          <Text>{t('req.anyNHint', { n: check.needCount, c: check.satisfiedCount })}</Text>
        </View>
      )}

      {requiredItems.map(req => {
        const platform = platformById(req.platformId);
        const failure = check.failures.find(f => f.platformId === req.platformId);
        // 满足态：有粉丝门槛→显示达标；否则→已绑定
        const isFriends = platform.countLabel === 'friends';
        let icon = '✓';
        let color = '#10b981';
        let desc = req.minFollowers
          ? t(isFriends ? 'req.friendsOk' : 'req.followersOk', { n: req.minFollowers.toLocaleString() })
          : t('req.bound');
        if (failure) {
          if (failure.type === 'INSUFFICIENT') {
            // 数量不够是硬差距（当场改不了）：红色 + 讲清差多少
            icon = '✗';
            color = '#ef4444';
            desc = t(isFriends ? 'req.friendsInsufficient' : 'req.insufficient', { c: failure.current.toLocaleString(), r: failure.required.toLocaleString() });
          } else {
            // 没绑：不是错误、是可当场补的动作。中性色 + "需绑定X"（报名时会弹出补录）
            icon = '';
            color = '#6b7280';
            desc = t('req.needBind', { name: platform.name });
          }
        }
        return (
          <View key={req.platformId}>
            <View className='requirement-row'>
              <Text className='requirement-icon'>{platform.icon}</Text>
              <Text className='requirement-name'>{platform.name}</Text>
              <Text style={{ fontSize: '12px', color, fontWeight: 500 }}>
                {icon ? icon + ' ' : ''}{desc}
              </Text>
            </View>
            {/* 联系类未绑：补一句为什么要绑，消除"莫名其妙要我加微信"的困惑 */}
            {failure && failure.type === 'MISSING' && !platform.hasFollowers && (
              <Text className='requirements-hint' style={{ display: 'block', marginTop: '2px' }}>
                {t('req.contactHint')}
              </Text>
            )}
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
              <Text style={{ fontSize: '12px', color: '#10b981' }}>{t('req.boundCheck')}</Text>
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
