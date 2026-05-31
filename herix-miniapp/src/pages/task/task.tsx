import { Component } from 'react';
import { View, Text, Button, Navigator } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { tasks as taskApi, applications, submissions as subApi, getToken } from '../../utils/api';
import './task.scss';

interface TaskDetail {
  id: string;
  title: string;
  description: string;
  requirements: string;
  budget: number;
  commission: number;
  max_heralds: number;
  mode: string;
  status: string;
  creator_name: string;
  creator_id: string;
  application_count: number;
  applications: any[];
  is_escrowed: number;
  _count: { applications: number; submissions: number };
}

interface State {
  task: TaskDetail | null;
  loading: boolean;
  role: string | null;
  userId: string | null;
  myApplication: any;
  mySubmission: any;
}

export default class TaskDetail extends Component<{ id: string }, State> {
  state: State = {
    task: null,
    loading: true,
    role: null,
    userId: null,
    myApplication: null,
    mySubmission: null,
  };

  componentDidMount() {
    this.loadTask();
  }

  loadTask = async () => {
    try {
      const params = Taro.getCurrentInstance().router?.params;
      const id = params?.id as string;
      if (!id) return;

      const task = await taskApi.detail(id);
      this.setState({ task, loading: false });

      // 检查当前用户报名状态
      try {
        const profile = await Taro.getStorage({ key: 'herix_user' }).catch(() => null);
        if (profile) {
          const userData = profile.data;
          this.setState({ role: userData.role, userId: userData.id });

          if (userData.role === 'HERALD') {
            const myApps = await applications.my();
            const myApp = myApps.find((a: any) => a.task_id === id);
            if (myApp) this.setState({ myApplication: myApp });

            const mySubs = await subApi.my();
            const mySub = mySubs.find((s: any) => s.task_id === id);
            if (mySub) this.setState({ mySubmission: mySub });
          }
        }
      } catch {}
    } catch (err: any) {
      Taro.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setState({ loading: false });
    }
  };

  handleApply = async () => {
    if (!getToken()) {
      Taro.navigateTo({ url: '/pages/profile/profile' });
      return;
    }
    try {
      await applications.apply(this.state.task!.id, '');
      Taro.showToast({ title: '报名成功', icon: 'success' });
      this.loadTask();
    } catch (err: any) {
      Taro.showToast({ title: err.message || '报名失败', icon: 'none' });
    }
  };

  handleSubmit = () => {
    Taro.navigateTo({ url: `/pages/apply/apply?taskId=${this.state.task!.id}` });
  };

  render() {
    const { task, loading, myApplication, mySubmission, role } = this.state;

    if (loading) {
      return <View className='loading'><Text>加载中...</Text></View>;
    }

    if (!task) {
      return <View className='loading'><Text>任务不存在</Text></View>;
    }

    const canApply = role === 'HERALD' && task.status === 'OPEN' && !myApplication;
    const canSubmit = role === 'HERALD' && myApplication?.status === 'APPROVED' && !mySubmission;

    return (
      <View className='task-detail'>
        {/* 任务基本信息 */}
        <View className='section'>
          <Text className='title'>{task.title}</Text>
          <View className='tags'>
            <Text className='tag'>{task.mode === 'STANDARD' ? '普通任务' : '成果报酬'}</Text>
            <Text className={`tag status-${task.status.toLowerCase()}`}>
              {task.status === 'OPEN' ? '招募中' : task.status}
            </Text>
          </View>
          <Text className='price'>¥{task.commission}/人</Text>
          <Text className='meta'>预算：¥{task.budget} · 招募 {task.max_heralds} 人</Text>
        </View>

        {/* 任务描述 */}
        <View className='section'>
          <Text className='section-title'>任务描述</Text>
          <Text className='content'>{task.description}</Text>
        </View>

        {task.requirements && (
          <View className='section'>
            <Text className='section-title'>要求</Text>
            <Text className='content'>{task.requirements}</Text>
          </View>
        )}

        {/* 报名列表 */}
        <View className='section'>
          <Text className='section-title'>报名情况 ({task.applications.length})</Text>
          {task.applications.map((app: any) => (
            <View key={app.id} className='applicant'>
              <Text className='name'>{app.nickname}</Text>
              <Text className={`app-status ${app.status.toLowerCase()}`}>
                {app.status === 'PENDING' ? '待审核' : app.status === 'APPROVED' ? '已通过' : '已拒绝'}
              </Text>
            </View>
          ))}
          {task.applications.length === 0 && (
            <Text className='muted'>暂无报名</Text>
          )}
        </View>

        {/* 底部操作按钮 */}
        <View className='actions'>
          {myApplication && (
            <View className='apply-status'>
              <Text>报名状态：{myApplication.status === 'PENDING' ? '待审核' : myApplication.status === 'APPROVED' ? '已通过 ✓' : '未通过'}</Text>
            </View>
          )}
          {canApply && (
            <Button className='btn-primary' onClick={this.handleApply}>报名任务</Button>
          )}
          {canSubmit && (
            <Button className='btn-primary' onClick={this.handleSubmit}>提交结果</Button>
          )}
          {!getToken() && task.status === 'OPEN' && (
            <Button className='btn-primary' onClick={this.handleApply}>登录后报名</Button>
          )}
        </View>
      </View>
    );
  }
}
