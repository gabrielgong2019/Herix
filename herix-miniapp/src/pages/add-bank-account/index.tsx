import { Component } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';
import BackBar from '../../components/BackBar';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'SGD', 'CAD', 'HKD'];
const CURRENCY_COUNTRIES: Record<string, string> = {
  USD: 'US', EUR: 'DE', GBP: 'GB', AUD: 'AU', SGD: 'SG', CAD: 'CA', HKD: 'HK',
};
const ACCT_CATEGORIES = ['Savings', 'Checking'];
const ACCT_CATEGORY_LABELS = ['普通（Savings）', '当座（Checking）'];

const CN_METHODS = [
  { id: 'bank', flag: '🏦', name: '银行转账', sub: 'CNAPS 联行号 · CNY' },
  { id: 'wechat', flag: '💚', name: '微信支付', sub: '绑定微信收款', comingSoon: true },
  { id: 'alipay', flag: '🟦', name: '支付宝', sub: '绑定支付宝账户', comingSoon: true },
];

interface State {
  step: 1 | 2 | 3;
  country: string;
  last_name: string;
  first_name: string;
  account_name: string;
  bank_code: string;
  branch_code: string;
  account_category: string;
  account_number: string;
  account_currency: string;
  address_city: string;
  address_street: string;
  address_postcode: string;
  nickname: string;
  is_default: boolean;
  saving: boolean;
}

export default class AddBankAccount extends Component<{}, State> {
  state: State = {
    step: 1,
    country: 'JP',
    last_name: '',
    first_name: '',
    account_name: '',
    bank_code: '',
    branch_code: '',
    account_category: 'Savings',
    account_number: '',
    account_currency: 'USD',
    address_city: '',
    address_street: '',
    address_postcode: '',
    nickname: '',
    is_default: false,
    saving: false,
  };

  set = (key: keyof State, val: string) => this.setState({ [key]: val } as any);

  selectRegion = (id: string) => {
    const resetFields = { bank_code: '', branch_code: '', account_number: '', account_currency: 'USD' };
    if (id === 'CN') {
      this.setState({ country: id, ...resetFields, step: 2 });
    } else {
      this.setState({ country: id, ...resetFields, step: 3 });
    }
  };

  goBack = () => {
    const { step, country } = this.state;
    if (step === 3 && country === 'CN') {
      this.setState({ step: 2 });
    } else {
      this.setState({ step: 1 });
    }
  };

