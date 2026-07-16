import { Component } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi } from '../../utils/api';
import './index.scss';

// ── 常量（对齐 herix.html addMethodHTML） ──
const REGIONS = [
  { id: 'japan', flag: '🇯🇵', name: '日本', sub: '银行振込' },
  { id: 'china', flag: '🇨🇳', name: '中国大陆', sub: '支付宝 · 微信支付' },
  { id: 'overseas', flag: '🌐', name: '其他地区', sub: '国际银行 · PayPal' },
];
const METHOD_MAP: Record<string, { id: string; icon: string; name: string; sub: string }[]> = {
  japan: [
    { id: 'BANK', icon: '🏦', name: '日本銀行振込', sub: '到账1-3个工作日，支持全国银行' },
    { id: 'CASH', icon: '💴', name: '現金受取', sub: '由工作人员当面支付' },
  ],
  china: [
    { id: 'ALIPAY', icon: '🔵', name: '支付宝', sub: '即时到账，手机号或账号收款' },
    { id: 'WECHAT', icon: '🟢', name: '微信支付', sub: '即时到账，微信号收款' },
    { id: 'BANK', icon: '🏦', name: '银行卡', sub: '1-3个工作日，中国大陆银行卡' },
  ],
  overseas: [
    { id: 'BANK', icon: '🏦', name: '国际银行转账', sub: 'SWIFT 汇款，3-5个工作日' },
    { id: 'PAYPAL', icon: '🅿️', name: 'PayPal', sub: '即时到账，邮箱收款' },
  ],
};
const REGION_NAMES: Record<string, string> = { japan: '日本', china: '中国大陆', overseas: '其他地区' };
const FORM_TITLES: Record<string, string> = { BANK: '银行账户', ALIPAY: '支付宝', WECHAT: '微信支付', PAYPAL: 'PayPal', CASH: '現金受取' };
const FORM_ICONS: Record<string, string> = { BANK: '🏦', ALIPAY: '🔵', WECHAT: '🟢', PAYPAL: '🅿️', CASH: '💴' };
const ACCT_TYPES = ['普通', '当座', '貯蓄'];

interface Field {
  kind: 'input' | 'picker' | 'note';
  label?: string;
  key?: string;
  ph?: string;
  req?: boolean;
  inputType?: 'text' | 'number';
  options?: string[];
  text?: string;
}

