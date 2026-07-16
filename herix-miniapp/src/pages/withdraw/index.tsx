import { Component } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, getToken } from '../../utils/api';
import './index.scss';

const METHOD_ICONS: Record<string, string> = {
  BANK: '🏦',
  ALIPAY: '🔵',
  WECHAT: '🟢',
  PAYPAL: '🅿️',
  CASH: '💴',
};
const METHOD_ETA: Record<string, string> = {
  BANK: '1–3 工作日',
  ALIPAY: '即时到账',
  WECHAT: '即时到账',
  PAYPAL: '即时到账',
  CASH: '当面结算',
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
      Taro.showToast({ title: '请选择收款方式', icon: 'none' });
      return;
    }
    const amt = parseFloat(amount) || 0;
    if (amt < 100) {
      Taro.showToast({ title: '最低提现 ¥100', icon: 'none' });
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
      Taro.showToast({ title: '提现申请已提交', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 800);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '提现失败，请重试', icon: 'none' });
      this.setState({ submitting: false });
    }
  };

  render() {
    const { loading, loggedIn, balance: bal, methods, selMethodId, amount, submitting } = this.state;

    if (!loggedIn) {
      return (
        <View className='withdraw-page'>
          <View className='empty-box'>
            <Text className='empty-text'>请先登录后提现</Text>
          </View>
        </View>
      );
    }
    if (loading) {
      return (
        <View className='withdraw-page'>
          <View className='empty-box'>
            <Text className='empty-text'>加载中...</Text>
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
            可提现余额 <Text className='avail-strong'>¥{fmt(avail)}</Text>
          </Text>
          <View className='no-method'>
            <Text className='nm-icon'>💳</Text>
            <Text className='nm-title'>还没有收款方式</Text>
            <Text className='nm-sub'>添加收款方式后即可提现</Text>
            <View className='btn-primary' onClick={this.goAddMethod}>
              + 添加收款方式
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
    const eta = sel ? METHOD_ETA[sel.type] || '1–3 工作日' : '1–3 工作日';

    let btnText = '输入提现金额';
    if (amt > avail) btnText = '超出可用余额';
    else if (valid) btnText = `确认提现 ¥${fmt(net)}`;

    return (
      <View className='withdraw-page'>
        <Text className='avail-line'>
          可提现余额 <Text className='avail-strong'>¥{fmt(avail)}</Text>
        </Text>

        {/* 收款方式横向选择 */}
        <Text className='field-label'>收款方式</Text>
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
                  {active && <Text className='mc-check'>✓ 已选择</Text>}
                </View>
              );
            })}
            <View className='method-card add' onClick={this.goAddMethod}>
              <Text className='mc-add-plus'>+</Text>
              <Text className='mc-add-text'>添加方式</Text>
            </View>
          </View>
        </ScrollView>

        {/* 金额输入 */}
        <Text className='field-label'>提现金额</Text>
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
            全部提现
          </Text>
        </View>
        <Text className='amount-hint'>最低 ¥100 · 单位：JPY</Text>

        {/* 费用预览 */}
        {valid && (
          <View className='preview-card'>
            <View className='pv-row'>
              <Text className='pv-label'>提现金额</Text>
              <Text className='pv-val'>¥{fmt(amt)} JPY</Text>
            </View>
            <View className='pv-row'>
              <Text className='pv-label'>手续费</Text>
              <Text className={`pv-val ${fee === 0 ? 'free' : ''}`}>{fee === 0 ? '免费' : `−¥${fmt(fee)}`}</Text>
            </View>
            <View className='pv-row net'>
              <Text className='pv-label'>到账金额</Text>
              <View className='pv-net-box'>
                <Text className='pv-net'>¥{fmt(net)} JPY</Text>
                {cny && <Text className='pv-cny'>≈ {cny} CNY（参考汇率，实际以到账为准）</Text>}
              </View>
            </View>
          </View>
        )}
        {valid && <Text className='eta-line'>⏱ 预计到账：{eta}</Text>}

        <View
          className={`btn-primary submit ${!valid || submitting ? 'disabled' : ''}`}
          onClick={valid && !submitting ? this.submit : undefined}
        >
          {submitting ? '提交中...' : btnText}
        </View>
      </View>
    );
  }
}
