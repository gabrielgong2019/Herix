import { Component } from 'react';
import { View, Text, ScrollView, Navigator } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { tasks as taskApi, applications, getToken } from '../../utils/api';
import './index.scss';

interface TaskItem {
  id: string;
  title: string;
  commission: number;
  status: string;
  mode: string;
  creator_name?: string;
}

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
  taskList: TaskItem[];
  myApps: AppItem[];
  loading: boolean;
  loggedIn: boolean;
  userRole: string | null;
  activeTab: 'browse' | 'mine';
}

export default class Index extends Component<{}, State> {
  state: State = {
    taskList: [],
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
      const [taskRes] = await Promise.all([
        taskApi.list(),
      ]);
      this.setState({ taskList: taskRes.tasks || [] });

      // 检查登录状态
      if (getToken()) {
        const userData = Taro.getStorageSync('herix_user');
        if (userData) {
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
      }
    } catch (err: any) {
      console.error('Load error:', err);
    }
    this.setState({ loading: false });
  };

  renderTask = (task: TaskItem) => (
    <Navigator key={task.id} className='task-card' url={`/pages/task/task?id=${task.id}`}>
      <View className='task-header'>
        <Text className='task-title'>{task.title}</Text>
        <Text className='task-price'>¥{task.commission}</Text>
      </View>
      <View className='task-meta'>
        {task.creator_name && <Text className='task-creator'>{task.creator_name}</Text>}
        <Text className='task-tag'>{task.mode === 'PERFORMANCE' ? '成果报酬' : '普通任务'}</Text>
      </View>
    </Navigator>
  );

  renderApp = (app: AppItem) => (
    <Navigator key={app.id} className='task-card mine' url={`/pages/task/task?id=${app.task_id}`}>
      <View className='task-header'>
        <Text className='task-title'>{app.task_title}</Text>
        <Text className='task-price'>¥{app.commission}</Text>
      </View>
      <View className='task-meta'>
        <Text className='app-badge approved'>报名已通过</Text>
        <Text className='task-tag'>{app.mode === 'PERFORMANCE' ? '成果报酬' : '普通任务'}</Text>
      </View>
    </Navigator>
  );

  render() {
    const { taskList, myApps, loading, loggedIn, userRole, activeTab } = this.state;

    return (
      <View className='index-page'>
        {/* Tab 切换 */}
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
            {/* 我的待办 */}
            {activeTab === 'mine' && loggedIn && userRole === 'HERALD' && (
              <View>
                {myApps.length > 0 ? (
                  myApps.map(app => this.renderApp(app))
                ) : (
                  <View className='empty'>
                    <Text className='empty-text'>暂无待办任务</Text>
                    <Text
                      className='empty-action'
                      onClick={() => this.setState({ activeTab: 'browse' })}
                    >
                      去浏览任务
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* 浏览任务 */}
            {activeTab === 'browse' && (
              <View>
                {taskList.length > 0 ? (
                  taskList.map(task => this.renderTask(task))
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
