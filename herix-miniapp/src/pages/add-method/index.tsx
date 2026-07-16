import { Component } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';

// ── 常量存 key，渲染时 t() 取值（对齐 herix.html addMethodHTML）──
const REGIONS = [
  { id: 'japan', flag: '🇯🇵', nameKey: 'addMethod.region.japan', subKey: 'addMethod.region.japanSub' },
  { id: 'china', flag: '🇨🇳', nameKey: 'addMethod.region.china', subKey: 'addMethod.region.chinaSub' },
  { id: 'overseas', flag: '🌐', nameKey: 'addMethod.region.overseas', subKey: 'addMethod.region.overseasSub' },
];
const METHOD_MAP: Record<string, { id: string; icon: string; nameKey: string; subKey: string }[]> = {
  japan: [
    { id: 'BANK', icon: '🏦', nameKey: 'addMethod.m.jpBank', subKey: 'addMethod.m.jpBankSub' },
    { id: 'CASH', icon: '💴', nameKey: 'addMethod.m.cash', subKey: 'addMethod.m.cashSub' },
  ],
  china: [
    { id: 'ALIPAY', icon: '🔵', nameKey: 'addMethod.m.alipay', subKey: 'addMethod.m.alipaySub' },
    { id: 'WECHAT', icon: '🟢', nameKey: 'addMethod.m.wechat', subKey: 'addMethod.m.wechatSub' },
    { id: 'BANK', icon: '🏦', nameKey: 'addMethod.m.cnBank', subKey: 'addMethod.m.cnBankSub' },
  ],
  overseas: [
    { id: 'BANK', icon: '🏦', nameKey: 'addMethod.m.intlBank', subKey: 'addMethod.m.intlBankSub' },
    { id: 'PAYPAL', icon: '🅿️', nameKey: 'addMethod.m.paypal', subKey: 'addMethod.m.paypalSub' },
  ],
};
// 表单标题复用 wallet.methodType.* 词条
const FORM_TITLE_KEYS: Record<string, string> = {
  BANK: 'wallet.methodType.BANK',
  ALIPAY: 'wallet.methodType.ALIPAY',
  WECHAT: 'wallet.methodType.WECHAT',
  PAYPAL: 'wallet.methodType.PAYPAL',
  CASH: 'wallet.cashReceive',
};
const FORM_ICONS: Record<string, string> = { BANK: '🏦', ALIPAY: '🔵', WECHAT: '🟢', PAYPAL: '🅿️', CASH: '💴' };
// 口座種別是银行域术语且直接落库（account_details.account_type），不做翻译
const ACCT_TYPES = ['普通', '当座', '貯蓄'];

interface Field {
  kind: 'input' | 'picker' | 'note';
  labelKey?: string;
  key?: string;
  phKey?: string;
  req?: boolean;
  options?: string[];
  noteKey?: string;
}

// 按 收款类型 + 地区 返回字段配置（label/placeholder 均为词条 key）
function getFields(type: string, region: string): Field[] {
  if (type === 'CASH') {
    return [{ kind: 'note', noteKey: 'addMethod.cashNote' }];
  }
  if (type === 'BANK' && region === 'japan') {
    return [
      { kind: 'input', labelKey: 'addMethod.f.jpBankName', key: 'm-bank', phKey: 'addMethod.ph.jpBank', req: true },
      { kind: 'input', labelKey: 'addMethod.f.jpBankCode', key: 'm-jp-code', phKey: 'addMethod.ph.jpCode', req: true },
      { kind: 'input', labelKey: 'addMethod.f.branch', key: 'm-branch', phKey: 'addMethod.ph.branch', req: false },
      { kind: 'input', labelKey: 'addMethod.f.branchCode', key: 'm-branch-code', phKey: 'addMethod.ph.branchCode', req: true },
      { kind: 'picker', labelKey: 'addMethod.f.acctType', key: 'm-acct-type', options: ACCT_TYPES },
      { kind: 'input', labelKey: 'addMethod.f.acctNo', key: 'm-acct', phKey: 'addMethod.ph.jpAcctNo', req: true },
      { kind: 'input', labelKey: 'addMethod.f.acctName', key: 'm-name', phKey: 'addMethod.ph.jpAcctName', req: true },
    ];
  }
  if (type === 'BANK') {
    return [
      { kind: 'input', labelKey: 'addMethod.f.cnBankName', key: 'm-bank', phKey: 'addMethod.ph.cnBank', req: true },
      { kind: 'input', labelKey: 'addMethod.f.cnAcctNo', key: 'm-acct', phKey: 'addMethod.ph.cnAcctNo', req: true },
      { kind: 'input', labelKey: 'addMethod.f.cnAcctName', key: 'm-name', phKey: 'addMethod.ph.cnAcctName', req: true },
      { kind: 'input', labelKey: 'addMethod.f.swift', key: 'm-swift', phKey: 'addMethod.ph.swift', req: true },
    ];
  }
  if (type === 'ALIPAY') return [{ kind: 'input', labelKey: 'addMethod.f.alipay', key: 'm-alipay-acct', phKey: 'addMethod.ph.alipay', req: true }];
  if (type === 'WECHAT') return [{ kind: 'input', labelKey: 'addMethod.f.wechat', key: 'm-wechat-id', phKey: 'addMethod.ph.wechat', req: true }];
  if (type === 'PAYPAL') return [{ kind: 'input', labelKey: 'addMethod.f.paypal', key: 'm-email', phKey: 'addMethod.ph.paypal', req: true }];
  return [];
}

