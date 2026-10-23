import { Component } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';
import BackBar from '../../components/BackBar';

const COUNTRIES = ['JP', 'CN'];
const COUNTRY_LABELS = ['日本（JPY）', '中国（CNY）'];

const ACCT_CATEGORIES = ['Savings', 'Checking'];
const ACCT_CATEGORY_LABELS = ['普通（Savings）', '当座（Checking）'];

interface State {
  country: string;
  last_name: string;
  first_name: string;
  account_name: string;
  // JP
  bank_code: string;
  branch_code: string;
  account_category: string;
  // CN: cnaps_code stored in bank_code field
  // CN address fields are simpler
  account_number: string;
  address_city: string;
  address_street: string;
  address_postcode: string;
  nickname: string;
  is_default: boolean;
  saving: boolean;
}

export default class AddBankAccount extends Component<{}, State> {
  state: State = {
    country: 'JP',
    last_name: '',
    first_name: '',
    account_name: '',
    bank_code: '',
    branch_code: '',
    account_category: 'Savings',
    account_number: '',
    address_city: '',
    address_street: '',
    address_postcode: '',
    nickname: '',
    is_default: false,
    saving: false,
  };

  set = (key: keyof State, val: string) => this.setState({ [key]: val } as any);

  save = async () => {
    const {
      country,
      last_name, first_name, account_name,
      bank_code, branch_code, account_number, account_category,
      address_city, address_street, address_postcode,
      nickname, is_default,
    } = this.state;

    if (!last_name.trim() || !first_name.trim()) {
      Taro.showToast({ title: t('addBankAccount.errName'), icon: 'none' }); return;
    }
    if (!account_name.trim()) {
      Taro.showToast({ title: t('addBankAccount.errAcctName'), icon: 'none' }); return;
    }

    if (country === 'JP') {
      if (!/^\d{7}$/.test(account_number.trim())) {
        Taro.showToast({ title: t('addBankAccount.errAcctNo'), icon: 'none' }); return;
      }
      if (!/^\d{4}$/.test(bank_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errBankCode'), icon: 'none' }); return;
      }
      if (!/^\d{3}$/.test(branch_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errBranchCode'), icon: 'none' }); return;
      }
    } else {
      // CN
      if (!/^\d{12}$/.test(bank_code.trim())) {
        Taro.showToast({ title: t('addBankAccount.errCnaps'), icon: 'none' }); return;
      }
      if (!/^\d{16,19}$/.test(account_number.trim())) {
        Taro.showToast({ title: t('addBankAccount.errCnAcctNo'), icon: 'none' }); return;
      }
    }

    if (!address_city.trim() || !address_street.trim() || !address_postcode.trim()) {
      Taro.showToast({ title: t('addBankAccount.errAddress'), icon: 'none' }); return;
    }

    this.setState({ saving: true });
    try {
      await walletApi.addBankAccount({
        address_country: country,
        last_name: last_name.trim(),
        first_name: first_name.trim(),
        account_name: account_name.trim(),
        bank_code: bank_code.trim(),
        branch_code: country === 'JP' ? branch_code.trim() : '',
        account_number: account_number.trim(),
        account_category: country === 'JP' ? account_category : 'Savings',
        address_city: address_city.trim(),
        address_street: address_street.trim(),
        address_postcode: address_postcode.trim(),
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

  render() {
    const {
      country,
      last_name, first_name, account_name,
      bank_code, branch_code, account_number, account_category,
      address_city, address_street, address_postcode,
      nickname, is_default, saving,
    } = this.state;
    const countryIdx = COUNTRIES.indexOf(country);
    const catIdx = ACCT_CATEGORIES.indexOf(account_category);
    const isJP = country === 'JP';

    return (
      <View className='aba-page'>
        <BackBar />
        <Text className='aba-title'>{t('addBankAccount.title')}</Text>
        <Text className='aba-sub'>{t('addBankAccount.sub')}</Text>

        {/* 收款国家 */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.country')} <Text className='req-star'>*</Text></Text>
          <Picker mode='selector' range={COUNTRY_LABELS} value={countryIdx}
            onChange={e => this.setState({ country: COUNTRIES[Number(e.detail.value)], bank_code: '', branch_code: '', account_number: '' })}>
            <View className='ig-picker'>{COUNTRY_LABELS[countryIdx]}</View>
          </Picker>
        </View>

        {/* 姓名 */}
        <View className='ig-row'>
          <View className='ig ig-half'>
            <Text className='ig-label'>{t('addBankAccount.lastName')} <Text className='req-star'>*</Text></Text>
            <Input className='ig-input' value={last_name}
              placeholder={isJP ? 'YAMADA' : 'ZHANG'}
              onInput={e => this.set('last_name', e.detail.value)} />
          </View>
          <View className='ig ig-half'>
            <Text className='ig-label'>{t('addBankAccount.firstName')} <Text className='req-star'>*</Text></Text>
            <Input className='ig-input' value={first_name}
              placeholder={isJP ? 'TARO' : 'WEI'}
              onInput={e => this.set('first_name', e.detail.value)} />
          </View>
        </View>

        {/* 口座名義 / 账户名 */}
        <View className='ig'>
          <Text className='ig-label'>{isJP ? t('addBankAccount.acctName') : t('addBankAccount.cnAcctName')} <Text className='req-star'>*</Text></Text>
          <Text className='ig-hint'>{isJP ? t('addBankAccount.acctNameHint') : t('addBankAccount.cnAcctNameHint')}</Text>
          <Input className='ig-input' value={account_name}
            placeholder={isJP ? 'YAMADA TARO' : '张伟'}
            onInput={e => this.set('account_name', e.detail.value)} />
        </View>

        {isJP ? (
          <View>
            {/* 日本：銀行コード + 支店コード */}
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

            {/* 口座番号 + 口座種別 */}
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
        ) : (
          <View>
            {/* 中国：CNAPS 联行号 */}
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.cnaps')} <Text className='req-star'>*</Text></Text>
              <Text className='ig-hint'>{t('addBankAccount.cnapsHint')}</Text>
              <Input className='ig-input' type='number' value={bank_code} placeholder='102100099996'
                maxlength={12} onInput={e => this.set('bank_code', e.detail.value)} />
            </View>

            {/* 银行卡号 */}
            <View className='ig'>
              <Text className='ig-label'>{t('addBankAccount.cnAcctNo')} <Text className='req-star'>*</Text></Text>
              <Input className='ig-input' type='number' value={account_number} placeholder='6222021001122334455'
                maxlength={19} onInput={e => this.set('account_number', e.detail.value)} />
            </View>
          </View>
        )}

        {/* 住所 */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.postcode')} <Text className='req-star'>*</Text></Text>
          <Input className='ig-input' type='number' value={address_postcode}
            placeholder={isJP ? '1600022' : '100000'}
            maxlength={isJP ? 7 : 6} onInput={e => this.set('address_postcode', e.detail.value)} />
        </View>
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.city')} <Text className='req-star'>*</Text></Text>
          <Input className='ig-input' value={address_city}
            placeholder={isJP ? 'Tokyo' : '北京市朝阳区'}
            onInput={e => this.set('address_city', e.detail.value)} />
        </View>
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.street')} <Text className='req-star'>*</Text></Text>
          <Input className='ig-input' value={address_street}
            placeholder={isJP ? '1-1-1 Shinjuku' : '建国门外大街1号'}
            onInput={e => this.set('address_street', e.detail.value)} />
        </View>

        {/* 备注昵称 */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.nickname')}</Text>
          <Input className='ig-input' value={nickname} placeholder={t('addBankAccount.nicknamePh')}
            onInput={e => this.set('nickname', e.detail.value)} />
        </View>

        {/* 默认账户 */}
        <View className='default-row' onClick={() => this.setState({ is_default: !is_default })}>
          <View className={`checkbox ${is_default ? 'checked' : ''}`}>{is_default ? '✓' : ''}</View>
          <Text className='default-label'>{t('addBankAccount.setDefault')}</Text>
        </View>

        <View
          className={`btn-primary ${saving ? 'disabled' : ''}`}
          onClick={saving ? undefined : this.save}
        >
          {saving ? t('common.saving') : t('addBankAccount.save')}
        </View>
      </View>
    );
  }
}
