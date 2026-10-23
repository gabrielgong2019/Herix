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
  bankAccounts: any[];
  methods: any[];
  /** 服务端费用预览（阶梯手续费 + 跨境锁价汇率） */
  feeInfo: any;
  /** 费用预览失败信息（如 AMOUNT_TOO_LOW 时带 fee，用于禁用按钮并提示差额） */
  feeErr: { code?: string; fee?: number } | null;
  selBankAccountId: string;
  selMethodId: string;
  amount: string;
  submitting: boolean;
}

// 2026-08 微信审核：取消最低提现门槛。唯一下限是算术性的"到手金额 > 0"
// （提现金额须大于手续费），由服务端 AMOUNT_TOO_LOW 裁决，前端据此禁用提交。

export default class Withdraw extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    balance: {},
    bankAccounts: [],
    methods: [],
    feeInfo: null,
    feeErr: null,
    selBankAccountId: '',
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
      const [bal, bankAccounts, methods] = await Promise.all([
        walletApi.balance(),
        walletApi.bankAccounts().catch(() => [] as any[]),
        walletApi.methods(),
      ]);
      const baList = bankAccounts || [];
      const mList = methods || [];
      this.setState({
        balance: bal || {},
        bankAccounts: baList,
        methods: mList,
        selBankAccountId: this.state.selBankAccountId || (baList[0]?.id ?? ''),
        selMethodId: this.state.selMethodId || (mList[0]?.id ?? ''),
        loading: false,
      });
    } catch (err) {
      console.error('load withdraw data error:', err);
      this.setState({ loading: false });
    }
  };

  goAddMethod = () => Taro.navigateTo({ url: '/pages/add-method/index' });
  goAddBankAccount = () => Taro.navigateTo({ url: '/pages/add-bank-account/index' });

  feeTimer: ReturnType<typeof setTimeout> | null = null;

  /** 金额/收款方式变化后 400ms 拉服务端费用预览 */
  scheduleFeeRefresh = () => {
    if (this.feeTimer) clearTimeout(this.feeTimer);
    this.feeTimer = setTimeout(async () => {
      const { amount, methods, selMethodId } = this.state;
      const amt = parseFloat(amount) || 0;
      const sel = methods.find(m => m.id === selMethodId) || methods[0];
      if (!sel || amt <= 0) { this.setState({ feeInfo: null, feeErr: null }); return; }
      try {
        const info = await walletApi.withdrawalInfo(amt, sel.id);
        this.setState({ feeInfo: info, feeErr: null });
      } catch (err: any) {
        // AMOUNT_TOO_LOW 等：服务端 body 里带 code/fee（ApiError.data）
        this.setState({ feeInfo: null, feeErr: err?.data || {} });
      }
    }, 400);
  };

  setAll = () => {
    const avail = this.state.balance.available || 0;
    this.setState({ amount: String(avail) });
  };

  submit = async () => {
    const { bankAccounts, selBankAccountId, methods, selMethodId, amount } = this.state;
    const selBA = bankAccounts.find(a => a.id === selBankAccountId);
    const selMethod = methods.find(m => m.id === selMethodId);

    // 优先用银行账户（Airwallex 通道），无银行账户时回落到旧收款方式
    if (!selBA && !selMethod) {
      Taro.showToast({ title: t('withdraw.errSelect'), icon: 'none' });
      return;
    }
    const amt = parseFloat(amount) || 0;
    this.setState({ submitting: true });
    try {
      if (selBA) {
        await walletApi.withdrawRequest({ amount: amt, bankAccountId: selBA.id });
      } else {
        const detail = selMethod.account_details || {};
        await walletApi.withdrawRequest({
          amount: amt,
          method: selMethod.type,
          methodId: selMethod.id,
          accountDetails: detail,
        });
      }
      // icon:'none' 才能完整显示长文案（success 图标模式下 title 超 7 字被截断）
      Taro.showToast({ title: t('withdraw.success'), icon: 'none', duration: 2500 });
      setTimeout(() => Taro.navigateBack(), 1600);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('withdraw.failed'), icon: 'none' });
      this.setState({ submitting: false });
    }
  };

  /** 提现规则卡（无门槛版）：空态与主路径共用同一份 */
  renderRules = () => (
    <View className='rules-card'>
      <Text className='rules-title'>{t('withdraw.rulesTitle')}</Text>
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
      <View className='rules-row'>
        <Text className='rules-label'>{t('withdraw.rulesFee')}</Text>
        <Text className='rules-val'>{t('withdraw.rulesFeeVal')}</Text>
      </View>
    </View>
  );

  render() {
    const { loading, loggedIn, balance: bal, bankAccounts, methods, selBankAccountId, selMethodId, amount, submitting, feeErr } = this.state;

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
    const hasAny = bankAccounts.length > 0 || methods.length > 0;

    // 无任何收款方式空态
    if (!hasAny) {
      return (
        <View className='withdraw-page'>
          <BackBar />
          <Text className='avail-line'>
            {t('withdraw.availPrefix')} <Text className='avail-strong'>¥{fmt(avail)}</Text>
          </Text>
          {this.renderRules()}
          <View className='no-method'>
            <Text className='nm-icon'>💳</Text>
            <Text className='nm-title'>{t('withdraw.noMethod')}</Text>
            <Text className='nm-sub'>{t('withdraw.noMethodSub')}</Text>
            <View className='btn-primary' onClick={this.goAddBankAccount}>
              {t('withdraw.addMethod')}
            </View>
          </View>
        </View>
      );
    }

    const selBA = bankAccounts.find(a => a.id === selBankAccountId);
    const sel = selBA ? null : (methods.find(m => m.id === selMethodId) || methods[0]);
    const amt = parseFloat(amount) || 0;
    const fi = this.state.feeInfo;
    const fee = fi ? fi.fee : null;
    const net = fi ? fi.netAmount : null;
    // 银行账户走 Airwallex，无需服务端费用预览；旧方式仍需预览
    const validBA = selBA && amt > 0 && amt <= avail;
    const validMethod = !selBA && amt > 0 && amt <= avail && net !== null && net > 0;
    const valid = validBA || validMethod;
    const eta = t(sel ? METHOD_ETA_KEYS[sel.type] || 'withdraw.etaBank' : 'withdraw.etaBank');

    let btnText = t('withdraw.btnEnter');
    if (amt > avail) btnText = t('withdraw.btnExceed');
    else if (valid) btnText = t('withdraw.btnConfirm', { n: fmt(selBA ? amt : (net ?? 0)) });

    return (
      <View className='withdraw-page'>
        <BackBar />
        <Text className='avail-line'>
          {t('withdraw.availPrefix')} <Text className='avail-strong'>¥{fmt(avail)}</Text>
        </Text>

        {/* 提现规则（审核要求：明确展示规则；无起提门槛） */}
        {this.renderRules()}

        {/* 银行账户区（Airwallex JPY，优先显示） */}
        <Text className='field-label'>{t('withdraw.bankSection')}</Text>
        <ScrollView scrollX className='method-scroll'>
          <View className='method-track'>
            {bankAccounts.map(ba => {
              const active = ba.id === selBankAccountId;
              const label = ba.nickname || `${ba.bank_code}-${ba.branch_code}`;
              const sub = `****${ba.account_number.slice(-4)}`;
              return (
                <View
                  key={ba.id}
                  className={`method-card ${active ? 'active' : ''}`}
                  onClick={() => this.setState({ selBankAccountId: ba.id, selMethodId: '' })}
                >
                  <Text className='mc-icon'>🏦</Text>
                  <Text className='mc-label'>{label}</Text>
                  <Text className='mc-sub'>{sub}</Text>
                  {active && <Text className='mc-check'>{t('withdraw.selected')}</Text>}
                </View>
              );
            })}
            <View className='method-card add' onClick={this.goAddBankAccount}>
              <Text className='mc-add-plus'>+</Text>
              <Text className='mc-add-text'>{t('withdraw.addBankAccount')}</Text>
            </View>
          </View>
        </ScrollView>

        {/* 其他收款方式（旧通道，次要） */}
        {methods.length > 0 && (
          <View>
            <Text className='field-label'>{t('wallet.methods')}</Text>
            <ScrollView scrollX className='method-scroll'>
              <View className='method-track'>
                {methods.map(m => {
                  const d = m.account_details || {};
                  let sub = d.wechat_id || d.account || d.account_number || d.email || '';
                  if (sub.length > 14) sub = sub.slice(0, 14) + '…';
                  const active = !selBankAccountId && m.id === (sel && sel.id);
                  return (
                    <View
                      key={m.id}
                      className={`method-card ${active ? 'active' : ''}`}
                      onClick={() => this.setState({ selMethodId: m.id, selBankAccountId: '' }, this.scheduleFeeRefresh)}
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
          </View>
        )}

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
