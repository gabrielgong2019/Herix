import { Component } from 'react';
import { View, Text, Button, Textarea, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { tasks as taskApi, applications, submissions as subApi, referrals, ambassador, arbitrations, auth, ApiError, getToken, assetUrl } from '../../utils/api';
import { getAmbassadorProfile, invalidateProfileCache } from '../../utils/profileCache';
import { fmtLocal } from '../../utils/format';
import { checkRequirements, RequirementFailure } from '../../utils/requirements';
import { platformById } from '../../utils/platforms';
import RequirementsChecklist from '../../components/RequirementsChecklist';
import PlatformAccountInput, { PlatformAccountValue } from '../../components/PlatformAccountInput';
import './task.scss';
import { t } from '../../utils/i18n';
import BackBar from '../../components/BackBar';

interface TaskDetailData {
  id: string;
  title: string;
  cover_image?: string | null;
  description: string;
  requirements: string;
  platform_requirements?: string | null;
  budget: number;
  commission: number;
  payout_per_herald?: number; // 当前真实生效字段（到手报酬）；commission 是重构前废弃字段，仅老数据兜底
  max_heralds: number;
  mode: string;
  status: string;
  creator_name: string;
  creator_id: string;
  brand_logo_url?: string;
  brand_promo_image_url?: string;
  brand_company_name?: string;
  brand_company_desc?: string;
  approved_count?: number;
  code_mode?: string;
  data_mode?: string;
  avg_payout_days?: number | null;
  application_count: number;
  applications: any[];
  is_escrowed: number;
  _count: { applications: number; submissions: number };
  content_type?: string;
  min_images?: number | null;
  min_video_seconds?: number | null;
  max_revisions?: number;
  require_proposal?: number;
  submit_deadline?: string | null;
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
  /** 明细模式：我的邀请进度（脱敏行） */
  referralRecords: any[];
  applying: boolean;
  // 方案提交 sheet
  proposalSheetOpen: boolean;
  proposalText: string;
  proposalLinks: string[];
  proposalLinkInput: string;
  // 报名不满足资质要求时的补充账号弹窗
  showReqModal: boolean;
  reqFailures: RequirementFailure[];
  reqCanRetry: boolean;
  reqFormValues: Record<string, PlatformAccountValue>;
  reqSubmitting: boolean;
  // 仲裁申请（改稿额度用尽后）
  arbInput: boolean;
  arbReason: string;
  arbSubmitting: boolean;
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
    referralRecords: [],
    ambassadorProfile: null,
    applying: false,
    proposalSheetOpen: false,
    proposalText: '',
    proposalLinks: [],
    proposalLinkInput: '',
    showReqModal: false,
    reqFailures: [],
    reqCanRetry: false,
    reqFormValues: {},
    reqSubmitting: false,
    arbInput: false,
    arbReason: '',
    arbSubmitting: false,
  };

  componentDidMount() {
    this.loadTask();
  }

  componentDidShow() {
    // 用户从 profile 页更新粉丝数后返回时，重新拉取任务和资质数据，按钮状态自动刷新
    this.loadTask();
  }

  onShareAppMessage(): Taro.ShareAppMessageReturn {
    const { task } = this.state;
    return {
      title: task?.title ?? 'Herix 任务',
      path: task ? `/pages/landing/index?task=${task.id}` : '/pages/index/index',
      imageUrl: task?.cover_image || task?.brand_promo_image_url || '',
    };
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
                  // 明细模式任务：拉取邀请进度列表
                  if ((task as any).data_mode === 'DETAIL') {
                    try {
                      const recs = await referrals.myRecords(id);
                      this.setState({ referralRecords: recs || [] });
                    } catch {}
                  }
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
    if (this.state.task?.require_proposal) {
      this.setState({ proposalSheetOpen: true, proposalText: '', proposalLinks: [], proposalLinkInput: '' });
      return;
    }
    this.doApply();
  };

  doApply = async (proposalText?: string, proposalLinks?: string[]) => {
    if (!this.state.task) return;
    this.setState({ applying: true });
    try {
      await applications.apply(this.state.task.id, '', proposalText, proposalLinks);
      Taro.showToast({ title: t('task.applySuccess'), icon: 'success' });
      this.setState({ showReqModal: false, proposalSheetOpen: false });
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
      if (this.state.task?.require_proposal) {
        this.setState({ showReqModal: false, proposalSheetOpen: true, proposalText: '', proposalLinks: [], proposalLinkInput: '' });
      } else {
        await this.doApply();
      }
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('common.saveFailed'), icon: 'none' });
    } finally {
      this.setState({ reqSubmitting: false });
    }
  };

  submitMode: 'draft' | 'final' = 'final';
  goSubmit = (mode: 'draft' | 'final') => { this.submitMode = mode; this.handleSubmit(); };

  handleSubmit = () => {
    Taro.navigateTo({ url: `/pages/apply/apply?taskId=${this.state.task!.id}&mode=${this.submitMode}` });
  };

  copyCode = () => {
    Taro.setClipboardData({
      data: this.state.myAmbassadorTask?.unique_code || '',
      // weapp 端 setClipboardData 自带"内容已复制"提示,只在 H5 补 toast,避免双提示
      success: () => { if (process.env.TARO_ENV === 'h5') Taro.showToast({ title: t('common.copied'), icon: 'success' }); },
    });
  };

  submitProposal = () => {
    const { proposalText, proposalLinks } = this.state;
    if (!proposalText.trim()) {
      Taro.showToast({ title: t('task.proposalTextRequired'), icon: 'none' });
      return;
    }
    this.doApply(proposalText.trim(), proposalLinks);
  };

  addProposalLink = () => {
    const { proposalLinkInput, proposalLinks } = this.state;
    const link = proposalLinkInput.trim();
    if (!link) return;
    this.setState({ proposalLinks: [...proposalLinks, link], proposalLinkInput: '' });
  };

  removeProposalLink = (idx: number) => {
    this.setState(prev => ({ proposalLinks: prev.proposalLinks.filter((_, i) => i !== idx) }));
  };

  // ── 渲染 ──

  renderProposalSheet() {
    const { proposalSheetOpen, proposalText, proposalLinks, proposalLinkInput, applying } = this.state;
    if (!proposalSheetOpen) return null;

    return (
      <View className='req-modal-overlay'>
        <View className='req-modal-card'>
          <Text className='req-modal-title'>{t('task.proposalTitle')}</Text>
          <Text className='req-modal-sub'>{t('task.proposalTextPh')}</Text>

          <Textarea
            className='proposal-textarea'
            value={proposalText}
            placeholder={t('task.proposalTextPh')}
            onInput={(e: any) => this.setState({ proposalText: e.detail.value })}
          />

          <Text className='proposal-links-title'>{t('task.proposalLinksTitle')}</Text>
          {proposalLinks.map((link, idx) => (
            <View key={idx} className='proposal-link-row'>
              <Text className='proposal-link-text' numberOfLines={1}>{link}</Text>
              <Text className='proposal-link-del' onClick={() => this.removeProposalLink(idx)}>×</Text>
            </View>
          ))}
          <View className='proposal-link-input-row'>
            <Input
              className='proposal-link-input'
              value={proposalLinkInput}
              placeholder={t('task.proposalLinksPh')}
              onInput={(e: any) => this.setState({ proposalLinkInput: e.detail.value })}
            />
            <Text className='proposal-link-add' onClick={this.addProposalLink}>+</Text>
          </View>

          <Button className='btn-primary' loading={applying} onClick={this.submitProposal}>
            {t('task.submitProposal')}
          </Button>
          <Button className='btn-outline' onClick={() => this.setState({ proposalSheetOpen: false })}>
            {t('common.cancel')}
          </Button>
        </View>
      </View>
    );
  }

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

  submitArbitration = async () => {
    const { arbReason, mySubmission } = this.state;
    if (!arbReason.trim()) {
      Taro.showToast({ title: t('task.arbitrateReasonRequired'), icon: 'none' });
      return;
    }
    this.setState({ arbSubmitting: true });
    try {
      await arbitrations.open(mySubmission.id, arbReason.trim());
      Taro.showToast({ title: t('task.arbitrateDone'), icon: 'success' });
      this.setState({ arbInput: false, arbReason: '', arbSubmitting: false });
      this.loadTask();
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('common.opFailed'), icon: 'none' });
      this.setState({ arbSubmitting: false });
    }
  };

  /** 仲裁入口：被拒且商家拒绝额度已用尽时出现（额度约束的是商家——用尽后商家只能通过或仲裁，
   *  赫使若不认可最后一次拒绝也可从这里开案）。开案期间双向超时计时冻结 */
  renderArbEntry(sub: any) {
    const limit = sub.stage === 'DRAFT'
      ? (sub.max_revisions ?? 2)
      : (sub.require_draft_review ? 2 : (sub.max_revisions ?? 2));
    if ((sub.stage_rejects ?? 0) < limit) return null;
    if (sub.arbitration_open) {
      return <View className='status-banner banner-pending'>{t('task.arbitrationPending')}</View>;
    }
    const { arbInput, arbReason, arbSubmitting } = this.state;
    if (!arbInput) {
      return (
        <View className='arb-entry'>
          <Text className='banner-hint'>{t('task.arbitrateHint')}</Text>
          <Button className='btn-outline' onClick={() => this.setState({ arbInput: true })}>
            {t('task.arbitrate')}
          </Button>
        </View>
      );
    }
    return (
      <View className='arb-entry'>
        <Textarea
          className='textarea arb-reason'
          placeholder={t('task.arbitrateReasonPh')}
          value={arbReason}
          onInput={e => this.setState({ arbReason: e.detail.value })}
          maxlength={500}
        />
        <Button className='btn-primary' loading={arbSubmitting} disabled={arbSubmitting} onClick={this.submitArbitration}>
          {t('task.arbitrateSubmit')}
        </Button>
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
      // 名额已释放（被拒后超时未重提 / 仲裁判商家胜）
      if (myApplication.status === 'EXPIRED') {
        return (
          <View className='actions'>
            <View className='status-banner banner-rejected'>{t('task.slotReleased')}</View>
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
        const requireDraft = !!(task as any).require_draft_review;
        if (!mySubmission) {
          return (
            <View className='actions'>
              <Button className='btn-primary' onClick={() => this.goSubmit(requireDraft ? 'draft' : 'final')}>
                {requireDraft ? t('task.submitDraft') : t('task.submitWork')}
              </Button>
              <Text className='banner-hint'>{requireDraft ? t('task.draftFirstHint') : t('task.approvedHint')}</Text>
            </View>
          );
        }
        // 两阶段：stage=DRAFT 的三个状态（旧任务无 stage 字段视为 FINAL）
        if (mySubmission.stage === 'DRAFT') {
          if (mySubmission.status === 'PENDING_REVIEW') {
            return (
              <View className='actions'>
                <View className='status-banner banner-pending'>{t('task.draftPending')}</View>
              </View>
            );
          }
          if (mySubmission.status === 'REJECTED') {
            return (
              <View className='actions'>
                <View className='status-banner banner-rejected'>{t('task.draftRejected')}</View>
                {mySubmission.review_note && <Text className='banner-note'>{t('task.reason', { note: mySubmission.review_note })}</Text>}
                <Button className='btn-primary' onClick={() => this.goSubmit('draft')}>{t('task.resubmitDraft')}</Button>
                {this.renderArbEntry(mySubmission)}
              </View>
            );
          }
          // DRAFT + APPROVED = 草稿已过，待发布并提交终稿
          return (
            <View className='actions'>
              <View className='status-banner banner-success'>{t('task.draftApproved')}</View>
              <Text className='banner-hint'>{t('task.draftApprovedNext')}</Text>
              <Button className='btn-primary' onClick={() => this.goSubmit('final')}>{t('task.submitFinal')}</Button>
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
              <Button className='btn-primary' onClick={() => this.goSubmit('final')}>{t('task.resubmit')}</Button>
              {this.renderArbEntry(mySubmission)}
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
          <Text
            className='banner-hint banner-hint-link'
            onClick={() => Taro.switchTab({ url: '/pages/profile/profile' })}
          >{t('task.goUpdateFollowers')}</Text>
        </View>
      );
    }

    return null;
  }

  render() {
    const { task, loading, myAmbassadorTask, ambassadorProfile, referralRecords } = this.state;

    if (loading) {
      return <View className='loading'><Text>{t('common.loading')}</Text></View>;
    }

    if (!task) {
      return <View className='loading'><Text>{t('task.notExist')}</Text></View>;
    }

    const isPerformance = task.mode === 'PERFORMANCE';

    const approvedCount = task.approved_count || 0;
    const slotsTotal = task.max_heralds;
    const slotsLeft = slotsTotal - approvedCount;
    const fillPct = Math.min(100, Math.round((approvedCount / slotsTotal) * 100));

    return (
      <View className='task-detail'>
        <BackBar />

        {/* 任务封面图（2026-07-26 补：商家上传的 cover_image 此前只在商家端展示，赫使侧从未渲染） */}
        {task.cover_image && (
          <Image className='task-cover' src={assetUrl(task.cover_image)} mode='widthFix' />
        )}

        {/* 品牌卡 */}
        {(task.brand_logo_url || task.brand_company_name) && (
          <View className='brand-card'>
            {task.brand_logo_url
              ? <Image className='brand-logo' src={task.brand_logo_url} mode='aspectFill' />
              : <View className='brand-logo brand-logo-placeholder' />}
            <View className='brand-info'>
              <Text className='brand-name'>{task.brand_company_name || task.creator_name}</Text>
              {task.brand_company_desc
                ? <Text className='brand-desc' numberOfLines={2}>{task.brand_company_desc}</Text>
                : null}
            </View>
          </View>
        )}

        <View className='section'>
          <View className='tags'>
            <Text className='tag tag-mode'>{isPerformance ? t('task.modeReferral') : t('task.modeContent')}</Text>
            {!!task.is_escrowed && <Text className='tag tag-escrowed'>{t('task.instantPayout')}</Text>}
            <Text className={`tag status-${task.status.toLowerCase()}`}>
              {task.status === 'OPEN' ? t('task.recruiting') : task.status}
            </Text>
          </View>
          <Text className='title'>{task.title}</Text>
          <Text className='price'>
            {/* 赫使视角单价 = payout_per_herald（到手报酬）；commission 是重构前废弃字段，新任务恒 0，仅作老数据兜底 */}
            {isPerformance
              ? t('task.perConversion', { n: task.payout_per_herald ?? task.commission })
              : t('task.perPerson', { n: task.payout_per_herald ?? task.commission })}
          </Text>

          {/* 名额进度条 */}
          <View className='slots-bar-wrap'>
            <View className='slots-bar'>
              <View className='slots-fill' style={{ width: `${fillPct}%` }} />
            </View>
            <Text className='slots-text'>
              {slotsLeft > 0
                ? t('task.spotsProgress', { used: approvedCount, total: slotsTotal })
                : t('task.slotsNone')}
            </Text>
          </View>

          {task.avg_payout_days != null && task.avg_payout_days > 0 && (
            <Text className='avg-pay-days'>{t('task.avgPayDays', { n: task.avg_payout_days })}</Text>
          )}
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

        {/* 邀请码说明（PERFORMANCE 专属） */}
        {isPerformance && (
          <View className='section'>
            <Text className='section-title'>{t('task.referralSection')}</Text>
            <Text className='content'>
              {task.code_mode === 'custom' ? t('task.codeCustom') : t('task.codeAuto')}
            </Text>
            <View className='spec-grid' style={{ marginTop: 8 }}>
              <View className='spec-row'>
                <Text className='spec-label'>{t('task.dataModeLabel')}</Text>
                <Text className='spec-value'>
                  {task.data_mode === 'DETAIL' ? t('task.dataModeDetail') : t('task.dataModeAgg')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* 内容规格 */}
        {(task.content_type || task.min_images || task.min_video_seconds || task.max_revisions || task.require_proposal || task.submit_deadline) && (
          <View className='section'>
            <Text className='section-title'>{t('task.specsTitle')}</Text>
            <View className='spec-grid'>
              {task.content_type && task.content_type !== 'referral' && (
                <View className='spec-row'>
                  <Text className='spec-label'>{t('task.contentTypeLabel')}</Text>
                  <Text className='spec-value'>{t(`task.contentType${task.content_type.charAt(0).toUpperCase() + task.content_type.slice(1)}`)}</Text>
                </View>
              )}
              {task.min_images != null && (
                <View className='spec-row'>
                  <Text className='spec-label'>{t('task.minImages')}</Text>
                  <Text className='spec-value'>{task.min_images}</Text>
                </View>
              )}
              {task.min_video_seconds != null && (
                <View className='spec-row'>
                  <Text className='spec-label'>{t('task.minVideoSecs')}</Text>
                  <Text className='spec-value'>{task.min_video_seconds}s</Text>
                </View>
              )}
              {task.max_revisions != null && (
                <View className='spec-row'>
                  <Text className='spec-label'>{t('task.maxRevisions')}</Text>
                  <Text className='spec-value'>{task.max_revisions}</Text>
                </View>
              )}
              {task.submit_deadline && (
                <View className='spec-row'>
                  <Text className='spec-label'>{t('task.submitDeadline')}</Text>
                  <Text className='spec-value'>{task.submit_deadline.slice(0, 10)}</Text>
                </View>
              )}
            </View>
            {!!task.require_proposal && (
              <View className='proposal-badge'>
                <Text className='proposal-badge-text'>{t('task.requireProposal')}</Text>
              </View>
            )}
          </View>
        )}

        {this.isHerald() && (
          <View className='section'>
            <RequirementsChecklist task={task} ambassadorProfile={ambassadorProfile} />
          </View>
        )}

        {task.applications.length > 0 && (
          <View className='section'>
            <Text className='section-title'>{t('task.applicantsTitle', { n: task.applications.length })}</Text>
            <View className='approved-bubbles'>
              {task.applications.map((app: any) => (
                <View key={app.id} className='approved-bubble'>
                  {app.avatar_url
                    ? <Image className='bubble-avatar' src={app.avatar_url} />
                    : <View className='bubble-initial'><Text className='bubble-initial-text'>{(app.nickname || '?')[0]}</Text></View>
                  }
                  <Text className='bubble-name'>{app.nickname}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {myAmbassadorTask && (
          <View className='section code-section'>
            <Text className='section-title'>{t('task.myCode')}</Text>
            <View className='code-box'>
              <Text className='code-text'>{myAmbassadorTask.unique_code}</Text>
              <Text className='code-copy' onClick={this.copyCode}>{t('hd.copy')}</Text>
            </View>
            <Text className='code-hint'>{t('task.codeHint')}</Text>

            {/* 明细模式：邀请进度（脱敏标识，平台不存原文） */}
            {(task as any).data_mode === 'DETAIL' && (
              <View className='referral-progress'>
                <Text className='rp-title'>{t('referral.progressTitle')}</Text>
                {referralRecords.length === 0 ? (
                  <Text className='rp-empty'>{t('referral.empty')}</Text>
                ) : (
                  referralRecords.map((r: any, idx: number) => (
                    <View key={r.id || idx} className='rp-row'>
                      <Text className='rp-user'>{r.user_masked || `#${idx + 1}`}</Text>
                      <Text className='rp-date'>{fmtLocal(r.registered_at).slice(0, 10)}</Text>
                      <Text
                        className='rp-status'
                        style={{
                          color: r.settled ? '#16a34a' : r.converted_at ? '#d97706' : 'var(--text-muted)',
                        }}
                      >
                        {r.settled ? t('referral.settled') : r.converted_at ? t('referral.converted') : t('referral.registered')}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        )}

        {this.renderActionBar()}
        {this.renderReqModal()}
        {this.renderProposalSheet()}
      </View>
    );
  }
}
