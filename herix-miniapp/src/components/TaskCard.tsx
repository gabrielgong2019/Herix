import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './TaskCard.scss';
import { t, tf } from '../utils/i18n';
import { fmt } from '../utils/format';

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
  creator_id?: string | null;
  category?: string | null;
  difficulty?: string | null;
  mode: string;
  fast_payout?: boolean;
  cover_image?: string | null;
  brand_promo_image_url?: string | null;
  brand_logo_url?: string | null;
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

      <View className='card-body'>
        <View className='card-c'>
          <Text className='card-title'>{task.title}</Text>
          <View className='meta-row'>
            <View className='brand-part' onClick={goBrand}>
              <View className='brand-icon'>
                {task.brand_logo_url
                  ? <View className='brand-icon-img' style={{ backgroundImage: `url(${task.brand_logo_url})` }} />
                  : <Text>{(task.creator_name || 'B')[0]}</Text>}
              </View>
              <Text className='brand-name'>{task.creator_name || ''}</Text>
              {task.creator_id && <Text className='brand-arrow'>›</Text>}
            </View>
            <Text className='commission'>¥{fmt(price)}</Text>
          </View>
          {rating > 0 && (
            <View className='rating-row'>
              {[1, 2, 3, 4, 5].map(s => (
                <Text key={s} className={`star ${s <= filledStars ? 'on' : 'off'}`}>
                  {s <= filledStars ? '★' : '☆'}
                </Text>
              ))}
              <Text className='rating-num'>{rating}</Text>
            </View>
          )}
        </View>
        {img && (
          <View className='thumb' style={{ backgroundImage: `url(${img})` }} />
        )}
      </View>
    </View>
  );
}
