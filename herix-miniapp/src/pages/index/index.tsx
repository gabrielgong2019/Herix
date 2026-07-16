import { Component } from 'react';
import { View, Text, Image, ScrollView, Navigator } from '@tarojs/components';
import logoIcon from '../../assets/herix-icon.png';
import { tasks as taskApi, applications, categories as categoriesApi, auth, getToken } from '../../utils/api';
import TaskCard, { CategoryItem, TaskCardTask } from '../../components/TaskCard';
import './index.scss';

interface AppItem {
  id: string;
  task_id: string;
  status: string;
  task_title: string;
  task_status: string;
  commission: number;
  mode: string;
}

interface State {
  taskList: TaskCardTask[];
  categories: CategoryItem[];
  activeCategory: string;
  myApps: AppItem[];
  loading: boolean;
  loggedIn: boolean;
  userRole: string | null;
  activeTab: 'browse' | 'mine';
}

export default class Index extends Component<{}, State> {
  state: State = {
    taskList: [],
    categories: [],
    activeCategory: '',
    myApps: [],
    loading: true,
    loggedIn: false,
    userRole: null,
    activeTab: 'browse',
  };

  componentDidMount() {
    this.loadData();
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

      if (getToken()) {
        // 角色信息以后端为准，不信任本地缓存（跟 task.tsx 同样的坑，见那边的注释）
        const userData = await auth.me();
        this.setState({ loggedIn: true, userRole: userData.role });

        if (userData.role === 'HERALD') {
          const apps = await applications.my();
          this.setState({
            myApps: apps.filter((a: AppItem) => a.status === 'APPROVED'),
            activeTab: 'mine',
          });
        } else if (userData.role === 'BRAND') {
          this.setState({ activeTab: 'browse' });
        }
      }
    } catch (err: any) {
      console.error('Load error:', err);
    }
    this.setState({ loading: false });
  };

  renderApp = (app: AppItem) => (
    <Navigator key={app.id} className='mini-card mine' url={`/pages/task/task?id=${app.task_id}`}>
      <View className='mini-card-header'>
        <Text className='mini-card-title'>{app.task_title}</Text>
        <Text className='mini-card-price'>¥{app.commission}</Text>
      </View>
      <View className='mini-card-meta'>
        <Text className='app-badge approved'>报名已通过</Text>
        <Text className='mini-card-tag'>{app.mode === 'PERFORMANCE' ? '成果报酬' : '普通任务'}</Text>
      </View>
    </Navigator>
  );

  render() {
    const { taskList, categories, activeCategory, myApps, loading, loggedIn, userRole, activeTab } = this.state;
    const visibleTasks = activeCategory ? taskList.filter(t => t.category === activeCategory) : taskList;
    // 对齐 herix.html：分类胶囊只显示当前任务列表中实际有任务的分类（从全量列表算，别用过滤后的）
    const visibleCategories = categories.filter(c => taskList.some(t => t.category === c.id));

    return (
      <View className='index-page'>
        <View className='header'>
          <View className='logo-row'>
            <Image className='logo-icon' src={logoIcon} mode='aspectFit' />
            <Text className='logo'>
              <Text className='logo-accent'>赫</Text>使 HERIX
            </Text>
          </View>
          <Text className='slogan'>不止于赫</Text>
        </View>

        <ScrollView className='filters' scrollX>
          <Text
            className={`filter ${activeCategory === '' ? 'active' : ''}`}
            onClick={() => this.setState({ activeCategory: '' })}
          >
            全部
          </Text>
          {visibleCategories.map(c => (
            <Text
              key={c.id}
              className={`filter ${activeCategory === c.id ? 'active' : ''}`}
              onClick={() => this.setState({ activeCategory: c.id })}
            >
              {c.label}
            </Text>
          ))}
        </ScrollView>

        {loggedIn && userRole === 'HERALD' && (
          <View className='tab-bar'>
            <Text
              className={`tab ${activeTab === 'mine' ? 'active' : ''}`}
              onClick={() => this.setState({ activeTab: 'mine' })}
            >
              我的待办 ({myApps.length})
            </Text>
            <Text
              className={`tab ${activeTab === 'browse' ? 'active' : ''}`}
              onClick={() => this.setState({ activeTab: 'browse' })}
            >
              浏览任务
            </Text>
          </View>
        )}

        {loading ? (
          <View className='loading'><Text>加载中...</Text></View>
        ) : (
          <ScrollView className='list' scrollY>
            {activeTab === 'mine' && loggedIn && userRole === 'HERALD' && (
              <View>
                {myApps.length > 0 ? (
                  myApps.map(app => this.renderApp(app))
                ) : (
                  <View className='empty'>
                    <Text className='empty-text'>暂无待办任务</Text>
                    <Text className='empty-action' onClick={() => this.setState({ activeTab: 'browse' })}>
                      去浏览任务
                    </Text>
                  </View>
                )}
              </View>
            )}

            {activeTab === 'browse' && (
              <View className='grid'>
                {visibleTasks.length > 0 ? (
                  visibleTasks.map(task => <TaskCard key={task.id} task={task} categories={categories} />)
                ) : (
                  <View className='empty'>
                    <Text className='empty-text'>暂无任务</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    );
  }
}