  save = async () => {
    const {
      country, last_name, first_name, account_name,
      bank_code, branch_code, account_number, account_category, account_currency,
      address_city, address_street, address_postcode,
      nickname, is_default,
    } = this.state;
    const isJP = country === 'JP';
    const isCN = country === 'CN';
    const isOther = !isJP && !isCN;

    if (!last_name.trim() || !first_name.trim()) {
      Taro.showToast({ title: t('addBankAccount.errName'), icon: 'none' }); return;
    }
    if (!account_name.trim()) {
      Taro.showToast({ title: t('addBankAccount.errAcctName'), icon: 'none' }); return;
    }

    if (isJP) {
      if (!/^\d{4}$/.test(bank_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errBankCode'), icon: 'none' }); return;
      }
      if (!/^\d{3}$/.test(branch_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errBranchCode'), icon: 'none' }); return;
      }
      if (!/^\d{7}$/.test(account_number.trim())) {
        Taro.showToast({ title: t('addBankAccount.errAcctNo'), icon: 'none' }); return;
      }
    } else if (isCN) {
      if (!/^\d{12}$/.test(bank_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errCnaps'), icon: 'none' }); return;
      }
      if (!/^\d{16,19}$/.test(account_number.trim())) {
        Taro.showToast({ title: t('addBankAccount.errCnAcctNo'), icon: 'none' }); return;
      }
    } else {
      if (!/^[A-Z0-9]{8,11}$/i.test(bank_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errSwift'), icon: 'none' }); return;
      }
      if (!account_number.trim() || account_number.trim().length < 4) {
        Taro.showToast({ title: t('addBankAccount.errOverseasAcctNo'), icon: 'none' }); return;
      }
      if (!address_city.trim() || !address_street.trim() || !address_postcode.trim()) {
        Taro.showToast({ title: t('addBankAccount.errAddress'), icon: 'none' }); return;
      }
    }

    const addrCountry = isOther ? (CURRENCY_COUNTRIES[account_currency] || country) : country;

    this.setState({ saving: true });
    try {
      await walletApi.addBankAccount({
        address_country: addrCountry,
        last_name: last_name.trim(),
        first_name: first_name.trim(),
        account_name: account_name.trim(),
        bank_code: bank_code.trim().toUpperCase(),
        branch_code: isJP ? branch_code.trim() : '',
        account_number: account_number.trim(),
        account_category: isJP ? account_category : 'Savings',
        account_currency: isOther ? account_currency : undefined,
        address_city: isOther ? address_city.trim() : '',
        address_street: isOther ? address_street.trim() : '',
        address_postcode: isOther ? address_postcode.trim() : '',
        nickname: nickname.trim(),
        is_default,
      });
      Taro.showToast({ title: t('addBankAccount.added'), icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 700);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('addBankAccount.failed'), icon: 'none' });
      this.setState({ saving: false });
    }
  };

  renderStep1() {
    return (
      <View>
        <Text className='aba-step-title'>{t('addBankAccount.title')}</Text>
        <Text className='aba-step-sub'>{t('addBankAccount.sub')}</Text>
        {[
          { id: 'JP', flag: '🇯🇵', name: '日本', sub: 'Local 银行振込 · JPY' },
          { id: 'CN', flag: '🇨🇳', name: '中国大陆', sub: 'CNAPS / 微信 / 支付宝' },
          { id: 'OTHER', flag: '🌐', name: '其他地区', sub: 'SWIFT / IBAN 国际汇款' },
        ].map(r => (
          <View key={r.id} className='aba-choice-card' onClick={() => this.selectRegion(r.id)}>
            <Text className='aba-choice-flag'>{r.flag}</Text>
            <View className='aba-choice-info'>
              <Text className='aba-choice-name'>{r.name}</Text>
              <Text className='aba-choice-sub'>{r.sub}</Text>
            </View>
            <Text className='aba-choice-arrow'>›</Text>
          </View>
        ))}
      </View>
    );
  }

  renderStep2() {
    return (
      <View>
        <View className='aba-back-step' onClick={this.goBack}>
          <Text className='aba-back-step-text'>‹ {t('addBankAccount.changeRegion')}</Text>
        </View>
        <View className='aba-form-head'>
          <Text className='aba-form-head-flag'>🇨🇳</Text>
          <View>
            <Text className='aba-form-head-name'>中国大陆</Text>
            <Text className='aba-form-head-sub'>选择收款方式</Text>
          </View>
        </View>
        {CN_METHODS.map(m => (
          <View
            key={m.id}
            className={`aba-choice-card${m.comingSoon ? ' aba-choice-disabled' : ''}`}
            onClick={() => { if (!m.comingSoon) this.setState({ step: 3 }); }}
          >
            <Text className='aba-choice-flag'>{m.flag}</Text>
            <View className='aba-choice-info'>
              <Text className='aba-choice-name'>{m.name}</Text>
              <Text className='aba-choice-sub'>{m.sub}</Text>
            </View>
            {m.comingSoon
              ? <Text className='aba-coming-soon'>敬请期待</Text>
              : <Text className='aba-choice-arrow'>›</Text>
            }
          </View>
        ))}
      </View>
    );
  }

  renderStep3() {
    const {
      country, last_name, first_name, account_name,
      bank_code, branch_code, account_number, account_category, account_currency,
      address_city, address_street, address_postcode,
      nickname, is_default, saving,
    } = this.state;
    const isJP = country === 'JP';
    const isCN = country === 'CN';
    const isOther = !isJP && !isCN;
    const catIdx = ACCT_CATEGORIES.indexOf(account_category);
    const currIdx = CURRENCIES.indexOf(account_currency);

    const regionMap: Record<string, { flag: string; name: string; sub: string }> = {
      JP: { flag: '🇯🇵', name: '日本', sub: 'Local 银行振込 · JPY' },
      CN: { flag: '🇨🇳', name: '中国大陆 · 银行转账', sub: 'CNAPS 联行号 · CNY' },
      OTHER: { flag: '🌐', name: '其他地区', sub: 'SWIFT / IBAN 国际汇款' },
    };
    const region = regionMap[country] || regionMap['OTHER'];

    return (
      <View>
        <View className='aba-back-step' onClick={this.goBack}>
          <Text className='aba-back-step-text'>‹ {isCN ? '返回收款方式' : t('addBankAccount.changeRegion')}</Text>
        </View>

        <View className='aba-form-head'>
          <Text className='aba-form-head-flag'>{region.flag}</Text>
          <View>
            <Text className='aba-form-head-name'>{region.name}</Text>
            <Text className='aba-form-head-sub'>{region.sub}</Text>
          </View>
        </View>

        {/* 货币（仅 OTHER） */}
        {isOther && (
          <View className='ig'>
            <Text className='ig-label'>{t('addBankAccount.currency')} <Text className='req-star'>*</Text></Text>
            <Picker mode='selector' range={CURRENCIES} value={currIdx}
              onChange={e => this.setState({ account_currency: CURRENCIES[Number(e.detail.value)] })}>
              <View className='ig-picker'>{account_currency}</View>
            </Picker>
          </View>
        )}

        {/* 姓名 */}
        {(isJP || isOther) && (
          <Text className='ig-hint' style='margin-bottom:16px'>{t('addBankAccount.acctNameHint2')}</Text>
        )}
        <View className='ig-row'>
          <View className='ig ig-half'>
            <Text className='ig-label'>{t('addBankAccount.lastName')} <Text className='req-star'>*</Text></Text>
            <Input className='ig-input' value={last_name}
              placeholder={isJP ? 'YAMADA' : isOther ? 'SMITH' : 'ZHANG'}
              onInput={e => this.set('last_name', e.detail.value)} />
          </View>
          <View className='ig ig-half'>
            <Text className='ig-label'>{t('addBankAccount.firstName')} <Text className='req-star'>*</Text></Text>
            <Input className='ig-input' value={first_name}
              placeholder={isJP ? 'TARO' : isOther ? 'JOHN' : 'WEI'}
              onInput={e => this.set('first_name', e.detail.value)} />
          </View>
        </View>

        {/* 口座名義 / 账户名 */}
        <View className='ig'>
          <Text className='ig-label'>
            {isCN ? t('addBankAccount.cnAcctName') : t('addBankAccount.acctName')}
            <Text className='req-star'> *</Text>
          </Text>
          <Text className='ig-hint'>
            {isCN ? t('addBankAccount.cnAcctNameHint') : t('addBankAccount.acctNameHint')}
          </Text>
          <Input className='ig-input' value={account_name}
            placeholder={isJP ? 'ヤマダ タロウ' : isCN ? '张伟' : 'JOHN SMITH'}
            onInput={e => this.set('account_name', e.detail.value)} />
        </View>

        {/* 日本字段 */}
        {isJP && (
          <View>
            <View className='ig-row'>
              <View className='ig ig-half'>
                <Text className='ig-label'>{t('addBankAccount.bankCode')} <Text className='req-star'>*</Text></Text>
                <Input className='ig-input' type='number' value={bank_code} placeholder='0001'
                  maxlength={4} onInput={e => this.set('bank_code', e.detail.value)} />
              </View>
              <View className='ig ig-half'>
                <Text className='ig-label'>{t('addBankAccount.branchCode')} <Text className='req-star'>*</Text></Text>
                <Input className='ig-input' type='number' value={branch_code} placeholder='001'
                  maxlength={3} onInput={e => this.set('branch_code', e.detail.value)} />
              </View>
            </View>
            <View className='ig-row'>
              <View className='ig ig-half'>
                <Text className='ig-label'>{t('addBankAccount.acctNo')} <Text className='req-star'>*</Text></Text>
                <Input className='ig-input' type='number' value={account_number} placeholder='1234567'
                  maxlength={7} onInput={e => this.set('account_number', e.detail.value)} />
              </View>
              <View className='ig ig-half'>
                <Text className='ig-label'>{t('addBankAccount.acctType')}</Text>
                <Picker mode='selector' range={ACCT_CATEGORY_LABELS} value={catIdx}
                  onChange={e => this.setState({ account_category: ACCT_CATEGORIES[Number(e.detail.value)] })}>
                  <View className='ig-picker'>{ACCT_CATEGORY_LABELS[catIdx]}</View>
                </Picker>
              </View>
            </View>
          </View>
        )}

        {/* 中国字段 */}
        {isCN && (
          <View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.cnaps')} <Text className='req-star'>*</Text></Text>
              <Text className='ig-hint'>{t('addBankAccount.cnapsHint')}</Text>
              <Input className='ig-input' type='number' value={bank_code} placeholder='102100099996'
                maxlength={12} onInput={e => this.set('bank_code', e.detail.value)} />
            </View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.cnAcctNo')} <Text className='req-star'>*</Text></Text>
              <Input className='ig-input' type='number' value={account_number} placeholder='6222021001122334455'
                maxlength={19} onInput={e => this.set('account_number', e.detail.value)} />
            </View>
          </View>
        )}

        {/* 其他地区（SWIFT）字段 */}
        {isOther && (
          <View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.swift')} <Text className='req-star'>*</Text></Text>
              <Text className='ig-hint'>{t('addBankAccount.swiftHint')}</Text>
              <Input className='ig-input' value={bank_code} placeholder='CITIUS33XXX'
                maxlength={11} onInput={e => this.set('bank_code', e.detail.value.toUpperCase())} />
            </View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.overseasAcctNo')} <Text className='req-star'>*</Text></Text>
              <Input className='ig-input' value={account_number} placeholder='DE89370400440532013000'
                onInput={e => this.set('account_number', e.detail.value)} />
            </View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.postcode')} <Text className='req-star'>*</Text></Text>
              <Input className='ig-input' type='number' value={address_postcode} placeholder='10001'
                onInput={e => this.set('address_postcode', e.detail.value)} />
            </View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.city')} <Text className='req-star'>*</Text></Text>
              <Input className='ig-input' value={address_city} placeholder='New York'
                onInput={e => this.set('address_city', e.detail.value)} />
            </View>
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.street')} <Text className='req-star'>*</Text></Text>
              <Input className='ig-input' value={address_street} placeholder='123 Main St'
                onInput={e => this.set('address_street', e.detail.value)} />
            </View>
          </View>
        )}

        {/* 昵称 */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.nickname')}</Text>
          <Input className='ig-input' value={nickname} placeholder={t('addBankAccount.nicknamePh')}
            onInput={e => this.set('nickname', e.detail.value)} />
        </View>

        {/* 设为默认 */}
        <View className='default-row' onClick={() => this.setState({ is_default: !is_default })}>
          <View className={`checkbox ${is_default ? 'checked' : ''}`}>{is_default ? '✓' : ''}</View>
          <Text className='default-label'>{t('addBankAccount.setDefault')}</Text>
        </View>

        <View className={`btn-primary ${saving ? 'disabled' : ''}`} onClick={saving ? undefined : this.save}>
          {saving ? t('common.saving') : t('addBankAccount.save')}
        </View>
      </View>
    );
  }

  render() {
    const { step } = this.state;
    return (
      <View className='aba-page'>
        <BackBar />
        {step === 1 && this.renderStep1()}
        {step === 2 && this.renderStep2()}
        {step === 3 && this.renderStep3()}
      </View>
    );
  }
}
