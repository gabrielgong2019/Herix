import { Component } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import logoWide from '../../assets/herix-logo-wide.png';
import { tasks as taskApi, categories as categoriesApi } from '../../utils/api';
import TaskCard, { CategoryItem, TaskCardTask } from '../../components/TaskCard';
import './index.scss';
import { refreshUnreadBadge } from '../../utils/badge';
import { t, tf } from '../../utils/i18n';

// 对齐 herix.html 原版：首页 = 纯浏览列表（探索）。
// "我的待办"住在底部「任务」tab（herald-dashboard），首页不再内嵌待办切换。

const isWeapp = process.env.TARO_ENV === 'weapp';

interface NavMetrics {
  top: number;        // 状态栏高度，自定义栏顶部内边距
  barHeight: number;   // 状态栏+胶囊 的总高度（自定义栏整体高度）
  paddingRight: number; // 右侧让开胶囊按钮的宽度
  spacerHeight: number; // 自定义栏是 fixed 定位，下方需要等高占位撑开正文
}

/** 胶囊按钮位置是设备相关的同步系统 API，H5 端不存在、也不需要（无原生标题栏） */
function getWeappNavMetrics(): NavMetrics | null {
  if (!isWeapp) return null;
  try {
    const sys = Taro.getSystemInfoSync();
    const menu = Taro.getMenuButtonBoundingClientRect();
    return {
      top: sys.statusBarHeight || 20,
      barHeight: (sys.statusBarHeight || 20) + menu.height,
      paddingRight: sys.windowWidth - menu.left + 8,
      spacerHeight: menu.bottom + 6,
    };
  } catch {
    return null; // 拿不到就退回原有的（非 custom）标题栏布局，见 index.config.ts 兜底
  }
}

interface State {
  taskList: TaskCardTask[];
  categories: CategoryItem[];
  activeCategory: string;
  loading: boolean;
  navMetrics: NavMetrics | null;
}

export default class Index extends Component<{}, State> {
  // getSystemInfoSync/getMenuButtonBoundingClientRect 都是同步 API，
  // 构造时就能算出来，首屏不会有布局跳动
  state: State = {
    taskList: [],
    categories: [],
    activeCategory: '',
    loading: true,
    navMetrics: getWeappNavMetrics(),
  };

  componentDidMount() {
    this.loadData();
  }

  // 语言可能在其他 tab(profile)被切换——回到本页时按当前语言重渲染。
  // 其他 tab 页的 componentDidShow 本来就会 setState 触发重渲染,唯独本页曾漏掉
  componentDidShow() {
    this.forceUpdate();
    refreshUnreadBadge(); // 消息 tab 未读气泡随 tab 切换刷新
  }

  loadData = async () => {
    this.setState({ loading: true });
    try {
      // 分类接口是次要数据（仅用于筛选胶囊+卡片图标展示），拿不到不该连累任务列表整体不可用，
      // 所以跟任务列表分开 catch，不放进同一个 Promise.all
      const taskRes = await taskApi.list();
      this.setState({ taskList: taskRes.tasks || [] });

      try {
        const categoryRes = await categoriesApi.list();
        this.setState({ categories: categoryRes || [] });
      } catch (err: any) {
        console.error('Load categories error:', err);
      }
    } catch (err: any) {
      console.error('Load error:', err);
    }
    this.setState({ loading: false });
  };

  render() {
    const { taskList, categories, activeCategory, loading, navMetrics } = this.state;
    const visibleTasks = activeCategory ? taskList.filter(t => t.category === activeCategory) : taskList;
    // 对齐 herix.html：分类胶囊只显示当前任务列表中实际有任务的分类（从全量列表算，别用过滤后的）
    const visibleCategories = categories.filter(c => taskList.some(t => t.category === c.id));

    return (
      <View className='index-page'>
        {navMetrics ? (
          <>
            {/* 小程序：接管原生标题栏，logo 跟胶囊按钮同一行；slogan 空间不够放不下，先省略 */}
            <View
              className='weapp-navbar'
              style={{ height: `${navMetrics.barHeight}px`, paddingTop: `${navMetrics.top}px`, paddingRight: `${navMetrics.paddingRight}px` }}
            >
              <Image className='logo-wide compact' src={logoWide} mode='aspectFit' />
            </View>
            <View style={{ height: `${navMetrics.spacerHeight}px` }} />
          </>
        ) : (
          <View className='header'>
            <View className='logo-row'>
              <Image className='logo-wide' src={logoWide} mode='aspectFit' />
            </View>
            <Text className='slogan'>{t('index.slogan')}</Text>
          </View>
        )}

        <ScrollView className='filters' scrollX>
          <Text
            className={`filter ${activeCategory === '' ? 'active' : ''}`}
            onClick={() => this.setState({ activeCategory: '' })}
          >
            {t('common.all')}
          </Text>
          {visibleCategories.map(c => (
            <Text
              key={c.id}
              className={`filter ${activeCategory === c.id ? 'active' : ''}`}
              onClick={() => this.setState({ activeCategory: c.id })}
            >
              {tf(`category.${c.id}`, c.label)}
            </Text>
          ))}
        </ScrollView>

        {loading ? (
          <View className='loading'><Text>{t('common.loading')}</Text></View>
        ) : (
          <ScrollView className='list' scrollY>
            <View className='grid'>
              {visibleTasks.length > 0 ? (
                visibleTasks.map(task => <TaskCard key={task.id} task={task} categories={categories} />)
              ) : (
                <View className='empty'>
                  <Text className='empty-text'>{t('index.empty')}</Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    );
  }
}
