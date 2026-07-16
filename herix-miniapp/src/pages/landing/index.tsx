import { Component } from 'react';
import { View, Text, Image, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { auth, tasks as taskApi, categories as categoriesApi, setToken } from '../../utils/api';
import './index.scss';
import { t, tf, LOCALES, getLocale, setLocale } from '../../utils/i18n';
import { fmt } from '../../utils/format';


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

  switchLanguage = async () => {
    try {
      const res = await Taro.showActionSheet({ itemList: LOCALES.map(l => l.label) });
      const picked = LOCALES[res.tapIndex];
      if (picked && picked.id !== getLocale()) {
        await setLocale(picked.id);
        this.forceUpdate();
      }
    } catch { /* 用户取消 */ }
  };

  doAuth = async () => {
    const { authTab, email, nick, pass, taskId, submitting } = this.state;
    if (submitting) return;
    const em = email.trim();
    const pw = pass.trim();
    const nk = nick.trim();
    if (!em || !pw) {
      this.setState({ err: t('profile.errEmailPass') });
      return;
    }
    if (authTab === 'register' && !nk) {
      this.setState({ err: t('landing.fillNickname') });
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
      this.setState({ err: err?.message || t('landing.loginFailed'), submitting: false });
    }
  };

  render() {
    const { task, taskLoading, categories, authTab, email, nick, pass, err, submitting } = this.state;
    const isReg = authTab === 'register';
    const cat = task ? categories.find(c => c.id === task.category) : null;
    const catText = task ? [cat?.icon, cat ? tf(`category.${cat.id}`, cat.label) : task.category].filter(Boolean).join(' ') : '';
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
            {!!task.creator_name && <Text className='lp-task-brand'>{t('landing.from', { name: task.creator_name })}</Text>}
            <View className='lp-task-payout'>
              <Text className='lp-payout-num'>{payout}</Text>
              <Text className='lp-payout-label'>{t('landing.reward')}</Text>
            </View>
            {!!task.description && <Text className='lp-task-desc'>{task.description}</Text>}
          </View>
        ) : (
          <View className='lp-task placeholder'>
            <Text className='lp-task-loading'>{taskLoading ? t('landing.loadingTask') : ''}</Text>
          </View>
        )}

        {/* 登录 / 注册 */}
        <View className='lp-auth'>
          <Text className='lp-auth-title'>{task ? t('landing.loginToApply') : t('landing.join')}</Text>

          <View className='lp-tabs'>
            <Text
              className={`lp-tab ${authTab === 'login' ? 'active' : ''}`}
              onClick={() => this.setState({ authTab: 'login', err: '' })}
            >
              {t('profile.login')}
            </Text>
            <Text
              className={`lp-tab ${authTab === 'register' ? 'active' : ''}`}
              onClick={() => this.setState({ authTab: 'register', err: '' })}
            >
              {t('profile.register')}
            </Text>
          </View>

          <Text className='lp-err'>{err}</Text>

          <Input
            className='lp-input'
            type='text'
            placeholder={t('profile.emailAddr')}
            value={email}
            onInput={e => this.setState({ email: e.detail.value })}
          />
          {isReg && (
            <Input
              className='lp-input'
              type='text'
              placeholder={t('profile.nickname')}
              value={nick}
              onInput={e => this.setState({ nick: e.detail.value })}
            />
          )}
          <Input
            className='lp-input'
            password
            placeholder={t('profile.passwordMin')}
            value={pass}
            onInput={e => this.setState({ pass: e.detail.value })}
          />

          <View className={`lp-submit ${submitting ? 'disabled' : ''}`} onClick={submitting ? undefined : this.doAuth}>
            {submitting ? t('landing.processing') : authTab === 'login' ? t('landing.loginAndApply') : t('landing.registerAndApply')}
          </View>

          <Text className='lp-lang' onClick={this.switchLanguage}>
            🌐 {LOCALES.find(l => l.id === getLocale())?.label}
          </Text>
        </View>
      </View>
    );
  }
}
