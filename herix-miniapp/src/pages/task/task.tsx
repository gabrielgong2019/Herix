import { Component } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { tasks as taskApi, applications, submissions as subApi, referrals, ambassador, auth, ApiError, getToken } from '../../utils/api';
import { getAmbassadorProfile, invalidateProfileCache } from '../../utils/profileCache';
import { checkRequirements, RequirementFailure } from '../../utils/requirements';
import { platformById } from '../../utils/platforms';
import RequirementsChecklist from '../../components/RequirementsChecklist';
import PlatformAccountInput, { PlatformAccountValue } from '../../components/PlatformAccountInput';
import './task.scss';

interface TaskDetailData {
  id: string;
  title: string;
  description: string;
  requirements: string;
  platform_requirements?: string | null;
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
  task: TaskDetailData | null;
  loading: boolean;
  role: string | null;
  userId: string | null;
  myApplication: any;
  mySubmission: any;
  myAmbassadorTask: any;
  ambassadorProfile: any;
  applying: boolean;
  // 报名不满足资质要求时的补充账号弹窗
  showReqModal: boolean;
  reqFailures: RequirementFailure[];
  reqCanRetry: boolean;
  reqFormValues: Record<string, PlatformAccountValue>;
  reqSubmitting: boolean;
}

export default class TaskDetail extends Component<{ id: string }, State> {
  state: State = {
    task: null,
    loading: true,
    role: null,
    userId: null,
    myApplication: null,
    mySubmission: null,
    myAmbassadorTask: null,
    ambassadorProfile: null,
    applying: false,
    showReqModal: false,
    reqFailures: [],
    reqCanRetry: false,
    reqFormValues: {},
    reqSubmitting: false,
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

      try {
        if (getToken()) {
          // 角色/身份信息以后端 /auth/me 为准，不信任本地缓存（缓存可能缺失或过期，
          // 曾导致报名成功后本页判断不到"已报名"，一直显示可以继续报名）
          const userData = await auth.me();
          this.setState({ role: userData.role, userId: userData.id });

          if (userData.role === 'HERALD') {
            const [myApps, mySubs, profile] = await Promise.all([
              applications.my(),
              subApi.my(),
              getAmbassadorProfile(),
            ]);

            const myApp = myApps.find((a: any) => a.task_id === id);
            const mySub = mySubs.find((s: any) => s.task_id === id);
            this.setState({
              myApplication: myApp || null,
              mySubmission: mySub || null,
              ambassadorProfile: profile,
            });

            // 成果报酬类：审核通过后自动发码，查一下是否已有码
            if (task.mode === 'PERFORMANCE') {
              try {
                const myCodes = await referrals.myCodes();
                const myTaskCodes = (myCodes || []).filter((c: any) => c.task_id === id);
                if (myTaskCodes.length > 0) {
                  this.setState({ myAmbassadorTask: myTaskCodes[0] });
                }
              } catch {}
            }
          }
        }
      } catch {}
    } catch (err: any) {
      Taro.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setState({ loading: false });
    }
  };

  isHerald() {
    return this.state.role === 'HERALD';
  }

  // ── 报名 ──

  handleApplyClick = () => {
    if (!getToken()) {
      // /pages/profile/profile 是 tabBar 页面，只能用 switchTab 跳转，navigateTo 会报错
      Taro.switchTab({ url: '/pages/profile/profile' });
      return;
    }
    this.doApply();
  };

  doApply = async () => {
    if (!this.state.task) return;
    this.setState({ applying: true });
    try {
      await applications.apply(this.state.task.id, '');
      Taro.showToast({ title: '报名成功', icon: 'success' });
      this.setState({ showReqModal: false });
      this.loadTask();
    } catch (err: any) {
      if (err instanceof ApiError && err.data?.code === 'REQUIREMENTS_NOT_MET') {
        this.openReqModal(err.data.failures || [], !!err.data.canRetry);
      } else {
        Taro.showToast({ title: err.message || '报名失败', icon: 'none' });
      }
    } finally {
      this.setState({ applying: false });
    }
  };

  // 客户端预检发现缺账号时，点"补充账号后报名"直接开弹窗，不用先打一次接口
  handleMissingClick = () => {
    const { task, ambassadorProfile } = this.state;
    const check = checkRequirements(task, ambassadorProfile);
    this.openReqModal(check.failures, check.status === 'missing');
  };

  openReqModal(failures: RequirementFailure[], canRetry: boolean) {
    const reqFormValues: Record<string, PlatformAccountValue> = {};
    for (const f of failures) {
      if (f.type === 'MISSING') {
        reqFormValues[f.platformId] = { platformId: f.platformId, accountId: null, url: null, followers: null };
      }
    }
    this.setState({ showReqModal: true, reqFailures: failures, reqCanRetry: canRetry, reqFormValues });
  }

  closeReqModal = () => {
    this.setState({ showReqModal: false });
  };

  handleReqFieldChange = (platformId: string, value: PlatformAccountValue) => {
    this.setState(prev => ({ reqFormValues: { ...prev.reqFormValues, [platformId]: value } }));
  };

  submitReqModal = async () => {
    const { reqFailures, reqFormValues, ambassadorProfile } = this.state;
    const missingIds = reqFailures.filter(f => f.type === 'MISSING').map(f => f.platformId);

    for (const pid of missingIds) {
      const val = reqFormValues[pid];
      const filled = val && (val.accountId || val.url);
      if (!filled) {
        Taro.showToast({ title: `请填写 ${platformById(pid).name} 账号`, icon: 'none' });
        return;
      }
    }

    this.setState({ reqSubmitting: true });
    try {
      let existing: any[] = [];
      try {
        existing = ambassadorProfile?.social_platforms ? JSON.parse(ambassadorProfile.social_platforms) : [];
      } catch {}
      const toAdd = missingIds.map(pid => reqFormValues[pid]);
      const merged = existing.filter((s: any) => !missingIds.includes(s.platformId)).concat(toAdd);

      const updated = await ambassador.updateProfile({ socialPlatforms: merged });
      invalidateProfileCache();
      this.setState({ ambassadorProfile: updated });
      await this.doApply();
    } catch (err: any) {
      Taro.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setState({ reqSubmitting: false });
    }
  };

  handleSubmit = () => {
    Taro.navigateTo({ url: `/pages/apply/apply?taskId=${this.state.task!.id}` });
  };

  // ── 渲染 ──

  renderReqModal() {
    const { showReqModal, reqFailures, reqCanRetry, reqFormValues, reqSubmitting } = this.state;
    if (!showReqModal) return null;

    const hasMissing = reqFailures.some(f => f.type === 'MISSING');

    return (
      <View className='req-modal-overlay'>
        <View className='req-modal-card'>
          <Text className='req-modal-title'>不满足报名条件</Text>
          <Text className='req-modal-sub'>请查看以下问题</Text>

          {reqFailures.map(f => {
            const p = platformById(f.platformId);
            if (f.type === 'INSUFFICIENT') {
              return (
                <View key={f.platformId} className='req-fail-row req-fail-hard'>
                  <Text className='req-fail-icon'>{p.icon}</Text>
                  <View>
                    <Text className='req-fail-name req-fail-name-hard'>{p.name} 粉丝数不足</Text>
                    <Text className='req-fail-desc req-fail-desc-hard'>
                      当前 {f.current.toLocaleString()} · 要求 {f.required.toLocaleString()}+ 粉
                    </Text>
                  </View>
                </View>
              );
            }
            return (
              <View key={f.platformId} className='req-fail-row req-fail-soft'>
                <PlatformAccountInput
                  platformId={f.platformId}
                  existingValue={reqFormValues[f.platformId]}
                  onChange={val => this.handleReqFieldChange(f.platformId, val)}
                />
              </View>
            );
          })}

          {reqCanRetry && hasMissing ? (
            <Button className='btn-primary' loading={reqSubmitting} onClick={this.submitReqModal}>
              保存并报名
            </Button>
          ) : null}
          <Button className='btn-outline' onClick={this.closeReqModal}>
            取消
          </Button>
        </View>
      </View>
    );
  }

  renderActionBar() {
    const { task, myApplication, mySubmission, role, ambassadorProfile, applying } = this.state;
    if (!task) return null;

    const isHerald = this.isHerald();
    const loggedIn = !!getToken();

    if (!loggedIn && task.status === 'OPEN') {
      return (
        <View className='actions'>
          <Button className='btn-primary' onClick={this.handleApplyClick}>
            登录后报名
          </Button>
        </View>
      );
    }

    if (myApplication) {
      if (myApplication.status === 'PENDING') {
        return (
          <View className='actions'>
            <View className='status-banner banner-pending'>⏳ 已报名，等待品牌审核</View>
          </View>
        );
      }
      if (myApplication.status === 'REJECTED') {
        return (
          <View className='actions'>
            <View className='status-banner banner-rejected'>❌ 报名未通过</View>
            {myApplication.review_note && <Text className='banner-note'>原因：{myApplication.review_note}</Text>}
          </View>
        );
      }
      if (myApplication.status === 'APPROVED') {
        if (task.mode === 'PERFORMANCE') {
          return (
            <View className='actions'>
              <View className='status-banner banner-success'>✅ 已加入任务，推广中</View>
            </View>
          );
        }
        if (!mySubmission) {
          return (
            <View className='actions'>
              <Button className='btn-primary' onClick={this.handleSubmit}>提交作品</Button>
              <Text className='banner-hint'>报名已通过，请提交内容链接</Text>
            </View>
          );
        }
        if (mySubmission.status === 'PENDING_REVIEW') {
          return (
            <View className='actions'>
              <View className='status-banner banner-pending'>⏳ 作品已提交，等待品牌审核</View>
            </View>
          );
        }
        if (mySubmission.status === 'APPROVED') {
          return (
            <View className='actions'>
              <View className='status-banner banner-success'>✅ 任务完成，报酬已结算</View>
            </View>
          );
        }
        if (mySubmission.status === 'REJECTED') {
          return (
            <View className='actions'>
              <View className='status-banner banner-rejected'>❌ 内容审核未通过</View>
              {mySubmission.review_note && <Text className='banner-note'>原因：{mySubmission.review_note}</Text>}
              <Button className='btn-primary' onClick={this.handleSubmit}>重新提交</Button>
            </View>
          );
        }
      }
      return null;
    }

    const canApply = isHerald && task.status === 'OPEN';
    if (canApply) {
      const check = checkRequirements(task, ambassadorProfile);
      if (check.status === 'ok') {
        return (
          <View className='actions'>
            <Button className='btn-primary' loading={applying} onClick={this.handleApplyClick}>
              立即报名
            </Button>
          </View>
        );
      }
      if (check.status === 'missing') {
        return (
          <View className='actions'>
            <Button className='btn-primary' onClick={this.handleMissingClick}>补充账号后报名</Button>
            <Text className='banner-hint'>添加以上账号即可报名</Text>
          </View>
        );
      }
      return (
        <View className='actions'>
          <Button className='btn-disabled' disabled>不满足粉丝要求</Button>
          <Text className='banner-hint banner-hint-error'>粉丝数不足，暂时无法报名此任务</Text>
        </View>
      );
    }

    return null;
  }

  render() {
    const { task, loading, myAmbassadorTask, ambassadorProfile } = this.state;

    if (loading) {
      return <View className='loading'><Text>加载中...</Text></View>;
    }

    if (!task) {
      return <View className='loading'><Text>任务不存在</Text></View>;
    }

    const isPerformance = task.mode === 'PERFORMANCE';

    return (
      <View className='task-detail'>
        <View className='section'>
          <Text className='title'>{task.title}</Text>
          <View className='tags'>
            <Text className='tag'>{isPerformance ? '成果报酬' : '普通任务'}</Text>
            <Text className={`tag status-${task.status.toLowerCase()}`}>
              {task.status === 'OPEN' ? '招募中' : task.status}
            </Text>
          </View>
          <Text className='price'>
            {isPerformance ? `¥${task.commission}/成功转化` : `¥${task.commission}/人`}
          </Text>
          <Text className='meta'>预算：¥{task.budget} · 招募 {task.max_heralds} 人</Text>
        </View>

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

        {this.isHerald() && (
          <View className='section'>
            <RequirementsChecklist task={task} ambassadorProfile={ambassadorProfile} />
          </View>
        )}

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
          {task.applications.length === 0 && <Text className='muted'>暂无报名</Text>}
        </View>

        {myAmbassadorTask && (
          <View className='section code-section'>
            <Text className='section-title'>我的推广码</Text>
            <View className='code-box'>
              <Text className='code-text'>{myAmbassadorTask.unique_code}</Text>
            </View>
            <Text className='code-hint'>分享此推广码给好友，好友注册后即可获得奖励</Text>
          </View>
        )}

        {this.renderActionBar()}
        {this.renderReqModal()}
      </View>
    );
  }
}