// 按 收款类型 + 地区 返回字段配置（对齐 herix STEP3）
function getFields(type: string, region: string): Field[] {
  if (type === 'CASH') {
    return [{ kind: 'note', text: '当面は現金受取でのお支払いとなります。詳細は後日ご連絡します。' }];
  }
  if (type === 'BANK' && region === 'japan') {
    return [
      { kind: 'input', label: '銀行名', key: 'm-bank', ph: '例：三菱UFJ銀行', req: true },
      { kind: 'input', label: '金融機関コード', key: 'm-jp-code', ph: '例：0001', req: true },
      { kind: 'input', label: '支店名', key: 'm-branch', ph: '例：新宿支店', req: false },
      { kind: 'input', label: '支店コード', key: 'm-branch-code', ph: '例：001', req: true },
      { kind: 'picker', label: '口座種別', key: 'm-acct-type', options: ACCT_TYPES },
      { kind: 'input', label: '口座番号', key: 'm-acct', ph: '例：1234567', req: true },
      { kind: 'input', label: '口座名義（カナ）', key: 'm-name', ph: '例：アリス ワン', req: true },
    ];
  }
  if (type === 'BANK') {
    return [
      { kind: 'input', label: '银行名称', key: 'm-bank', ph: '例：中国银行', req: true },
      { kind: 'input', label: '账户号码', key: 'm-acct', ph: '例：6222 0000 0000 0000', req: true },
      { kind: 'input', label: '账户名（英文）', key: 'm-name', ph: '例：ALICE WANG', req: true },
      { kind: 'input', label: 'SWIFT / BIC', key: 'm-swift', ph: '例：BKCHCNBJ', req: true },
    ];
  }
  if (type === 'ALIPAY') return [{ kind: 'input', label: '支付宝账号', key: 'm-alipay-acct', ph: '手机号或邮箱', req: true }];
  if (type === 'WECHAT') return [{ kind: 'input', label: '微信号 / 手机号', key: 'm-wechat-id', ph: 'WeChat ID 或绑定手机号', req: true }];
  if (type === 'PAYPAL') return [{ kind: 'input', label: 'PayPal 邮箱', key: 'm-email', ph: 'you@example.com', req: true }];
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
      Taro.showToast({ title: '请填写收款方式名称', icon: 'none' });
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
      Taro.showToast({ title: '已添加', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 700);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '添加失败', icon: 'none' });
      this.setState({ saving: false });
    }
  };

  renderBack() {
    const { step } = this.state;
    const label = step === 'region' ? '← 返回钱包' : step === 'type' ? '← 选择其他地区' : '← 选择其他方式';
    return (
      <Text className='back-link' onClick={this.goBack}>
        {label}
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
            <Text className='step-title'>选择收款地区</Text>
            <Text className='step-sub'>我们根据地区为你匹配合适的收款方式</Text>
            {REGIONS.map(r => (
              <View key={r.id} className='choice-card' onClick={() => this.pickRegion(r.id)}>
                <Text className='choice-flag'>{r.flag}</Text>
                <View className='choice-info'>
                  <Text className='choice-name'>{r.name}</Text>
                  <Text className='choice-sub'>{r.sub}</Text>
                </View>
                <Text className='choice-arrow'>›</Text>
              </View>
            ))}
          </View>
        )}

        {/* STEP 2: 选择方式 */}
        {step === 'type' && (
          <View>
            <Text className='step-title'>选择收款方式</Text>
            <Text className='step-sub'>收款地区：{REGION_NAMES[region] || region}</Text>
            {(METHOD_MAP[region] || METHOD_MAP.overseas).map(m => (
              <View key={m.id} className='choice-card' onClick={() => this.pickType(m.id)}>
                <Text className='choice-icon'>{m.icon}</Text>
                <View className='choice-info'>
                  <Text className='choice-name'>{m.name}</Text>
                  <Text className='choice-sub'>{m.sub}</Text>
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
              <Text className='form-head-title'>{FORM_TITLES[type] || type}</Text>
            </View>

            {getFields(type, region).map((f, i) => {
              if (f.kind === 'note') {
                return (
                  <View key={i} className='cash-note'>
                    {f.text}
                  </View>
                );
              }
              if (f.kind === 'picker') {
                const idx = Math.max(0, f.options!.indexOf(form[f.key!] || f.options![0]));
                return (
                  <View key={f.key} className='ig'>
                    <Text className='ig-label'>{f.label}</Text>
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
                    {f.label}
                    {f.req && <Text className='req-star'> *</Text>}
                  </Text>
                  <Input
                    className='ig-input'
                    type={f.inputType === 'number' ? 'number' : 'text'}
                    placeholder={f.ph}
                    value={form[f.key!] || ''}
                    onInput={e => this.setField(f.key!, e.detail.value)}
                  />
                </View>
              );
            })}

            {/* 收款方式名称 */}
            <View className='ig'>
              <Text className='ig-label'>
                收款方式名称<Text className='req-star'> *</Text>
              </Text>
              <Input
                className='ig-input'
                placeholder={type === 'BANK' && region === 'japan' ? '例：三菱UFJ銀行' : '例：我的支付宝'}
                value={form['method-label'] || ''}
                onInput={e => this.setField('method-label', e.detail.value)}
              />
            </View>

            {/* 默认 */}
            <View className='default-row' onClick={() => this.setState({ isDefault: !isDefault })}>
              <View className={`checkbox ${isDefault ? 'checked' : ''}`}>{isDefault ? '✓' : ''}</View>
              <Text className='default-label'>设为默认收款方式</Text>
            </View>

            <View className={`btn-primary ${saving ? 'disabled' : ''}`} onClick={saving ? undefined : this.save}>
              {saving ? '保存中...' : '保存'}
            </View>
          </View>
        )}
      </View>
    );
  }
}
