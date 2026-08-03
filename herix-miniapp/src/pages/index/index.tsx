import { Component } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Image, ScrollView, Input } from '@tarojs/components';
import logoWide from '../../assets/herix-logo-wide.png';
import { tasks as taskApi, categories as categoriesApi, communities as communitiesApi, ambassador } from '../../utils/api';
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
  searchText: string;
  loading: boolean;
  navMetrics: NavMetrics | null;
  communityId: string;
  communityName: string;
  allCommunities: boolean;
}

export default class Index extends Component<{}, State> {
  // getSystemInfoSync/getMenuButtonBoundingClientRect 都是同步 API，
  // 构造时就能算出来，首屏不会有布局跳动
  state: State = {
    taskList: [],
    categories: [],
    activeCategory: '',
    searchText: '',
    loading: true,
    navMetrics: getWeappNavMetrics(),
    communityId: '',
    communityName: '',
    allCommunities: false,
  };

  componentDidMount() {
    this.loadCommunity();
    this.loadData();
  }

  loadCommunity = async () => {
    try {
      const [profile, commList] = await Promise.all([
        ambassador.getProfile(),
        communitiesApi.list(),
      ]);
      const cid = profile?.community ?? '';
      const comm = commList.find(c => c.id === cid);
      if (cid && comm) this.setState({ communityId: cid, communityName: t(comm.labelKey) });
    } catch { /* 社群信息拿不到不阻断列表 */ }
  };

  // 语言可能在其他 tab(profile)被切换——回到本页时按当前语言重渲染。
  // 其他 tab 页的 componentDidShow 本来就会 setState 触发重渲染,唯独本页曾漏掉
  componentDidShow() {
    this.forceUpdate();
    refreshUnreadBadge(); // 消息 tab 未读气泡随 tab 切换刷新
  }

  loadData = async (allCommunities?: boolean) => {
    this.setState({ loading: true });
    try {
      const taskRes = await taskApi.list({ allCommunities: allCommunities ?? this.state.allCommunities });
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

  toggleCommunityFilter = () => {
    const next = !this.state.allCommunities;
    this.setState({ allCommunities: next });
    this.loadData(next);
  };

  render() {
    const { taskList, categories, activeCategory, searchText, loading, navMetrics, communityId, communityName, allCommunities } = this.state;
    const keyword = searchText.trim().toLowerCase();
    const visibleTasks = taskList.filter(task => {
      if (activeCategory && task.category !== activeCategory) return false;
      if (keyword && !task.title?.toLowerCase().includes(keyword) && !task.description?.toLowerCase().includes(keyword)) return false;
      return true;
    });
    // 对齐 herix.html：分类胶囊只显示当前任务列表中实际有任务的分类（从全量列表算，别用过滤后的）
    const visibleCategories = categories.filter(c => taskList.some(t => t.category === c.id));

    return (
      <View className='index-page'>
        {navMetrics ? (
          <>
            {/* 小程序：接管原生标题栏，logo 跟胶囊按钮同一行，slogan 贴胶囊左侧 */}
            <View
              className='weapp-navbar'
              style={{ height: `${navMetrics.barHeight}px`, paddingTop: `${navMetrics.top}px`, paddingRight: `${navMetrics.paddingRight}px` }}
            >
              <Image className='logo-wide compact' src={logoWide} mode='aspectFit' />
              <Text className='slogan compact'>{t('index.slogan')}</Text>
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

        {/* 搜索栏 */}
        <View className='search-bar'>
          <Text className='search-icon'>🔍</Text>
          <Input
            className='search-input'
            value={searchText}
            placeholder={t('index.searchPh')}
            placeholderStyle='color:#aaa'
            onInput={e => this.setState({ searchText: e.detail.value })}
          />
          {!!searchText && (
            <Text className='search-clear' onClick={() => this.setState({ searchText: '' })}>✕</Text>
          )}
        </View>

        {/* 社群过滤 banner（仅在有社群设置时展示） */}
        {!!communityId && (
          <View className='community-banner' onClick={this.toggleCommunityFilter}>
            <Text className='community-banner-text'>
              {allCommunities
                ? t('task.communityFilterOff')
                : t('task.communityFilter', { name: communityName })}
            </Text>
            <Text className='community-banner-toggle'>
              {allCommunities ? t('task.communityFilterOn') : t('task.communityFilterOff')}
            </Text>
          </View>
        )}

        <ScrollView className='filters' scrollX enhanced showScrollbar={false}>
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
