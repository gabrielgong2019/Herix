import { Component } from 'react';
import { View, Text, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, applications, referrals, getToken } from '../../utils/api';
import './index.scss';
import { t } from '../../utils/i18n';
import { fmt } from '../../utils/format';


// 存 labelKey，渲染时 t() 取值
const HISTORY_FILTERS = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'pending', labelKey: 'task.stPending' },
  { id: 'done', labelKey: 'hd.done' },
];

interface RightPill {
  type: 'button' | 'badge';
  text: string;
  color: string;
  bg: string;
  onClick?: () => void;
}

interface State {
  loading: boolean;
  loggedIn: boolean;
  balance: any;
  actions: any[];
  actionHistory: any[];
  myCodes: any[];
  filter: string;
  shareModal: { code: string; taskId: string; intro: string; benefit: string } | null;
  shareSaving: boolean;
}

export default class HeraldDashboard extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    balance: {},
    actions: [],
    actionHistory: [],
    myCodes: [],
    filter: 'all',
    shareModal: null,
    shareSaving: false,
  };

  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  componentWillUnmount() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
  }

  componentDidShow() {
    if (!getToken()) {
      this.setState({ loggedIn: false, loading: false });
      return;
    }
    this.setState({ loggedIn: true });
    this.loadAll();
  }

  loadAll = async () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = now.toISOString();
    const [bal, actionRes, codes] = await Promise.all([
      walletApi.balance({ from, to }).catch(() => ({})),
      applications.actions().catch(() => ({ actions: [], history: [] })),
      referrals.myCodes().catch(() => []),
    ]);
    this.setState({
      balance: bal || {},
      actions: actionRes.actions || [],
      actionHistory: actionRes.history || [],
      myCodes: codes || [],
      loading: false,
    });
  };

  goWallet = () => Taro.navigateTo({ url: '/pages/wallet/index' });
  openSubmit = (taskId: string, mode?: 'draft' | 'final') => Taro.navigateTo({ url: `/pages/apply/apply?taskId=${taskId}${mode ? `&mode=${mode}` : ''}` });

  copyCode = (code: string) => {
    Taro.setClipboardData({
      data: code,
      success: () => { if (process.env.TARO_ENV === 'h5') Taro.showToast({ title: t('common.copied'), icon: 'success' }); },
    });
  };

  openShareModal = (codeObj: any) => {
    // 优先级：赫使自定义文案 > 商家建议话术 > 空（赫使自行填写）
    const intro = codeObj.share_intro || codeObj.referral_script || '';
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.setState({
      shareSaving: false,
      shareModal: {
        code: codeObj.unique_code || '',
        taskId: codeObj.task_id || '',
        intro,
        benefit: codeObj.invitee_benefit || '',
      },
    });
  };

  closeShareModal = () => {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.setState({ shareModal: null, shareSaving: false });
  };

  onShareIntroChange = (val: string) => {
    const { shareModal, myCodes } = this.state;
    if (!shareModal) return;
    // Taro H5 Textarea 挂载时会用初始值触发一次 onInput，跳过（值没有变化）
    if (val === shareModal.intro) return;
    this.setState({ shareModal: { ...shareModal, intro: val }, shareSaving: true });
    if (this._saveTimer) clearTimeout(this._saveTimer);
    const codeObj = myCodes.find((c: any) => c.unique_code === shareModal.code);
    if (!codeObj) { this.setState({ shareSaving: false }); return; }
    this._saveTimer = setTimeout(() => {
      this.saveShareIntro(codeObj.id, val)
        .catch(() => Taro.showToast({ title: t('hd.shareSaveFailed'), icon: 'none' }))
        .finally(() => { this._saveTimer = null; this.setState({ shareSaving: false }); });
    }, 500);
  };

  saveShareIntro = async (codeId: string, intro: string) => {
    await referrals.patchShareIntro(codeId, intro || null);
    // 用 functional setState，避免用 await 前的旧快照覆盖飞行途中的其他改动
    this.setState(prev => ({
      myCodes: prev.myCodes.map((c: any) =>
        c.id === codeId ? { ...c, share_intro: intro || null } : c
      ),
    }));
  };

  copyShareLink = (code: string) => {
    const { shareModal } = this.state;
    const url = `https://herix.huaxuex.com/invite/${code}`;
    // 分享文案：自定义邀请语/福利/邀请码/链接拼装，复制给被邀请用户直接用
    const intro = (shareModal?.intro || '').trim();
    const benefit = (shareModal?.benefit || '').trim();
    const lines = [
      intro,
      benefit,
      `${t('hd.shareCodeLabel')}${code}`,
      url,
    ].filter(Boolean);
    Taro.setClipboardData({
      data: lines.join('\n'),
      success: () => Taro.showToast({ title: t('hd.shareTextCopied'), icon: 'success' }),
    });
  };


  // 通用待办卡（等价 herix taskCardHTML）
  renderTaskCard(key: string, opts: {
    title: string;
    accent: string;
    meta?: string;
    metaColor?: string;
    note?: string;
    right?: RightPill;
    body?: any;
  }) {
    return (
      // 类名带 hd- 前缀：Taro H5 所有页面样式全局生效，裸 .task-card 会污染首页 TaskCard 组件
      <View key={key} className='hd-card' style={{ borderLeftColor: opts.accent }}>
        <View className='tc-row'>
          <View className='tc-main'>
            <Text className='tc-title'>{opts.title}</Text>
            {opts.meta && (
              <Text className='tc-meta' style={{ color: opts.metaColor || opts.accent }}>
                {opts.meta}
              </Text>
            )}
            {opts.note && <Text className='tc-note'>{opts.note}</Text>}
          </View>
          {opts.right && (
            <Text
              className='tc-pill'
              style={{ color: opts.right.color, background: opts.right.bg }}
              onClick={opts.right.type === 'button' ? opts.right.onClick : undefined}
            >
              {opts.right.text}
            </Text>
          )}
        </View>
        {opts.body}
      </View>
    );
  }

  render() {
    const { loading, loggedIn, balance: bal, actions, actionHistory, myCodes, filter, shareModal, shareSaving } = this.state;

    if (!loggedIn) {
      return (
        <View className='herald-dashboard-page'>
          <View className='empty-state'>
            <Text className='empty-text'>{t('hd.needLogin')}</Text>
          </View>
        </View>
      );
    }
    if (loading) {
      return (
        <View className='herald-dashboard-page'>
          <View className='empty-state'>
            <Text className='empty-text'>{t('common.loading')}</Text>
          </View>
        </View>
      );
    }

    // ── 收支摘要 ──
    const balCur = bal.displayCurrency || 'JPY';
    const balCurrencies = (bal.balances || []).filter(
      (b: any) => Number(b.available || 0) !== 0 || Number(b.frozen || 0) !== 0,
    );
    const balApprox = balCurrencies.length > 1;

    // ── 待办/历史状态由服务端 /applications/actions 权威计算（2026-08-06），前端只分组渲染 ──
    const rejectedA = actions.filter(a => a.kind === 'RESUBMIT');
    const draftApprovedA = actions.filter(a => a.kind === 'DRAFT_APPROVED');
    const freshA = actions.filter(a => a.kind === 'FRESH');
    const pendingReviewA = actions.filter(a => a.kind === 'CONTENT_REVIEW');
    const actionableB = actions.filter(a => a.kind === 'PROMOTING');
    const hasAction = rejectedA.length > 0 || freshA.length > 0 || draftApprovedA.length > 0;
    const hasInProgress = pendingReviewA.length > 0 || actionableB.length > 0;

    // ── 报名历史过滤（display_status 服务端算好）──
    let filteredApps = actionHistory;
    if (filter === 'pending') filteredApps = actionHistory.filter(a => a.status === 'PENDING');
    if (filter === 'done') filteredApps = actionHistory.filter(a => a.display_status === 'DONE');

    const statusChip = (ra: any): [string, string] => {
      const stMap: Record<string, [string, string]> = {
        PENDING: [t('task.stPending'), '#d97706'],
        APPROVED: [t('task.stApproved'), '#16a34a'],
        REJECTED: [t('hd.stRejected'), '#dc2626'],
        WITHDRAWN: [t('hd.stWithdrawn'), '#6b7280'],
        EXPIRED: [t('task.slotReleased'), '#6b7280'],
        DONE: [t('hd.done'), '#6366f1'],
        NEED_FINAL: [t('hd.stNeedFinal'), '#0369a1'],
        CONTENT_REVIEW: [t('hd.stContentReview'), '#0369a1'],
        RESUBMIT: [t('hd.stResubmit'), '#dc2626'],
      };
      return stMap[ra.display_status] || ['', '#666'];
    };

    return (
      <View className='herald-dashboard-page'>
        {/* 收支摘要 */}
        <View className='summary' onClick={this.goWallet}>
          <View className='sum-cell'>
            <Text className='sum-label'>{t('wallet.balance.available')}</Text>
            <Text className='sum-val'>
              {balApprox ? '≈' : ''}¥{fmt(bal.available)} <Text className='sum-cur'>{balCur}</Text>
            </Text>
          </View>
          <View className='sum-cell'>
            <Text className='sum-label'>{t('profile.monthIncome')}</Text>
            <Text className='sum-val income'>
              +¥{fmt(bal.periodInflow)} <Text className='sum-cur'>{balCur}</Text>
            </Text>
          </View>
        </View>

        {/* 待办任务 */}
        {(hasAction || hasInProgress) && (
          <View className='block'>
            <Text className='block-title'>{t('hd.todo')}</Text>

            {hasAction && (
              <View>
                {hasInProgress && <Text className='sub-label'>{t('hd.actionNeeded')}</Text>}
                {rejectedA.map(ra => {
                  const isDraftStage = ra.submit_mode === 'draft';
                  const rMode: 'draft' | 'final' = ra.submit_mode || 'final';
                  return this.renderTaskCard(`rej-${ra.task_id}`, {
                    title: ra.task_title,
                    accent: '#dc2626',
                    meta: isDraftStage ? t('hd.draftRejectedMeta') : t('hd.rejectedMeta'),
                    metaColor: '#dc2626',
                    note: [
                      ra.require_draft_review ? t('hd.stepLabel', { step: isDraftStage ? 1 : 3 }) : '',
                      ra.review_note ? t('task.reason', { note: ra.review_note }) : '',
                    ].filter(Boolean).join(' · '),
                    right: { type: 'button', text: t('task.resubmit'), color: '#fff', bg: '#dc2626', onClick: () => this.openSubmit(ra.task_id, rMode) },
                  });
                })}
                {draftApprovedA.map(aa =>
                  this.renderTaskCard(`draftok-${aa.task_id}`, {
                    title: aa.task_title,
                    accent: 'var(--primary)',
                    meta: t('hd.contentTaskMeta', { n: fmt(aa.payout_per_herald || aa.commission || 0) }),
                    metaColor: 'var(--text-muted)',
                    note: `${t('hd.stepLabel', { step: 2 })} · ${t('hd.draftApprovedMeta')}`,
                    right: { type: 'button', text: t('hd.submitFinalBtn'), color: '#fff', bg: 'var(--primary)', onClick: () => this.openSubmit(aa.task_id, 'final') },
                  }),
                )}
                {freshA.map(aa =>
                  this.renderTaskCard(`fresh-${aa.task_id}`, {
                    title: aa.task_title,
                    accent: 'var(--primary)',
                    meta: t('hd.contentTaskMeta', { n: fmt(aa.payout_per_herald || aa.commission || 0) }),
                    metaColor: 'var(--text-muted)',
                    // 友情提醒：要求草稿前置的任务，交作品前先告知这里（2026-07-27 用户反馈：
                    // 此前无任何提示，赫使/商家都以为直接发终稿，平台审核时容易误判重复内容）
                    note: aa.require_draft_review ? `📝 ${t('hd.stepLabel', { step: 1 })} · ${t('hd.draftHintFresh')}` : '',
                    right: {
                      type: 'button',
                      text: aa.require_draft_review ? t('hd.submitDraftBtn') : t('task.submitWork'),
                      color: '#fff', bg: 'var(--primary)',
                      onClick: () => this.openSubmit(aa.task_id, aa.require_draft_review ? 'draft' : 'final'),
                    },
                  }),
                )}
              </View>
            )}

            {hasInProgress && (
              <View>
                {hasAction && <Text className='sub-label gap'>{t('hd.inProgress')}</Text>}
                {pendingReviewA.map(pra => {
                  const isDraftStage = pra.sub_stage === 'DRAFT';
                  return this.renderTaskCard(`pend-${pra.task_id}`, {
                    title: pra.task_title,
                    accent: '#0369a1',
                    meta: t('hd.submittedMeta'),
                    metaColor: 'var(--text-muted)',
                    note: pra.require_draft_review ? t('hd.stepLabel', { step: isDraftStage ? 1 : 3 }) : '',
                    right: {
                      type: 'badge',
                      text: pra.require_draft_review ? (isDraftStage ? t('hd.draftReviewing') : t('hd.reviewing')) : t('hd.reviewing'),
                      color: '#0369a1', bg: '#eff6ff',
                    },
                  });
                })}
                {actionableB.map(ab => {
                  const code = ab.code;
                  const payout = Number(code?.payout_per_herald || ab.payout_per_herald || 0);
                  const allZero = code && !Number(code.earned_amount) && !Number(code.registered_count) && !Number(code.used_count);
                  const body = code ? (
                    <>
                      {/* 推广码是卡片主角：上移到标题行正下方，不再埋在灰色统计区里 */}
                      <View className='code-line'>
                        <Text className='code-text'>{code.unique_code || ''}</Text>
                        <Text className='code-copy' onClick={() => this.copyCode(code.unique_code || '')}>
                          {t('hd.copy')}
                        </Text>
                        <Text className='code-share' onClick={() => this.openShareModal(code)}>
                          {t('hd.share')}
                        </Text>
                      </View>
                      <View className='code-box'>
                        <View className='code-stats'>
                          <View className='cs-item'>
                            <Text className='cs-val'>¥{fmt(code.earned_amount)}</Text>
                            <Text className='cs-label'>{t('hd.statEarned')}</Text>
                          </View>
                          <View className='cs-item'>
                            <Text className='cs-val'>{code.registered_count || 0}</Text>
                            <Text className='cs-label'>{t('hd.statReg')}</Text>
                          </View>
                          <View className='cs-item'>
                            <Text className='cs-val'>{code.used_count || 0}</Text>
                            <Text className='cs-label'>{t('hd.statUsed')}</Text>
                          </View>
                        </View>
                        {allZero && payout > 0 && <Text className='code-hint'>{t('hd.zeroHint', { n: fmt(payout) })}</Text>}
                        {/* 欠结算披露（2026-07-18）：转化已发生但商家余额不足未结算时，
                            对赫使诚实展示而非静默——数据即 used_count 与 paid_conversions 的差 */}
                        {Number(code.used_count || 0) > Number(code.paid_conversions || 0) && (
                          <Text className='code-unsettled'>
                            {t('hd.unsettledHint', { n: Number(code.used_count || 0) - Number(code.paid_conversions || 0) })}
                          </Text>
                        )}
                      </View>
                    </>
                  ) : (
                    <Text className='code-pending'>{t('hd.codeGenerating')}</Text>
                  );
                  return this.renderTaskCard(`promo-${ab.task_id}`, {
                    title: ab.task_title,
                    accent: 'var(--gold)',
                    meta: t('hd.promoTask'),
                    metaColor: 'var(--text-muted)',
                    // 徽章展示单价（比"推广中"更有信息量；分区已表明状态）；没拿到单价时回退原徽章
                    right: payout > 0
                      ? { type: 'badge', text: t('hd.perConvBadge', { n: fmt(payout) }), color: '#92400e', bg: '#fffbeb' }
                      : { type: 'badge', text: t('hd.promoting'), color: '#92400e', bg: '#fffbeb' },
                    body,
                  });
                })}
              </View>
            )}
          </View>
        )}

        {/* 报名历史 */}
        <View className='block'>
          <Text className='block-title'>{t('hd.history')}</Text>
          <View className='hist-filters'>
            {HISTORY_FILTERS.map(f => (
              <Text
                key={f.id}
                className={`hist-filter ${filter === f.id ? 'active' : ''}`}
                onClick={() => this.setState({ filter: f.id })}
              >
                {t(f.labelKey)}
              </Text>
            ))}
          </View>

          {filteredApps.length === 0 ? (
            <View className='hist-empty'>
              <Text className='hist-empty-text'>{filter === 'all' ? t('hd.emptyAll') : t('hd.emptyFiltered')}</Text>
            </View>
          ) : (
            filteredApps.map(ra => {
              const [label, color] = statusChip(ra);
              return (
                <View key={ra.id || ra.task_id} className='hist-card'>
                  <View className='hist-top'>
                    <Text className='hist-title'>{ra.task_title}</Text>
                    <Text className='hist-status' style={{ color }}>
                      {label}
                    </Text>
                  </View>
                  <Text className='hist-meta'>
                    {t('hd.histMeta', { n: fmt(ra.payout_per_herald || ra.commission || 0), mode: ra.mode === 'PERFORMANCE' ? t('hd.promoTask') : t('hd.modeContent') })}
                  </Text>
                  {ra.status === 'REJECTED' && ra.review_note && (
                    <View className='reject-note'>{t('hd.applyRejectReason', { note: ra.review_note })}</View>
                  )}
                  {ra.display_status === 'RESUBMIT' && ra.sub_review_note && (
                    <View className='reject-note'>{t('hd.contentRejectReason', { note: ra.sub_review_note })}</View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* 分享 modal */}
        {shareModal && (
          <View className='hd-share-overlay'>
            <View className='hd-share-backdrop' onClick={this.closeShareModal} />
            <View className='hd-share-modal'>
              <View className='hd-share-header'>
                <Text className='hd-share-title'>{t('hd.shareTitle')}</Text>
                <Text className='hd-share-close' onClick={this.closeShareModal}>✕</Text>
              </View>

              {/* 邀请语 — 赫使自定义，保存后朋友打开链接时看到的就是这段文字 */}
              <View className='hd-share-field'>
                <Text className='hd-share-label'>{t('hd.shareIntroLabel')}</Text>
                <Text className='hd-share-hint'>{t('hd.shareIntroHint')}</Text>
                <Textarea
                  className='hd-share-textarea'
                  value={shareModal.intro}
                  onInput={e => this.onShareIntroChange(e.detail.value)}
                  maxlength={300}
                />
              </View>

              {/* 好友优惠 — 只读，商家定义 */}
              {shareModal.benefit ? (
                <View className='hd-share-field'>
                  <Text className='hd-share-label'>{t('hd.shareBenefitLabel')}</Text>
                  <View className='hd-share-benefit-row'>
                    <Text className='hd-share-benefit-text'>{shareModal.benefit}</Text>
                  </View>
                </View>
              ) : null}

              {/* 推广码 + 邀请链接 */}
              <View className='hd-share-field'>
                <Text className='hd-share-label'>{t('hd.shareLinkLabel')}</Text>
                <View className='hd-share-link-row'>
                  <Text className='hd-share-code-tag'>{shareModal.code}</Text>
                  <Text className='hd-share-link-url'>{`herix.huaxuex.com/invite/${shareModal.code}`}</Text>
                </View>
              </View>

              {/* 主操作：复制链接（文案由 onInput debounce 自动保存，按钮不负责保存） */}
              <View
                className={`hd-share-btn-primary${shareSaving ? ' hd-share-btn-saving' : ''}`}
                onClick={() => { if (!shareSaving) this.copyShareLink(shareModal.code); }}
              >
                <Text>{shareSaving ? t('hd.shareSaving') : t('hd.copyShareText')}</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  }
}