interface State {
  step: 'region' | 'type' | 'form';
  region: string;
  type: string;
  form: Record<string, string>;
  isDefault: boolean;
  saving: boolean;
}

export default class AddMethod extends Component<{}, State> {
  state: State = {
    step: 'region',
    region: '',
    type: '',
    form: {},
    isDefault: false,
    saving: false,
  };

  goBack = () => {
    const { step } = this.state;
    if (step === 'form') this.setState({ step: 'type' });
    else if (step === 'type') this.setState({ step: 'region' });
    else Taro.navigateBack();
  };

  pickRegion = (region: string) => this.setState({ region, step: 'type' });

  pickType = (type: string) => {
    // 进表单前预置口座種別默认值
    const form = { ...this.state.form };
    if (type === 'BANK' && this.state.region === 'japan' && !form['m-acct-type']) form['m-acct-type'] = ACCT_TYPES[0];
    this.setState({ type, step: 'form', form });
  };

  setField = (key: string, val: string) => this.setState({ form: { ...this.state.form, [key]: val } });

  save = async () => {
    const { region, type, form, isDefault } = this.state;
    const g = (k: string) => (form[k] || '').trim();
    let label = g('method-label');
    if (!label && type !== 'CASH') {
      Taro.showToast({ title: t('addMethod.errLabel'), icon: 'none' });
      return;
    }

    const details: any = {};
    if (type === 'CASH') {
      details.method = '現金';
      label = label || '現金受取';
    } else if (type === 'BANK' && region === 'japan') {
      details.bank_code = g('m-jp-code');
      details.bank_name = g('m-bank');
      details.branch_code = g('m-branch-code');
      details.branch = g('m-branch');
      details.account_type = form['m-acct-type'] || '普通';
      details.account_number = g('m-acct');
      details.account_name = g('m-name');
    } else if (type === 'BANK') {
      details.bank_name = g('m-bank');
      details.account_number = g('m-acct');
      details.account_name = g('m-name');
      details.swift_code = g('m-swift');
    } else if (type === 'PAYPAL') {
      details.email = g('m-email');
    } else if (type === 'WECHAT') {
      details.wechat_id = g('m-wechat-id');
    } else if (type === 'ALIPAY') {
      details.account = g('m-alipay-acct');
    }

    const country = ({ japan: 'JP', china: 'CN', overseas: '' } as Record<string, string>)[region] || '';

    this.setState({ saving: true });
    try {
      await walletApi.addMethod({ type, country, label, account_details: details, is_default: isDefault });
      Taro.showToast({ title: t('addMethod.added'), icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 700);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('addMethod.addFailed'), icon: 'none' });
      this.setState({ saving: false });
    }
  };

  renderBack() {
    const { step } = this.state;
    const key = step === 'region' ? 'addMethod.backWallet' : step === 'type' ? 'addMethod.backRegion' : 'addMethod.backType';
    return (
      <Text className='back-link' onClick={this.goBack}>
        {t(key)}
      </Text>
    );
  }

  render() {
    const { step, region, type, form, isDefault, saving } = this.state;

    return (
      <View className='add-method-page'>
        {this.renderBack()}

        {/* STEP 1: 选择地区 */}
        {step === 'region' && (
          <View>
            <Text className='step-title'>{t('addMethod.step1Title')}</Text>
            <Text className='step-sub'>{t('addMethod.step1Sub')}</Text>
            {REGIONS.map(r => (
              <View key={r.id} className='choice-card' onClick={() => this.pickRegion(r.id)}>
                <Text className='choice-flag'>{r.flag}</Text>
                <View className='choice-info'>
                  <Text className='choice-name'>{t(r.nameKey)}</Text>
                  <Text className='choice-sub'>{t(r.subKey)}</Text>
                </View>
                <Text className='choice-arrow'>›</Text>
              </View>
            ))}
          </View>
        )}

        {/* STEP 2: 选择方式 */}
        {step === 'type' && (
          <View>
            <Text className='step-title'>{t('addMethod.step2Title')}</Text>
            <Text className='step-sub'>
              {t('addMethod.step2Sub', { region: t(REGIONS.find(r => r.id === region)?.nameKey || 'addMethod.region.overseas') })}
            </Text>
            {(METHOD_MAP[region] || METHOD_MAP.overseas).map(m => (
              <View key={m.id} className='choice-card' onClick={() => this.pickType(m.id)}>
                <Text className='choice-icon'>{m.icon}</Text>
                <View className='choice-info'>
                  <Text className='choice-name'>{t(m.nameKey)}</Text>
                  <Text className='choice-sub'>{t(m.subKey)}</Text>
                </View>
                <Text className='choice-arrow'>›</Text>
              </View>
            ))}
          </View>
        )}

        {/* STEP 3: 填写信息 */}
        {step === 'form' && (
          <View>
            <View className='form-head'>
              <Text className='form-head-icon'>{FORM_ICONS[type] || '💳'}</Text>
              <Text className='form-head-title'>{t(FORM_TITLE_KEYS[type] || 'wallet.methodType.BANK')}</Text>
            </View>

            {getFields(type, region).map((f, i) => {
              if (f.kind === 'note') {
                return (
                  <View key={i} className='cash-note'>
                    {t(f.noteKey!)}
                  </View>
                );
              }
              if (f.kind === 'picker') {
                const idx = Math.max(0, f.options!.indexOf(form[f.key!] || f.options![0]));
                return (
                  <View key={f.key} className='ig'>
                    <Text className='ig-label'>{t(f.labelKey!)}</Text>
                    <Picker
                      mode='selector'
                      range={f.options!}
                      value={idx}
                      onChange={e => this.setField(f.key!, f.options![Number(e.detail.value)])}
                    >
                      <View className='ig-picker'>{form[f.key!] || f.options![0]}</View>
                    </Picker>
                  </View>
                );
              }
              return (
                <View key={f.key} className='ig'>
                  <Text className='ig-label'>
                    {t(f.labelKey!)}
                    {f.req && <Text className='req-star'> *</Text>}
                  </Text>
                  <Input
                    className='ig-input'
                    type='text'
                    placeholder={t(f.phKey!)}
                    value={form[f.key!] || ''}
                    onInput={e => this.setField(f.key!, e.detail.value)}
                  />
                </View>
              );
            })}

            {/* 收款方式名称 */}
            <View className='ig'>
              <Text className='ig-label'>
                {t('addMethod.labelField')}<Text className='req-star'> *</Text>
              </Text>
              <Input
                className='ig-input'
                placeholder={t(type === 'BANK' && region === 'japan' ? 'addMethod.ph.labelJp' : 'addMethod.ph.labelDefault')}
                value={form['method-label'] || ''}
                onInput={e => this.setField('method-label', e.detail.value)}
              />
            </View>

            {/* 默认 */}
            <View className='default-row' onClick={() => this.setState({ isDefault: !isDefault })}>
              <View className={`checkbox ${isDefault ? 'checked' : ''}`}>{isDefault ? '✓' : ''}</View>
              <Text className='default-label'>{t('addMethod.setDefault')}</Text>
            </View>

            <View className={`btn-primary ${saving ? 'disabled' : ''}`} onClick={saving ? undefined : this.save}>
              {saving ? t('common.saving') : t('common.save')}
            </View>
          </View>
        )}
      </View>
    );
  }
}
