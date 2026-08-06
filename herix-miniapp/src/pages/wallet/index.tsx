import { Component } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, getToken } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';
import { fmt, fmtLocal } from '../../utils/format';
import BackBar from '../../components/BackBar';

// ── 常量存 labelKey，渲染时 t() 取值——存 t() 结果会冻结在启动时语言 ──
const PERIODS: { id: string; labelKey: string }[] = [
  { id: 'month', labelKey: 'wallet.period.month' },
  { id: 'last_month', labelKey: 'wallet.period.lastMonth' },
  { id: '7d', labelKey: 'wallet.period.7d' },
  { id: '30d', labelKey: 'wallet.period.30d' },
  { id: 'all', labelKey: 'common.all' },
];
const TXN_FILTERS: { id: string; labelKey: string }[] = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'TASK_CREDIT', labelKey: 'wallet.txnFilter.taskCredit' },
  { id: 'WITHDRAWAL_DEBIT', labelKey: 'wallet.txnFilter.withdrawalDebit' },
  { id: 'WITHDRAWAL_FREEZE', labelKey: 'wallet.txnFilter.withdrawalFreeze' },
  { id: 'ADJUSTMENT', labelKey: 'wallet.txnFilter.adjustment' },
];
const METHOD_TYPE_KEYS: Record<string, string> = {
  BANK: 'wallet.methodType.BANK',
  PAYPAL: 'wallet.methodType.PAYPAL',
  WECHAT: 'wallet.methodType.WECHAT',
  ALIPAY: 'wallet.methodType.ALIPAY',
  CASH: 'wallet.methodType.CASH',
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

function parseDetail(m: any) {
  return m.account_details || {};
}
function methodSub(m: any): string {
  const d = parseDetail(m);
  if (m.type === 'CASH') return t('wallet.cashReceive');
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
    const res = await Taro.showModal({ title: t('wallet.deleteTitle'), content: t('wallet.deleteConfirm'), confirmText: t('common.confirm'), cancelText: t('common.cancel') });
    if (!res.confirm) return;
    try {
      await walletApi.deleteMethod(id);
      this.loadMethods();
      this.loadBalance();
    } catch (err) {
      Taro.showToast({ title: t('wallet.deleteFailed'), icon: 'none' });
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
            <Text className='empty-text'>{t('wallet.needLogin')}</Text>
          </View>
        </View>
      );
    }

    if (loading) {
      return (
        <View className='wallet-page'>
          <View className='empty-box'>
            <Text className='empty-text'>{t('common.loading')}</Text>
          </View>
        </View>
      );
    }

    const periodLabel = t(PERIODS.find(p => p.id === period)?.labelKey || 'wallet.period.month');
    const balances: any[] = bal.balances || [];

    return (
      <View className='wallet-page'>
        <BackBar />
        {/* 余额卡 */}
        <View className='balance-card'>
          <Text className='bc-label'>{t('wallet.balance.available')}</Text>
          <Text className='bc-amount'>¥{fmt(bal.available)}</Text>
          <View className='bc-stats'>
            <View className='bc-stat'>
              <Text className='bc-stat-label'>{t('wallet.balance.frozen')}</Text>
              <Text className='bc-stat-val'>¥{fmt(bal.frozen)}</Text>
            </View>
            <View className='bc-stat'>
              <Text className='bc-stat-label'>{t('wallet.balance.inflow', { period: periodLabel })}</Text>
              <Text className='bc-stat-val inflow'>+¥{fmt(bal.periodInflow)}</Text>
            </View>
            <View className='bc-stat last'>
              <Text className='bc-stat-label'>{t('wallet.balance.outflow', { period: periodLabel })}</Text>
              <Text className='bc-stat-val outflow'>-¥{fmt(bal.periodOutflow)}</Text>
            </View>
          </View>
          <Text className='bc-currency'>{t('wallet.balance.currency', { cur: bal.displayCurrency || 'JPY' })}</Text>
        </View>

        {/* 多币种明细 */}
        {balances.length > 1 && (
          <View className='card multi-currency'>
            <Text className='mc-title'>{t('wallet.multiCurrency')}</Text>
            {balances.map((b, i) => (
              <View key={b.currency} className={`mc-row ${i < balances.length - 1 ? 'divider' : ''}`}>
                <Text className='mc-cur'>{b.currency}</Text>
                <Text className='mc-detail'>{t('wallet.multiCurrencyDetail', { a: fmt(b.available), f: fmt(b.frozen) })}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 冻结说明 */}
        {bal.frozen > 0 && <View className='frozen-note'>{t('wallet.frozenNote', { n: fmt(bal.frozen) })}</View>}

        {/* 主操作：提现 */}
        <View className='btn-primary' onClick={this.goWithdraw}>
          {t('wallet.withdraw')}
        </View>

        {/* 收款方式 */}
        <View className='section-head'>
          <Text className='section-title'>{t('wallet.methods')}</Text>
          <Text className='section-action' onClick={this.goAddMethod}>
            {t('wallet.methodsAdd')}
          </Text>
        </View>
        {methods.length === 0 ? (
          <View className='method-empty'>{t('wallet.methodsEmpty')}</View>
        ) : (
          methods.map(m => (
            <View key={m.id} className='method-row'>
              <View className='method-info'>
                <Text className='method-label'>{m.label}</Text>
                <Text className='method-meta'>
                  {t(METHOD_TYPE_KEYS[m.type] || 'wallet.methodType.BANK')}
                  {methodSub(m) ? ` · ${methodSub(m)}` : ''}
                  {m.is_default ? ` · ${t('wallet.methodsDefault')}` : ''}
                </Text>
              </View>
              <Text className='method-del' onClick={() => this.deleteMethod(m.id)}>
                {t('wallet.methodsDelete')}
              </Text>
            </View>
          ))
        )}

        {/* 钱包流水 */}
        <View className='section-head txn-head'>
          <Text className='section-title'>{t('wallet.txns')}</Text>
          <View className='period-tabs'>
            {PERIODS.map(p => (
              <Text
                key={p.id}
                className={`period-tab ${period === p.id ? 'active' : ''}`}
                onClick={() => this.setPeriod(p.id)}
              >
                {t(p.labelKey)}
              </Text>
            ))}
          </View>
        </View>

        <View className='flow-stats'>
          <View className='flow-stat'>
            <Text className='flow-label'>{t('wallet.txnsInflow')}</Text>
            <Text className='flow-val inflow'>+¥{fmt(flow.inflow)}</Text>
          </View>
          <View className='flow-stat'>
            <Text className='flow-label'>{t('wallet.txnsOutflow')}</Text>
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
              {t(tf.labelKey)}
            </Text>
          ))}
        </View>

        {txns.length === 0 ? (
          <View className='txn-empty'>{t('wallet.txnsEmpty')}</View>
        ) : (
          txns.map((tx, i) => {
            const out = tx.direction === 'out';
            return (
              <View key={tx.id || i} className='txn-row'>
                <View className='txn-info'>
                  <Text className='txn-label'>
                    {t(`wallet.txnType.${tx.type}`, tx.type)}
                    {tx.note ? ` · ${tx.note}` : ''}
                  </Text>
                  <Text className='txn-time'>{fmtLocal(tx.created_at)}</Text>
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
