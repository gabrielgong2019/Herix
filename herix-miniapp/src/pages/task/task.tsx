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
import { t } from '../../utils/i18n';

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
      Taro.showToast({ title: err.message || t('task.loadFailed'), icon: 'none' });
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
      Taro.showToast({ title: t('task.applySuccess'), icon: 'success' });
      this.setState({ showReqModal: false });
      this.loadTask();
    } catch (err: any) {
      if (err instanceof ApiError && err.data?.code === 'REQUIREMENTS_NOT_MET') {
        this.openReqModal(err.data.failures || [], !!err.data.canRetry);
      } else {
        Taro.showToast({ title: err.message || t('task.applyFailed'), icon: 'none' });
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
        Taro.showToast({ title: t('task.fillAccount', { name: platformById(pid).name }), icon: 'none' });
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
      Taro.showToast({ title: err.message || t('common.saveFailed'), icon: 'none' });
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
          <Text className='req-modal-title'>{t('task.reqModalTitle')}</Text>
          <Text className='req-modal-sub'>{t('task.reqModalSub')}</Text>

          {reqFailures.map(f => {
            const p = platformById(f.platformId);
            if (f.type === 'INSUFFICIENT') {
              return (
                <View key={f.platformId} className='req-fail-row req-fail-hard'>
                  <Text className='req-fail-icon'>{p.icon}</Text>
                  <View>
                    <Text className='req-fail-name req-fail-name-hard'>{t('task.reqInsufficientName', { name: p.name })}</Text>
                    <Text className='req-fail-desc req-fail-desc-hard'>
                      {t('task.reqInsufficientDesc', { c: f.current.toLocaleString(), r: f.required.toLocaleString() })}
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
              {t('task.saveAndApply')}
            </Button>
          ) : null}
          <Button className='btn-outline' onClick={this.closeReqModal}>
            {t('common.cancel')}
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
            {t('task.loginToApply')}
          </Button>
        </View>
      );
    }

    if (myApplication) {
      if (myApplication.status === 'PENDING') {
        return (
          <View className='actions'>
            <View className='status-banner banner-pending'>{t('task.pendingReview')}</View>
          </View>
        );
      }
      if (myApplication.status === 'REJECTED') {
        return (
          <View className='actions'>
            <View className='status-banner banner-rejected'>{t('task.applyRejected')}</View>
            {myApplication.review_note && <Text className='banner-note'>{t('task.reason', { note: myApplication.review_note })}</Text>}
          </View>
        );
      }
      if (myApplication.status === 'APPROVED') {
        if (task.mode === 'PERFORMANCE') {
          return (
            <View className='actions'>
              <View className='status-banner banner-success'>{t('task.joinedPromoting')}</View>
            </View>
          );
        }
        if (!mySubmission) {
          return (
            <View className='actions'>
              <Button className='btn-primary' onClick={this.handleSubmit}>{t('task.submitWork')}</Button>
              <Text className='banner-hint'>{t('task.approvedHint')}</Text>
            </View>
          );
        }
        if (mySubmission.status === 'PENDING_REVIEW') {
          return (
            <View className='actions'>
              <View className='status-banner banner-pending'>{t('task.workPending')}</View>
            </View>
          );
        }
        if (mySubmission.status === 'APPROVED') {
          return (
            <View className='actions'>
              <View className='status-banner banner-success'>{t('task.done')}</View>
            </View>
          );
        }
        if (mySubmission.status === 'REJECTED') {
          return (
            <View className='actions'>
              <View className='status-banner banner-rejected'>{t('task.workRejected')}</View>
              {mySubmission.review_note && <Text className='banner-note'>{t('task.reason', { note: mySubmission.review_note })}</Text>}
              <Button className='btn-primary' onClick={this.handleSubmit}>{t('task.resubmit')}</Button>
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
              {t('task.applyNow')}
            </Button>
          </View>
        );
      }
      if (check.status === 'missing') {
        return (
          <View className='actions'>
            <Button className='btn-primary' onClick={this.handleMissingClick}>{t('task.addAndApply')}</Button>
            <Text className='banner-hint'>{t('task.addHint')}</Text>
          </View>
        );
      }
      return (
        <View className='actions'>
          <Button className='btn-disabled' disabled>{t('task.notEligible')}</Button>
          <Text className='banner-hint banner-hint-error'>{t('task.notEligibleHint')}</Text>
        </View>
      );
    }

    return null;
  }

  render() {
    const { task, loading, myAmbassadorTask, ambassadorProfile } = this.state;

    if (loading) {
      return <View className='loading'><Text>{t('common.loading')}</Text></View>;
    }

    if (!task) {
      return <View className='loading'><Text>{t('task.notExist')}</Text></View>;
    }

    const isPerformance = task.mode === 'PERFORMANCE';

    return (
      <View className='task-detail'>
        <View className='section'>
          <Text className='title'>{task.title}</Text>
          <View className='tags'>
            <Text className='tag'>{isPerformance ? t('taskCard.perf') : t('task.modeStd')}</Text>
            <Text className={`tag status-${task.status.toLowerCase()}`}>
              {task.status === 'OPEN' ? t('task.recruiting') : task.status}
            </Text>
          </View>
          <Text className='price'>
            {isPerformance ? t('task.perConversion', { n: task.commission }) : t('task.perPerson', { n: task.commission })}
          </Text>
          <Text className='meta'>{t('task.budgetMeta', { b: task.budget, n: task.max_heralds })}</Text>
        </View>

        <View className='section'>
          <Text className='section-title'>{t('task.descTitle')}</Text>
          <Text className='content'>{task.description}</Text>
        </View>

        {task.requirements && (
          <View className='section'>
            <Text className='section-title'>{t('task.reqSectionTitle')}</Text>
            <Text className='content'>{task.requirements}</Text>
          </View>
        )}

        {this.isHerald() && (
          <View className='section'>
            <RequirementsChecklist task={task} ambassadorProfile={ambassadorProfile} />
          </View>
        )}

        <View className='section'>
          <Text className='section-title'>{t('task.applicantsTitle', { n: task.applications.length })}</Text>
          {task.applications.map((app: any) => (
            <View key={app.id} className='applicant'>
              <Text className='name'>{app.nickname}</Text>
              <Text className={`app-status ${app.status.toLowerCase()}`}>
                {app.status === 'PENDING' ? t('task.stPending') : app.status === 'APPROVED' ? t('task.stApproved') : t('task.stRejected')}
              </Text>
            </View>
          ))}
          {task.applications.length === 0 && <Text className='muted'>{t('task.noApplicants')}</Text>}
        </View>

        {myAmbassadorTask && (
          <View className='section code-section'>
            <Text className='section-title'>{t('task.myCode')}</Text>
            <View className='code-box'>
              <Text className='code-text'>{myAmbassadorTask.unique_code}</Text>
            </View>
            <Text className='code-hint'>{t('task.codeHint')}</Text>
          </View>
        )}

        {this.renderActionBar()}
        {this.renderReqModal()}
      </View>
    );
  }
}
