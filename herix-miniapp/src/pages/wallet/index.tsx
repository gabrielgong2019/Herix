import { Component } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, getToken } from '../../utils/api';
import './index.scss';

// ── 常量（对齐 herix.html walletHTML） ──
const PERIODS: { id: string; label: string }[] = [
  { id: 'month', label: '本月' },
  { id: 'last_month', label: '上月' },
  { id: '7d', label: '最近7天' },
  { id: '30d', label: '最近30天' },
  { id: 'all', label: '全部' },
];
const TXN_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'TASK_CREDIT', label: '任务收入' },
  { id: 'WITHDRAWAL_DEBIT', label: '提现到账' },
  { id: 'WITHDRAWAL_FREEZE', label: '提现申请' },
  { id: 'ADJUSTMENT', label: '调整' },
];
const METHOD_TYPE_LABELS: Record<string, string> = {
  BANK: '银行账户',
  PAYPAL: 'PayPal',
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  CASH: '現金',
};

// 千分位（不依赖 toLocaleString，规避小程序引擎差异）
const fmt = (n: any) => {
  const v = Math.round(Math.abs(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

// 期间 → ISO 时间范围（对齐 herix walletPeriodRange）
function periodRange(period: string) {
  const now = new Date();
  let from: Date;
  let to: Date = now;
  if (period === 'last_month') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === '7d') {
    from = new Date(now.getTime() - 7 * 86400000);
  } else if (period === '30d') {
    from = new Date(now.getTime() - 30 * 86400000);
  } else if (period === 'all') {
    from = new Date('1970-01-01');
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
function parseDetail(m: any) {
  return (typeof m.account_details === 'string' ? safeParse(m.account_details) : m.account_details) || {};
}
function methodSub(m: any): string {
  const d = parseDetail(m);
  if (m.type === 'CASH') return '現金受取';
  if (m.type === 'BANK') return d.bank_name || '';
  if (m.type === 'PAYPAL') return d.email || '';
  if (m.type === 'WECHAT') return (d.wechat_id || '') + (d.region && d.region !== 'CN' ? ` (${d.region})` : '');
  if (m.type === 'ALIPAY') return (d.account || '') + (d.region && d.region !== 'CN' ? ` (Alipay+ ${d.region})` : '');
  return '';
}

interface State {
  loading: boolean;
  loggedIn: boolean;
  balance: any;
  methods: any[];
  txns: any[];
  flow: { inflow: number; outflow: number };
  period: string;
  txnFilter: string;
}

export default class Wallet extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    balance: {},
    methods: [],
    txns: [],
    flow: { inflow: 0, outflow: 0 },
    period: 'month',
    txnFilter: 'all',
  };

  // 每次页面显示都刷新：从提现/加收款方式页返回时，余额和方式列表要更新
  componentDidShow() {
    if (!getToken()) {
      this.setState({ loggedIn: false, loading: false });
      return;
    }
    this.setState({ loggedIn: true });
    this.loadAll();
  }

  loadAll = async () => {
    await Promise.all([this.loadBalance(), this.loadMethods(), this.loadTxns()]);
    this.setState({ loading: false });
  };

  loadBalance = async () => {
    try {
      const r = periodRange(this.state.period);
      const bal = await walletApi.balance({ from: r.from, to: r.to });
      this.setState({ balance: bal || {} });
    } catch (err) {
      console.error('load balance error:', err);
    }
  };

  loadMethods = async () => {
    try {
      const methods = await walletApi.methods();
      this.setState({ methods: methods || [] });
    } catch (err) {
      console.error('load methods error:', err);
    }
  };

  loadTxns = async () => {
    try {
      const r = periodRange(this.state.period);
      const params: any = { walletType: 'herald', limit: 50, from: r.from, to: r.to };
      if (this.state.txnFilter !== 'all') params.type = this.state.txnFilter;
      const d: any = await walletApi.transactions(params);
      this.setState({
        txns: d.transactions || [],
        flow: { inflow: d.periodInflow || 0, outflow: d.periodOutflow || 0 },
      });
    } catch (err) {
      console.error('load txns error:', err);
    }
  };

  setPeriod = (p: string) => {
    if (p === this.state.period) return;
    this.setState({ period: p }, () => {
      this.loadBalance();
      this.loadTxns();
    });
  };

  setTxnFilter = (f: string) => {
    if (f === this.state.txnFilter) return;
    this.setState({ txnFilter: f }, this.loadTxns);
  };

  deleteMethod = async (id: string) => {
    const res = await Taro.showModal({ title: '删除收款方式', content: '确认删除此收款方式？' });
    if (!res.confirm) return;
    try {
      await walletApi.deleteMethod(id);
      this.loadMethods();
      this.loadBalance();
    } catch (err) {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  goWithdraw = () => Taro.navigateTo({ url: '/pages/withdraw/index' });
  goAddMethod = () => Taro.navigateTo({ url: '/pages/add-method/index' });

  render() {
    const { loading, loggedIn, balance: bal, methods, txns, flow, period, txnFilter } = this.state;

    if (!loggedIn) {
      return (
        <View className='wallet-page'>
          <View className='empty-box'>
            <Text className='empty-text'>请先登录后查看钱包</Text>
          </View>
        </View>
      );
    }

    if (loading) {
      return (
        <View className='wallet-page'>
          <View className='empty-box'>
            <Text className='empty-text'>加载中...</Text>
          </View>
        </View>
      );
    }

    const periodLabel = PERIODS.find(p => p.id === period)?.label || '本月';
    const balances: any[] = bal.balances || [];

    return (
      <View className='wallet-page'>
        {/* 余额卡 */}
        <View className='balance-card'>
          <Text className='bc-label'>可提现余额</Text>
          <Text className='bc-amount'>¥{fmt(bal.available)}</Text>
          <View className='bc-stats'>
            <View className='bc-stat'>
              <Text className='bc-stat-label'>冻结中</Text>
              <Text className='bc-stat-val'>¥{fmt(bal.frozen)}</Text>
            </View>
            <View className='bc-stat'>
              <Text className='bc-stat-label'>{periodLabel}流入</Text>
              <Text className='bc-stat-val inflow'>+¥{fmt(bal.periodInflow)}</Text>
            </View>
            <View className='bc-stat last'>
              <Text className='bc-stat-label'>{periodLabel}流出</Text>
              <Text className='bc-stat-val outflow'>-¥{fmt(bal.periodOutflow)}</Text>
            </View>
          </View>
          <Text className='bc-currency'>汇总币种：{bal.displayCurrency || 'JPY'}</Text>
        </View>

        {/* 多币种明细 */}
        {balances.length > 1 && (
          <View className='card multi-currency'>
            <Text className='mc-title'>各币种余额</Text>
            {balances.map((b, i) => (
              <View key={b.currency} className={`mc-row ${i < balances.length - 1 ? 'divider' : ''}`}>
                <Text className='mc-cur'>{b.currency}</Text>
                <Text className='mc-detail'>
                  可用 ¥{fmt(b.available)} · 冻结 ¥{fmt(b.frozen)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* 冻结说明 */}
        {bal.frozen > 0 && (
          <View className='frozen-note'>
            ⏳ 冻结中 ¥{fmt(bal.frozen)} 为提现处理中的金额，处理完成后将从余额扣除
          </View>
        )}

        {/* 主操作：提现 */}
        <View className='btn-primary' onClick={this.goWithdraw}>
          申请提现
        </View>

        {/* 收款方式 */}
        <View className='section-head'>
          <Text className='section-title'>收款方式</Text>
          <Text className='section-action' onClick={this.goAddMethod}>
            + 添加
          </Text>
        </View>
        {methods.length === 0 ? (
          <View className='method-empty'>还没有添加收款方式</View>
        ) : (
          methods.map(m => (
            <View key={m.id} className='method-row'>
              <View className='method-info'>
                <Text className='method-label'>{m.label}</Text>
                <Text className='method-meta'>
                  {METHOD_TYPE_LABELS[m.type] || m.type}
                  {methodSub(m) ? ` · ${methodSub(m)}` : ''}
                  {m.is_default ? ' · 默认' : ''}
                </Text>
              </View>
              <Text className='method-del' onClick={() => this.deleteMethod(m.id)}>
                删除
              </Text>
            </View>
          ))
        )}

        {/* 钱包流水 */}
        <View className='section-head txn-head'>
          <Text className='section-title'>钱包流水</Text>
          <View className='period-tabs'>
            {PERIODS.map(p => (
              <Text
                key={p.id}
                className={`period-tab ${period === p.id ? 'active' : ''}`}
                onClick={() => this.setPeriod(p.id)}
              >
                {p.label}
              </Text>
            ))}
          </View>
        </View>

        <View className='flow-stats'>
          <View className='flow-stat'>
            <Text className='flow-label'>期间流入</Text>
            <Text className='flow-val inflow'>+¥{fmt(flow.inflow)}</Text>
          </View>
          <View className='flow-stat'>
            <Text className='flow-label'>期间流出</Text>
            <Text className='flow-val outflow'>-¥{fmt(flow.outflow)}</Text>
          </View>
        </View>

        <View className='txn-filters'>
          {TXN_FILTERS.map(tf => (
            <Text
              key={tf.id}
              className={`txn-filter ${txnFilter === tf.id ? 'active' : ''}`}
              onClick={() => this.setTxnFilter(tf.id)}
            >
              {tf.label}
            </Text>
          ))}
        </View>

        {txns.length === 0 ? (
          <View className='txn-empty'>该期间暂无流水记录</View>
        ) : (
          txns.map((tx, i) => {
            const out = tx.direction === 'out';
            return (
              <View key={tx.id || i} className='txn-row'>
                <View className='txn-info'>
                  <Text className='txn-label'>
                    {tx.label || tx.type}
                    {tx.note ? ` · ${tx.note}` : ''}
                  </Text>
                  <Text className='txn-time'>{(tx.created_at || '').slice(0, 16).replace('T', ' ')}</Text>
                </View>
                <Text className={`txn-amount ${out ? 'out' : 'in'}`}>
                  {out ? '-' : '+'}¥{fmt(tx.amount)} {tx.currency}
                </Text>
              </View>
            );
          })
        )}
      </View>
    );
  }
}
