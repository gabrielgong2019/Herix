import { Component } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Image, ScrollView, Input } from '@tarojs/components';
import logoWide from '../../assets/herix-logo-wide.png';
import { tasks as taskApi, categories as categoriesApi, communities as communitiesApi, ambassador, getToken } from '../../utils/api';
import { onSessionChange } from '../../utils/session';
import TaskCard, { CategoryItem, TaskCardTask } from '../../components/TaskCard';
import './index.scss';
import { refreshUnreadBadge } from '../../utils/badge';
import { t, tf } from '../../utils/i18n';

// 对齐 herix.html 原版：首页 = 纯浏览列表（探索）。
// "我的待办"住在底部「任务」tab（herald-dashboard），首页不再内嵌待办切换。

const isWeapp = process.env.TARO_ENV === 'weapp';
const ONBOARD_HINT_DISMISSED_AT = 'herix_onboard_hint_dismissed_at';
const ONBOARD_HINT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 关闭后 7 天冷却，避免一生一次后引导失效

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
  loadError: boolean;
  /** 未入驻引导卡（已登录 + 未完成入驻 + 未手动关闭时展示） */
  showOnboardHint: boolean;
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
    loadError: false,
    showOnboardHint: false,
  };

  searchTimer: ReturnType<typeof setTimeout> | null = null;
  exposureTimer: ReturnType<typeof setTimeout> | null = null;
  unsubscribeSession: (() => void) | null = null;

  componentWillUnmount() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.exposureTimer) clearTimeout(this.exposureTimer);
    if (this.unsubscribeSession) this.unsubscribeSession();
  }

  componentDidMount() {
    this.loadCommunity();
    this.loadData();
    // 登录/登出/切换账号/切语言都是全局会话变化，订阅后自动重拉，
    // 避免保留登录前加载的匿名全量列表（stale UI）
    this.unsubscribeSession = onSessionChange(() => {
      this.loadCommunity();
      this.loadData();
    });
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
      // 已登录但未完成入驻：展示引导（关闭后 7 天冷却，避免永久失效）
      const dismissedAt = Number(Taro.getStorageSync(ONBOARD_HINT_DISMISSED_AT)) || 0;
      if (profile && !profile.is_onboarded && Date.now() - dismissedAt > ONBOARD_HINT_COOLDOWN_MS) {
        this.setState({ showOnboardHint: true });
      }
    } catch { /* 未登录/社群信息拿不到不阻断列表 */ }
  };

  dismissOnboardHint = () => {
    Taro.setStorageSync(ONBOARD_HINT_DISMISSED_AT, String(Date.now()));
    this.setState({ showOnboardHint: false });
  };

  goOnboard = () => {
    Taro.navigateTo({ url: '/pages/onboard/index' });
  };

  // 语言可能在其他 tab(profile)被切换——回到本页时按当前语言重渲染。
  // 其他 tab 页的 componentDidShow 本来就会 setState 触发重渲染,唯独本页曾漏掉
  componentDidShow() {
    this.forceUpdate();
    refreshUnreadBadge(); // 消息 tab 未读气泡随 tab 切换刷新
    // 入驻完成后回到首页时撤下引导（顺带刷新社群过滤状态）
    if (this.state.showOnboardHint) this.loadCommunity();
  }

  loadData = async (opts?: { allCommunities?: boolean; search?: string; category?: string }) => {
    this.setState({ loading: true, loadError: false });
    try {
      const [taskRes, categoryRes] = await Promise.all([
        taskApi.list({
          allCommunities: opts?.allCommunities ?? this.state.allCommunities,
          search: opts?.search ?? this.state.searchText.trim(),
          category: opts?.category ?? this.state.activeCategory,
        }),
        categoriesApi.list().catch(() => []),
      ]);
      this.setState({ taskList: taskRes.tasks || [], categories: categoryRes || [] });
      this.reportExposure(taskRes.tasks || []);
    } catch (err: any) {
      console.error('Load error:', err);
      this.setState({ loadError: true });
    }
    this.setState({ loading: false });
  };

  // 曝光/点击埋点（服务端按 用户×任务×小时 去重；未登录不上报）
  reportExposure = (list: TaskCardTask[]) => {
    if (!list.length || !getToken()) return;
    const events = list.slice(0, 20).map(task => ({ taskId: task.id, eventType: 'exposure' as const }));
    if (this.exposureTimer) clearTimeout(this.exposureTimer);
    this.exposureTimer = setTimeout(() => {
      taskApi.trackEvents(events).catch(() => { /* 埋点失败不打扰 */ });
    }, 600);
  };

  reportClick = (taskId: string) => {
    if (!getToken()) return;
    taskApi.trackEvents([{ taskId, eventType: 'click' }]).catch(() => { /* 埋点失败不打扰 */ });
  };

  toggleCommunityFilter = (target: boolean) => {
    if (target === this.state.allCommunities) return;
    this.setState({ allCommunities: target });
    this.loadData({ allCommunities: target });
  };

  onSearchInput = (e: any) => {
    this.setState({ searchText: e.detail.value });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadData({ search: e.detail.value.trim() }), 300);
  };

  onClearSearch = () => {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.setState({ searchText: '' });
    this.loadData({ search: '' });
  };

  onCategoryClick = (id: string) => {
    this.setState({ activeCategory: id });
    this.loadData({ category: id });
  };

  render() {
    const { taskList, categories, activeCategory, searchText, loading, loadError, navMetrics, communityId, communityName, allCommunities, showOnboardHint } = this.state;
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

        {/* 搜索栏 + 社群范围切换（同排，右侧不挤占搜索） */}
        <View className='search-row'>
          <View className='search-bar'>
            <Text className='search-icon'>🔍</Text>
            <Input
              className='search-input'
              value={searchText}
              placeholder={t('index.searchPh')}
              placeholderStyle='color:#aaa'
              onInput={this.onSearchInput}
            />
            {!!searchText && (
              <Text className='search-clear' onClick={this.onClearSearch}>✕</Text>
            )}
          </View>
          {!!communityId && (
            <View className='community-toggle'>
              <Text
                className={`ct-seg ${!allCommunities ? 'active' : ''}`}
                onClick={() => this.toggleCommunityFilter(false)}
              >
                {t('task.communityMine')}
              </Text>
              <Text
                className={`ct-seg ${allCommunities ? 'active' : ''}`}
                onClick={() => this.toggleCommunityFilter(true)}
              >
                {t('task.communityAll')}
              </Text>
            </View>
          )}
        </View>

        {/* 未入驻引导卡（可关闭，关闭后不再出现） */}
        {showOnboardHint && (
          <View className='onboard-hint'>
            <View className='oh-body' onClick={this.goOnboard}>
              <Text className='oh-title'>{t('index.onboardHintTitle')}</Text>
              <Text className='oh-sub'>{t('index.onboardHintSub')}</Text>
            </View>
            <Text className='oh-go' onClick={this.goOnboard}>{t('index.onboardGo')}</Text>
            <Text className='oh-close' onClick={this.dismissOnboardHint}>✕</Text>
          </View>
        )}

        <ScrollView className='filters' scrollX enhanced showScrollbar={false}>
          <Text
            className={`filter ${activeCategory === '' ? 'active' : ''}`}
            onClick={() => this.onCategoryClick('')}
          >
            {t('common.all')}
          </Text>
          {visibleCategories.map(c => (
            <Text
              key={c.id}
              className={`filter ${activeCategory === c.id ? 'active' : ''}`}
              onClick={() => this.onCategoryClick(c.id)}
            >
              {tf(`category.${c.id}`, c.label)}
            </Text>
          ))}
        </ScrollView>

        {loading ? (
          <View className='loading'><Text>{t('common.loading')}</Text></View>
        ) : loadError ? (
          <View className='empty'>
            <Text className='empty-text'>{t('index.loadFailed')}</Text>
            <Text className='empty-retry' onClick={() => this.loadData()}>{t('index.retry')}</Text>
          </View>
        ) : (
          <ScrollView className='list' scrollY>
            <View className='grid'>
              {taskList.length > 0 ? (
                taskList.map(task => <TaskCard key={task.id} task={task} categories={categories} onClickTask={this.reportClick} />)
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
