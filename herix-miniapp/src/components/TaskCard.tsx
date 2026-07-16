import { View, Text, Navigator } from '@tarojs/components';
import './TaskCard.scss';

// 从 herix.html 的 cardHTML() 移植，保持同样的字段/展示逻辑
const DIFF: Record<string, { label: string }> = {
  easy: { label: '轻松' },
  medium: { label: '刚好' },
  hard: { label: '挑战' },
};

export interface CategoryItem {
  id: string;
  label: string;
  icon?: string;
}

export interface TaskCardTask {
  id: string;
  title: string;
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

function commissionLabel(amount: number | undefined, _currency?: string): string {
  const payout = Number(amount) || 0;
  return '¥' + payout.toLocaleString();
  // herix.html 里这里还有个按 state.displayCurrency 做汇率换算的副标签，
  // 那个依赖一个目前还没搬过来的独立"显示币种切换"功能，先跳过
}

export default function TaskCard({ task, categories }: Props) {
  const img = task.cover_image || task.brand_promo_image_url || '';
  const rating = parseFloat(String(task.avg_rating)) || 0;
  const filledStars = Math.round(rating);
  const isPerformance = task.mode === 'PERFORMANCE';
  const diff = DIFF[task.difficulty || 'easy'] || DIFF.easy;
  const cat = categories.find(c => c.id === task.category);
  const catText = [cat?.icon, cat?.label || task.category].filter(Boolean).join(' ');
  const price = task.payout_per_herald ?? task.commission;

  return (
    <Navigator className='task-card' url={`/pages/task/task?id=${task.id}`}>
      <View className='card-top'>
        {catText && <Text className='tag'>{catText}</Text>}
        <Text className={`mode-tag ${isPerformance ? 'mode-perf' : 'mode-std'}`}>
          {isPerformance ? '成果报酬' : '任务体验'}
        </Text>
        <View className='diff-tag'>
          <View className={`diff-dot d-${task.difficulty || 'easy'}`} />
          <Text>{diff.label}</Text>
        </View>
        {task.fast_payout && <Text className='fp-tag'>⚡ 极速打款</Text>}
      </View>

      <View className='card-body'>
        <View className='card-c'>
          <Text className='card-title'>{task.title}</Text>
          <View className='brand-row'>
            <View className='brand-icon'>
              {task.brand_logo_url ? (
                <View className='brand-icon-img' style={{ backgroundImage: `url(${task.brand_logo_url})` }} />
              ) : (
                <Text>{(task.creator_name || 'B')[0]}</Text>
              )}
            </View>
            <Text className='brand-name'>{task.creator_name || ''}</Text>
          </View>
          <Text className='commission'>{commissionLabel(price, task.currency)}</Text>
          <View className='rating-row'>
            {[1, 2, 3, 4, 5].map(s => (
              <Text key={s} className={`star ${s <= filledStars ? 'on' : 'off'}`}>
                {s <= filledStars ? '★' : '☆'}
              </Text>
            ))}
            <Text className='rating-num'>{rating > 0 ? rating : '新'}</Text>
          </View>
        </View>
        <View className='thumb' style={img ? { backgroundImage: `url(${img})` } : undefined} />
      </View>
    </Navigator>
  );
}
