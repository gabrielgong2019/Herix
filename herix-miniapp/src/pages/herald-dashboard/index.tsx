import { Component } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, applications, submissions, referrals, getToken } from '../../utils/api';
import './index.scss';

const fmt = (n: any) => {
  const v = Math.round(Math.abs(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const HISTORY_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待审核' },
  { id: 'done', label: '已完成' },
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
  myApps: any[];
  mySubs: any[];
  myCodes: any[];
  filter: string;
}

export default class HeraldDashboard extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    balance: {},
    myApps: [],
    mySubs: [],
    myCodes: [],
    filter: 'all',
  };

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
    const [bal, apps, subs, codes] = await Promise.all([
      walletApi.balance({ from, to }).catch(() => ({})),
      applications.my().catch(() => []),
      submissions.my().catch(() => []),
      referrals.myCodes().catch(() => []),
    ]);
    this.setState({
      balance: bal || {},
      myApps: apps || [],
      mySubs: subs || [],
      myCodes: codes || [],
      loading: false,
    });
  };

  goWallet = () => Taro.navigateTo({ url: '/pages/wallet/index' });
  openSubmit = (taskId: string) => Taro.navigateTo({ url: `/pages/apply/apply?taskId=${taskId}` });

  copyCode = (code: string) => {
    Taro.setClipboardData({ data: code });
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
      <View key={key} className='task-card' style={{ borderLeftColor: opts.accent }}>
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
    const { loading, loggedIn, balance: bal, myApps, mySubs, myCodes, filter } = this.state;

    if (!loggedIn) {
      return (
        <View className='herald-dashboard-page'>
          <View className='empty-state'>
            <Text className='empty-text'>请先登录后查看任务中心</Text>
          </View>
        </View>
      );
    }
    if (loading) {
      return (
        <View className='herald-dashboard-page'>
          <View className='empty-state'>
            <Text className='empty-text'>加载中...</Text>
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

    // ── 待办任务计算（对齐 herix） ──
    const approvedStdApps = myApps.filter(a => a.status === 'APPROVED' && a.mode === 'STANDARD');
    const subForTask = (tid: string) => mySubs.find(s => s.task_id === tid && s.status === 'APPROVED');
    const rejectedSubForTask = (tid: string) => mySubs.find(s => s.task_id === tid && s.status === 'REJECTED');
    const pendingSubForTask = (tid: string) => mySubs.find(s => s.task_id === tid && s.status === 'PENDING_REVIEW');
    const actionableA = approvedStdApps.filter(a => !subForTask(a.task_id) && !pendingSubForTask(a.task_id));
    const freshA = actionableA.filter(a => !rejectedSubForTask(a.task_id));
    const rejectedA = actionableA.filter(a => !!rejectedSubForTask(a.task_id));
    const pendingReviewA = approvedStdApps.filter(a => !!pendingSubForTask(a.task_id));
    const actionableB = myApps.filter(
      a => a.status === 'APPROVED' && a.mode === 'PERFORMANCE' && myCodes.some(c => c.task_id === a.task_id),
    );
    const hasAction = rejectedA.length > 0 || freshA.length > 0;
    const hasInProgress = pendingReviewA.length > 0 || actionableB.length > 0;

    // ── 报名历史过滤 ──
    let filteredApps = myApps;
    if (filter === 'pending') filteredApps = myApps.filter(a => a.status === 'PENDING');
    if (filter === 'done')
      filteredApps = myApps.filter(
        a => a.status === 'APPROVED' && mySubs.some(s => s.task_id === a.task_id && s.status === 'APPROVED'),
      );

    const statusChip = (ra: any): [string, string] => {
      const stMap: Record<string, [string, string]> = {
        PENDING: ['待审核', '#d97706'],
        APPROVED: ['已通过', '#16a34a'],
        REJECTED: ['未通过', '#dc2626'],
        WITHDRAWN: ['已撤回', '#6b7280'],
      };
      if (ra.status === 'APPROVED' && ra.mode === 'STANDARD') {
        const raSub = mySubs.find(s => s.task_id === ra.task_id);
        if (raSub && raSub.status === 'APPROVED') stMap.APPROVED = ['已完成', '#6366f1'];
        else if (raSub && raSub.status === 'PENDING_REVIEW') stMap.APPROVED = ['内容审核中', '#0369a1'];
        else if (raSub && raSub.status === 'REJECTED') stMap.APPROVED = ['需重新提交', '#dc2626'];
      }
      return stMap[ra.status] || ['', '#666'];
    };

    return (
      <View className='herald-dashboard-page'>
        {/* 收支摘要 */}
        <View className='summary' onClick={this.goWallet}>
          <View className='sum-cell'>
            <Text className='sum-label'>可用余额</Text>
            <Text className='sum-val'>
              {balApprox ? '≈' : ''}¥{fmt(bal.available)} <Text className='sum-cur'>{balCur}</Text>
            </Text>
          </View>
          <View className='sum-cell'>
            <Text className='sum-label'>本月收入</Text>
            <Text className='sum-val income'>
              +¥{fmt(bal.periodInflow)} <Text className='sum-cur'>{balCur}</Text>
            </Text>
          </View>
        </View>

        {/* 待办任务 */}
        {(hasAction || hasInProgress) && (
          <View className='block'>
            <Text className='block-title'>待办任务</Text>

            {hasAction && (
              <View>
                {hasInProgress && <Text className='sub-label'>待操作</Text>}
                {rejectedA.map(ra => {
                  const rsub = rejectedSubForTask(ra.task_id);
                  return this.renderTaskCard(`rej-${ra.task_id}`, {
                    title: ra.task_title,
                    accent: '#dc2626',
                    meta: '内容审核未通过，请修改后重新提交',
                    metaColor: '#dc2626',
                    note: rsub && rsub.review_note ? `原因：${rsub.review_note}` : '',
                    right: { type: 'button', text: '重新提交', color: '#fff', bg: '#dc2626', onClick: () => this.openSubmit(ra.task_id) },
                  });
                })}
                {freshA.map(aa =>
                  this.renderTaskCard(`fresh-${aa.task_id}`, {
                    title: aa.task_title,
                    accent: 'var(--primary)',
                    meta: `内容任务 · ¥${aa.payout_per_herald || aa.commission || 0}`,
                    metaColor: 'var(--text-muted)',
                    right: { type: 'button', text: '提交作品', color: '#fff', bg: 'var(--primary)', onClick: () => this.openSubmit(aa.task_id) },
                  }),
                )}
              </View>
            )}

            {hasInProgress && (
              <View>
                {hasAction && <Text className='sub-label gap'>进行中</Text>}
                {pendingReviewA.map(pra =>
                  this.renderTaskCard(`pend-${pra.task_id}`, {
                    title: pra.task_title,
                    accent: '#0369a1',
                    meta: '内容已提交，等待品牌审核',
                    metaColor: 'var(--text-muted)',
                    right: { type: 'badge', text: '审核中', color: '#0369a1', bg: '#eff6ff' },
                  }),
                )}
                {actionableB.map(ab => {
                  const code = myCodes.find(c => c.task_id === ab.task_id);
                  const body = code ? (
                    <View className='code-box'>
                      <View className='code-line'>
                        <Text className='code-text'>{code.unique_code || ''}</Text>
                        <Text className='code-copy' onClick={() => this.copyCode(code.unique_code || '')}>
                          复制
                        </Text>
                      </View>
                      <Text className='code-stat'>
                        收益 ¥{fmt(code.earned_amount)} · {code.registered_count || 0}注册 {code.used_count || 0}使用
                      </Text>
                    </View>
                  ) : (
                    <Text className='code-pending'>⏳ 推广码正在生成</Text>
                  );
                  return this.renderTaskCard(`promo-${ab.task_id}`, {
                    title: ab.task_title,
                    accent: 'var(--gold)',
                    meta: '推广任务',
                    metaColor: 'var(--text-muted)',
                    right: { type: 'badge', text: '推广中', color: '#92400e', bg: '#fffbeb' },
                    body,
                  });
                })}
              </View>
            )}
          </View>
        )}

        {/* 报名历史 */}
        <View className='block'>
          <Text className='block-title'>报名历史</Text>
          <View className='hist-filters'>
            {HISTORY_FILTERS.map(f => (
              <Text
                key={f.id}
                className={`hist-filter ${filter === f.id ? 'active' : ''}`}
                onClick={() => this.setState({ filter: f.id })}
              >
                {f.label}
              </Text>
            ))}
          </View>

          {filteredApps.length === 0 ? (
            <View className='hist-empty'>
              <Text className='hist-empty-text'>{filter === 'all' ? '还没有报名记录' : '暂无此状态的记录'}</Text>
            </View>
          ) : (
            filteredApps.map(ra => {
              const [label, color] = statusChip(ra);
              const raSubD = mySubs.find(s => s.task_id === ra.task_id);
              return (
                <View key={ra.id || ra.task_id} className='hist-card'>
                  <View className='hist-top'>
                    <Text className='hist-title'>{ra.task_title}</Text>
                    <Text className='hist-status' style={{ color }}>
                      {label}
                    </Text>
                  </View>
                  <Text className='hist-meta'>
                    ¥{ra.payout_per_herald || ra.commission || 0} · {ra.mode === 'PERFORMANCE' ? '推广任务' : '内容任务'}
                  </Text>
                  {ra.status === 'REJECTED' && ra.review_note && (
                    <View className='reject-note'>报名拒绝原因：{ra.review_note}</View>
                  )}
                  {ra.status === 'APPROVED' &&
                    ra.mode === 'STANDARD' &&
                    raSubD &&
                    raSubD.status === 'REJECTED' &&
                    raSubD.review_note && <View className='reject-note'>内容拒绝原因：{raSubD.review_note}</View>}
                </View>
              );
            })
          )}
        </View>
      </View>
    );
  }
}
