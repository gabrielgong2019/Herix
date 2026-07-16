import { Component } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, getToken } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';

const METHOD_ICONS: Record<string, string> = {
  BANK: '🏦',
  ALIPAY: '🔵',
  WECHAT: '🟢',
  PAYPAL: '🅿️',
  CASH: '💴',
};
// 存 key，渲染时 t() 取值（模块级存 t() 结果会冻结在启动语言）
const METHOD_ETA_KEYS: Record<string, string> = {
  BANK: 'withdraw.etaBank',
  ALIPAY: 'withdraw.etaInstant',
  WECHAT: 'withdraw.etaInstant',
  PAYPAL: 'withdraw.etaInstant',
  CASH: 'withdraw.etaCash',
};
const FX_RATE = 0.049; // 参考汇率 JPY→CNY，接入 Airwallex 后替换（对齐 herix）
const FEE_RATE = 0; // 暂时免手续费

const fmt = (n: any) => {
  const v = Math.round(Math.abs(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

interface State {
  loading: boolean;
  loggedIn: boolean;
  balance: any;
  methods: any[];
  selMethodId: string;
  amount: string;
  submitting: boolean;
}

export default class Withdraw extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    balance: {},
    methods: [],
    selMethodId: '',
    amount: '',
    submitting: false,
  };

  componentDidShow() {
    if (!getToken()) {
      this.setState({ loggedIn: false, loading: false });
      return;
    }
    this.setState({ loggedIn: true });
    this.loadData();
  }

  loadData = async () => {
    try {
      const [bal, methods] = await Promise.all([walletApi.balance(), walletApi.methods()]);
      const list = methods || [];
      this.setState({
        balance: bal || {},
        methods: list,
        selMethodId: this.state.selMethodId || (list[0]?.id ?? ''),
        loading: false,
      });
    } catch (err) {
      console.error('load withdraw data error:', err);
      this.setState({ loading: false });
    }
  };

  goAddMethod = () => Taro.navigateTo({ url: '/pages/add-method/index' });

  setAll = () => {
    const avail = this.state.balance.available || 0;
    this.setState({ amount: String(avail) });
  };

  submit = async () => {
    const { methods, selMethodId, amount } = this.state;
    const sel = methods.find(m => m.id === selMethodId) || methods[0];
    if (!sel) {
      Taro.showToast({ title: t('withdraw.errSelect'), icon: 'none' });
      return;
    }
    const amt = parseFloat(amount) || 0;
    if (amt < 100) {
      Taro.showToast({ title: t('withdraw.errMin'), icon: 'none' });
      return;
    }
    this.setState({ submitting: true });
    try {
      // ⚠️ herix.html 新版调 POST /wallet/withdraw（method_id+amount），但后端尚未实现
      //（见 api.ts 注释：Phase 3 补后端后再加）。这里接后端已存在的 withdraw-request：
      // 参数从选中方式映射，提现走「申请」流程。Phase 3 后端补齐后切到新接口。
      const detail = typeof sel.account_details === 'string' ? JSON.parse(sel.account_details) : sel.account_details;
      await walletApi.withdrawRequest({
        amount: amt,
        method: sel.type,
        accountDetails: detail || {},
      });
      Taro.showToast({ title: t('withdraw.success'), icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 800);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('withdraw.failed'), icon: 'none' });
      this.setState({ submitting: false });
    }
  };

  render() {
    const { loading, loggedIn, balance: bal, methods, selMethodId, amount, submitting } = this.state;

    if (!loggedIn) {
      return (
        <View className='withdraw-page'>
          <View className='empty-box'>
            <Text className='empty-text'>{t('withdraw.needLogin')}</Text>
          </View>
        </View>
      );
    }
    if (loading) {
      return (
        <View className='withdraw-page'>
          <View className='empty-box'>
            <Text className='empty-text'>{t('common.loading')}</Text>
          </View>
        </View>
      );
    }

    const avail = bal.available || 0;

    // 无收款方式空态
    if (methods.length === 0) {
      return (
        <View className='withdraw-page'>
          <Text className='avail-line'>
            {t('withdraw.availPrefix')} <Text className='avail-strong'>¥{fmt(avail)}</Text>
          </Text>
          <View className='no-method'>
            <Text className='nm-icon'>💳</Text>
            <Text className='nm-title'>{t('withdraw.noMethod')}</Text>
            <Text className='nm-sub'>{t('withdraw.noMethodSub')}</Text>
            <View className='btn-primary' onClick={this.goAddMethod}>
              {t('withdraw.addMethod')}
            </View>
          </View>
        </View>
      );
    }

    const sel = methods.find(m => m.id === selMethodId) || methods[0];
    const isCNY = sel && (sel.type === 'ALIPAY' || sel.type === 'WECHAT');
    const amt = parseFloat(amount) || 0;
    const valid = amt >= 100 && amt <= avail;
    const fee = Math.round(amt * FEE_RATE);
    const net = amt - fee;
    const cny = isCNY ? (net * FX_RATE).toFixed(2) : null;
    const eta = t(sel ? METHOD_ETA_KEYS[sel.type] || 'withdraw.etaBank' : 'withdraw.etaBank');

    let btnText = t('withdraw.btnEnter');
    if (amt > avail) btnText = t('withdraw.btnExceed');
    else if (valid) btnText = t('withdraw.btnConfirm', { n: fmt(net) });

    return (
      <View className='withdraw-page'>
        <Text className='avail-line'>
          {t('withdraw.availPrefix')} <Text className='avail-strong'>¥{fmt(avail)}</Text>
        </Text>

        {/* 收款方式横向选择 */}
        <Text className='field-label'>{t('wallet.methods')}</Text>
        <ScrollView scrollX className='method-scroll'>
          <View className='method-track'>
            {methods.map(m => {
              const d = (typeof m.account_details === 'string' ? JSON.parse(m.account_details) : m.account_details) || {};
              let sub = d.wechat_id || d.account || d.account_number || d.email || '';
              if (sub.length > 14) sub = sub.slice(0, 14) + '…';
              const active = m.id === (sel && sel.id);
              return (
                <View
                  key={m.id}
                  className={`method-card ${active ? 'active' : ''}`}
                  onClick={() => this.setState({ selMethodId: m.id })}
                >
                  <Text className='mc-icon'>{METHOD_ICONS[m.type] || '💳'}</Text>
                  <Text className='mc-label'>{m.label}</Text>
                  {!!sub && <Text className='mc-sub'>{sub}</Text>}
                  {active && <Text className='mc-check'>{t('withdraw.selected')}</Text>}
                </View>
              );
            })}
            <View className='method-card add' onClick={this.goAddMethod}>
              <Text className='mc-add-plus'>+</Text>
              <Text className='mc-add-text'>{t('withdraw.addCard')}</Text>
            </View>
          </View>
        </ScrollView>

        {/* 金额输入 */}
        <Text className='field-label'>{t('withdraw.amount')}</Text>
        <View className={`amount-box ${amt > avail ? 'error' : ''}`}>
          <Text className='amount-yen'>¥</Text>
          <Input
            className='amount-input'
            type='number'
            value={amount}
            placeholder='0'
            onInput={e => this.setState({ amount: e.detail.value })}
          />
          <Text className='amount-all' onClick={this.setAll}>
            {t('withdraw.all')}
          </Text>
        </View>
        <Text className='amount-hint'>{t('withdraw.minHint')}</Text>

        {/* 费用预览 */}
        {valid && (
          <View className='preview-card'>
            <View className='pv-row'>
              <Text className='pv-label'>{t('withdraw.amount')}</Text>
              <Text className='pv-val'>¥{fmt(amt)} JPY</Text>
            </View>
            <View className='pv-row'>
              <Text className='pv-label'>{t('withdraw.fee')}</Text>
              <Text className={`pv-val ${fee === 0 ? 'free' : ''}`}>{fee === 0 ? t('withdraw.free') : `−¥${fmt(fee)}`}</Text>
            </View>
            <View className='pv-row net'>
              <Text className='pv-label'>{t('withdraw.net')}</Text>
              <View className='pv-net-box'>
                <Text className='pv-net'>¥{fmt(net)} JPY</Text>
                {cny && <Text className='pv-cny'>{t('withdraw.cnyRef', { n: cny })}</Text>}
              </View>
            </View>
          </View>
        )}
        {valid && <Text className='eta-line'>{t('withdraw.eta', { eta })}</Text>}

        <View
          className={`btn-primary submit ${!valid || submitting ? 'disabled' : ''}`}
          onClick={valid && !submitting ? this.submit : undefined}
        >
          {submitting ? t('withdraw.submitting') : btnText}
        </View>
      </View>
    );
  }
}
