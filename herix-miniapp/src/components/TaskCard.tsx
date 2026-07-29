import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './TaskCard.scss';
import { t, tf } from '../utils/i18n';
import { fmt } from '../utils/format';
import { assetUrl } from '../utils/api';

const DIFF: Record<string, { labelKey: string }> = {
  easy:   { labelKey: 'taskCard.diffEasy' },
  medium: { labelKey: 'taskCard.diffMedium' },
  hard:   { labelKey: 'taskCard.diffHard' },
};

export interface CategoryItem {
  id: string;
  label: string;
  icon?: string;
}

export interface TaskCardTask {
  id: string;
  title: string;
  description?: string | null;
  creator_id?: string | null;
  category?: string | null;
  difficulty?: string | null;
  mode: string;
  fast_payout?: boolean;
  cover_image?: string | null;
  brand_promo_image_url?: string | null;
  brand_logo_url?: string | null;
  brand_company_name?: string | null;
  creator_name?: string;
  payout_per_herald?: number;
  commission?: number;
  currency?: string;
  avg_rating?: number | string | null;
}

interface Props {
  task: TaskCardTask;
  categories: CategoryItem[];
}

/**
 * 紧凑信息卡（2026-07-29 定稿：方案1形态，用户否决大图卡"空间利用效率太低"）。
 * 吸收对比稿方案1的可取点：右图放大到约1/3卡宽·4:3饱满比例、标题下描述摘要行、
 * 底部"品牌+评分"与口径化报酬同行收尾。无图任务纯文字排布，价格恒在右下不悬空。
 */
export default function TaskCard({ task, categories }: Props) {
  const img = task.cover_image || task.brand_promo_image_url || '';
  const rating = parseFloat(String(task.avg_rating)) || 0;
  const filledStars = Math.round(rating);
  const isPerformance = task.mode === 'PERFORMANCE';
  const diff = DIFF[task.difficulty || 'easy'] || DIFF.easy;
  const cat = categories.find(c => c.id === task.category);
  const catText = [cat?.icon, cat ? tf(`category.${cat.id}`, cat.label) : task.category]
    .filter(Boolean)
    .join(' ');
  const price = task.payout_per_herald ?? task.commission;
  // 赫使决策看品牌不看昵称：公司名优先，昵称兜底
  const brandName = task.brand_company_name || task.creator_name || '';

  function goTask() {
    Taro.navigateTo({ url: `/pages/task/task?id=${task.id}` });
  }

  function goBrand(e: any) {
    e.stopPropagation();
    if (task.creator_id) {
      Taro.navigateTo({ url: `/pages/brand/brand?id=${task.creator_id}` });
    }
  }

  return (
    <View className='task-card' onClick={goTask}>
      <View className='card-top'>
        <View className='card-top-left'>
          {catText && <Text className='tag'>{catText}</Text>}
          <Text className={`mode-tag ${isPerformance ? 'mode-perf' : 'mode-std'}`}>
            {isPerformance ? t('taskCard.perf') : t('taskCard.std')}
          </Text>
        </View>
        <View className='card-top-right'>
          <View className='diff-tag'>
            <View className={`diff-dot d-${task.difficulty || 'easy'}`} />
            <Text>{t(diff.labelKey)}</Text>
          </View>
          {task.fast_payout && <Text className='fp-tag'>{t('taskCard.fastPayout')}</Text>}
        </View>
      </View>

      <View className='card-mid'>
        <View className='card-c'>
          <Text className='card-title'>{task.title}</Text>
          {task.description && <Text className='card-desc'>{task.description}</Text>}
        </View>
        {img && <View className='thumb' style={{ backgroundImage: `url(${assetUrl(img)})` }} />}
      </View>

      <View className='card-foot'>
        <View className='brand-part' onClick={goBrand}>
          <View className='brand-icon'>
            {task.brand_logo_url
              ? <View className='brand-icon-img' style={{ backgroundImage: `url(${assetUrl(task.brand_logo_url)})` }} />
              : <Text>{(brandName || 'B')[0]}</Text>}
          </View>
          <Text className='brand-name'>{brandName}</Text>
          {task.creator_id && <Text className='brand-arrow'>›</Text>}
          {rating > 0 && (
            <View className='rating-inline'>
              <Text className='star on'>★</Text>
              <Text className='rating-num'>{rating}</Text>
            </View>
          )}
        </View>
        <View className='price-part'>
          <Text className='commission'>¥{fmt(price)}</Text>
          <Text className='price-unit'>{isPerformance ? t('taskCard.unitConv') : t('taskCard.unitPerson')}</Text>
        </View>
      </View>
    </View>
  );
}
