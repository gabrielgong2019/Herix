import { Component } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi, getToken } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';
import { fmt } from '../../utils/format';
import BackBar from '../../components/BackBar';

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
// 费用/汇率一律由服务端 withdrawal-info 计算（payout_fee_rules 阶梯 + 申请时锁价），前端不再写死


interface State {
  loading: boolean;
  loggedIn: boolean;
  balance: any;
  methods: any[];
  /** 服务端费用预览（阶梯手续费 + 跨境锁价汇率） */
  feeInfo: any;
  selMethodId: string;
  amount: string;
  submitting: boolean;
  minAmount: number; // 后端下发的最低提现额(platform_settings), 兜底1000
}

export default class Withdraw extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    balance: {},
    methods: [],
    feeInfo: null,
    selMethodId: '',
    amount: '',
    submitting: false,
    minAmount: 1000,
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
        minAmount: Number(bal?.withdrawalMin) || 1000,
        loading: false,
      });
    } catch (err) {
      console.error('load withdraw data error:', err);
      this.setState({ loading: false });
    }
  };

  goAddMethod = () => Taro.navigateTo({ url: '/pages/add-method/index' });

  feeTimer: ReturnType<typeof setTimeout> | null = null;

  /** 金额/收款方式变化后 400ms 拉服务端费用预览 */
  scheduleFeeRefresh = () => {
    if (this.feeTimer) clearTimeout(this.feeTimer);
    this.feeTimer = setTimeout(async () => {
      const { amount, methods, selMethodId, minAmount } = this.state;
      const amt = parseFloat(amount) || 0;
      const sel = methods.find(m => m.id === selMethodId) || methods[0];
      if (!sel || amt < minAmount) { this.setState({ feeInfo: null }); return; }
      try {
        const info = await walletApi.withdrawalInfo(amt, sel.id);
        this.setState({ feeInfo: info });
      } catch {
        this.setState({ feeInfo: null });
      }
    }, 400);
  };

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
    if (amt < this.state.minAmount) {
      Taro.showToast({ title: t('withdraw.errMin', { min: fmt(this.state.minAmount) }), icon: 'none' });
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
        methodId: sel.id,  // 服务端据此定收款国 → 阶梯/汇率规则
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
    const { loading, loggedIn, balance: bal, methods, selMethodId, amount, submitting, minAmount } = this.state;

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
          <BackBar />
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
    const amt = parseFloat(amount) || 0;
    const valid = amt >= minAmount && amt <= avail;
    const fi = this.state.feeInfo;
    const fee = fi ? fi.fee : null;
    const net = fi ? fi.netAmount : null;
    const eta = t(sel ? METHOD_ETA_KEYS[sel.type] || 'withdraw.etaBank' : 'withdraw.etaBank');

    let btnText = t('withdraw.btnEnter');
    if (amt > avail) btnText = t('withdraw.btnExceed');
    else if (valid && net !== null) btnText = t('withdraw.btnConfirm', { n: fmt(net) });
    else if (valid) btnText = t('withdraw.btnEnter');

    return (
      <View className='withdraw-page'>
        <BackBar />
        <Text className='avail-line'>
          {t('withdraw.availPrefix')} <Text className='avail-strong'>¥{fmt(avail)}</Text>
        </Text>

        {/* 提现规则（审核要求：明确展示规则） */}
        <View className='rules-card'>
          <Text className='rules-title'>{t('withdraw.rulesTitle')}</Text>
          <View className='rules-row'>
            <Text className='rules-label'>{t('withdraw.rulesMin')}</Text>
            <Text className='rules-val'>¥{fmt(minAmount)}</Text>
          </View>
          <View className='rules-row'>
            <Text className='rules-label'>{t('withdraw.rulesDaily')}</Text>
            <Text className='rules-val'>{t('withdraw.rulesDailyVal')}</Text>
          </View>
          <View className='rules-row'>
            <Text className='rules-label'>{t('withdraw.rulesProcess')}</Text>
            <Text className='rules-val'>{t('withdraw.rulesProcessVal')}</Text>
          </View>
          <View className='rules-row'>
            <Text className='rules-label'>{t('withdraw.rulesArrival')}</Text>
            <Text className='rules-val'>{t('withdraw.rulesArrivalVal')}</Text>
          </View>
        </View>

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
                  onClick={() => this.setState({ selMethodId: m.id }, this.scheduleFeeRefresh)}
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
            onInput={e => this.setState({ amount: e.detail.value }, this.scheduleFeeRefresh)}
          />
          <Text className='amount-all' onClick={this.setAll}>
            {t('withdraw.all')}
          </Text>
        </View>
        <Text className='amount-hint'>{t('withdraw.minHint', { min: fmt(minAmount) })}</Text>

        {/* 费用预览 */}
        {valid && (
          <View className='preview-card'>
            <View className='pv-row'>
              <Text className='pv-label'>{t('withdraw.amount')}</Text>
              <Text className='pv-val'>¥{fmt(amt)} JPY</Text>
            </View>
            <View className='pv-row'>
              <Text className='pv-label'>{t('withdraw.fee')}</Text>
              <Text className={`pv-val ${fee === 0 ? 'free' : ''}`}>
                {fee === null ? '…' : fee === 0 ? t('withdraw.free') : `−¥${fmt(fee)}`}
              </Text>
            </View>
            {fi?.fxEffectiveRate && (
              <View className='pv-row'>
                <Text className='pv-label'>{t('withdraw.lockedRate')}</Text>
                <Text className='pv-val'>1 JPY = {fi.fxEffectiveRate} {fi.targetCurrency}</Text>
              </View>
            )}
            {fi?.fxEffectiveRate && (
              <Text className='pv-lock-note'>{t('withdraw.lockNote')}</Text>
            )}
            <View className='pv-row net'>
              <Text className='pv-label'>{t('withdraw.net')}</Text>
              <View className='pv-net-box'>
                <Text className='pv-net'>{net === null ? '…' : `¥${fmt(net)} JPY`}</Text>
                {fi?.targetAmount != null && (
                  <Text className='pv-cny'>{t('withdraw.targetEst', { n: fmt(fi.targetAmount), cur: fi.targetCurrency })}</Text>
                )}
              </View>
            </View>
          </View>
        )}
        {valid && <Text className='eta-line'>{t('withdraw.eta', { eta })}</Text>}

        <Text className='tax-notice'>{t('withdraw.taxNotice')}</Text>

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
