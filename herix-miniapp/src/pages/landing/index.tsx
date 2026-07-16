import { Component } from 'react';
import { View, Text, Image, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { auth, tasks as taskApi, categories as categoriesApi, setToken } from '../../utils/api';
import './index.scss';

const fmt = (n: any) => {
  const v = Math.round(Math.abs(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

interface State {
  taskId: string;
  task: any;
  taskLoading: boolean;
  categories: any[];
  authTab: 'login' | 'register';
  email: string;
  nick: string;
  pass: string;
  err: string;
  submitting: boolean;
}

export default class Landing extends Component<{}, State> {
  state: State = {
    taskId: '',
    task: null,
    taskLoading: false,
    categories: [],
    authTab: 'login',
    email: '',
    nick: '',
    pass: '',
    err: '',
    submitting: false,
  };

  componentDidMount() {
    const params = Taro.getCurrentInstance().router?.params || {};
    const taskId = (params.task || params.taskId || '') as string;
    this.loadCategories();
    if (taskId) {
      this.setState({ taskId, taskLoading: true });
      this.loadTask(taskId);
    }
  }

  loadCategories = async () => {
    try {
      const cats = await categoriesApi.list();
      this.setState({ categories: cats || [] });
    } catch {
      /* 分类只是装饰，失败不影响落地页 */
    }
  };

  loadTask = async (taskId: string) => {
    try {
      const t = await taskApi.detail(taskId);
      this.setState({ task: t && !t.error ? t : null, taskLoading: false });
    } catch (err) {
      console.error('load landing task error:', err);
      this.setState({ taskLoading: false });
    }
  };

  doAuth = async () => {
    const { authTab, email, nick, pass, taskId, submitting } = this.state;
    if (submitting) return;
    const em = email.trim();
    const pw = pass.trim();
    const nk = nick.trim();
    if (!em || !pw) {
      this.setState({ err: '请填写邮箱和密码' });
      return;
    }
    if (authTab === 'register' && !nk) {
      this.setState({ err: '请填写昵称' });
      return;
    }
    this.setState({ err: '', submitting: true });
    try {
      const d: any =
        authTab === 'login'
          ? await auth.login({ account: em, password: pw })
          : await auth.register({ email: em, password: pw, nickname: nk, role: 'HERALD' });
      if (d?.token) setToken(d.token);
      // 新注册赫使 or 未完成入驻 → 先走入职引导（透传邀请任务，引导完再报名）；
      // 已入驻登录用户 → 有邀请任务直达详情、否则进首页
      const onboarded = d?.user?.is_onboarded;
      const needOnboard = authTab === 'register' || (onboarded !== undefined && !onboarded);
      if (needOnboard) {
        Taro.redirectTo({ url: `/pages/onboard/index${taskId ? `?taskId=${taskId}` : ''}` });
      } else if (taskId) {
        Taro.redirectTo({ url: `/pages/task/task?id=${taskId}` });
      } else {
        Taro.switchTab({ url: '/pages/index/index' });
      }
    } catch (err: any) {
      this.setState({ err: err?.message || '登录失败，请重试', submitting: false });
    }
  };

  render() {
    const { task, taskLoading, categories, authTab, email, nick, pass, err, submitting } = this.state;
    const isReg = authTab === 'register';
    const cat = task ? categories.find(c => c.id === task.category) : null;
    const catText = task ? [cat?.icon, cat?.label || task.category].filter(Boolean).join(' ') : '';
    const payout = task?.payout_per_herald ? `¥${fmt(task.payout_per_herald)}` : '';

    return (
      <View className='landing-page'>
        {/* 品牌头 */}
        <View className='lp-header'>
          <Image className='lp-logo' src='/Logo/herix-icon-filled.png' mode='aspectFit' />
          <Text className='lp-brand'>Herix</Text>
        </View>

        {/* 邀请任务预览 */}
        {task ? (
          <View className='lp-task'>
            {!!catText && <Text className='lp-task-cat'>{catText}</Text>}
            <Text className='lp-task-title'>{task.title}</Text>
            {!!task.creator_name && <Text className='lp-task-brand'>来自 {task.creator_name}</Text>}
            <View className='lp-task-payout'>
              <Text className='lp-payout-num'>{payout}</Text>
              <Text className='lp-payout-label'>任务报酬</Text>
            </View>
            {!!task.description && <Text className='lp-task-desc'>{task.description}</Text>}
          </View>
        ) : (
          <View className='lp-task placeholder'>
            <Text className='lp-task-loading'>{taskLoading ? '加载任务中…' : ''}</Text>
          </View>
        )}

        {/* 登录 / 注册 */}
        <View className='lp-auth'>
          <Text className='lp-auth-title'>{task ? '登录后立即报名' : '加入 Herix'}</Text>

          <View className='lp-tabs'>
            <Text
              className={`lp-tab ${authTab === 'login' ? 'active' : ''}`}
              onClick={() => this.setState({ authTab: 'login', err: '' })}
            >
              登录
            </Text>
            <Text
              className={`lp-tab ${authTab === 'register' ? 'active' : ''}`}
              onClick={() => this.setState({ authTab: 'register', err: '' })}
            >
              注册
            </Text>
          </View>

          <Text className='lp-err'>{err}</Text>

          <Input
            className='lp-input'
            type='text'
            placeholder='邮箱地址'
            value={email}
            onInput={e => this.setState({ email: e.detail.value })}
          />
          {isReg && (
            <Input
              className='lp-input'
              type='text'
              placeholder='昵称'
              value={nick}
              onInput={e => this.setState({ nick: e.detail.value })}
            />
          )}
          <Input
            className='lp-input'
            password
            placeholder='密码（至少6位）'
            value={pass}
            onInput={e => this.setState({ pass: e.detail.value })}
          />

          <View className={`lp-submit ${submitting ? 'disabled' : ''}`} onClick={submitting ? undefined : this.doAuth}>
            {submitting ? '处理中...' : authTab === 'login' ? '登录并报名' : '注册并报名'}
          </View>
        </View>
      </View>
    );
  }
}
