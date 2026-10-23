import { Component } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { wallet as walletApi } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';
import BackBar from '../../components/BackBar';

const ACCT_CATEGORIES = ['Savings', 'Checking'];
const ACCT_CATEGORY_LABELS = ['普通（Savings）', '当座（Checking）'];

interface State {
  last_name: string;
  first_name: string;
  account_name: string;
  bank_code: string;
  branch_code: string;
  account_number: string;
  account_category: string;
  address_city: string;
  address_street: string;
  address_postcode: string;
  nickname: string;
  is_default: boolean;
  saving: boolean;
}

export default class AddBankAccount extends Component<{}, State> {
  state: State = {
    last_name: '',
    first_name: '',
    account_name: '',
    bank_code: '',
    branch_code: '',
    account_number: '',
    account_category: 'Savings',
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
    if (!/^\d{7}$/.test(account_number.trim())) {
      Taro.showToast({ title: t('addBankAccount.errAcctNo'), icon: 'none' }); return;
    }
    if (!/^\d{4}$/.test(bank_code.trim())) {
      Taro.showToast({ title: t('addBankAccount.errBankCode'), icon: 'none' }); return;
    }
    if (!/^\d{3}$/.test(branch_code.trim())) {
      Taro.showToast({ title: t('addBankAccount.errBranchCode'), icon: 'none' }); return;
    }
    if (!address_city.trim() || !address_street.trim() || !address_postcode.trim()) {
      Taro.showToast({ title: t('addBankAccount.errAddress'), icon: 'none' }); return;
    }

    this.setState({ saving: true });
    try {
      await walletApi.addBankAccount({
        last_name: last_name.trim(),
        first_name: first_name.trim(),
        account_name: account_name.trim(),
        bank_code: bank_code.trim(),
        branch_code: branch_code.trim(),
        account_number: account_number.trim(),
        account_category,
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
      last_name, first_name, account_name,
      bank_code, branch_code, account_number, account_category,
      address_city, address_street, address_postcode,
      nickname, is_default, saving,
    } = this.state;
    const catIdx = ACCT_CATEGORIES.indexOf(account_category);

    return (
      <View className='aba-page'>
        <BackBar />
        <Text className='aba-title'>{t('addBankAccount.title')}</Text>
        <Text className='aba-sub'>{t('addBankAccount.sub')}</Text>

        {/* 姓名 */}
        <View className='ig-row'>
          <View className='ig ig-half'>
            <Text className='ig-label'>{t('addBankAccount.lastName')} <Text className='req-star'>*</Text></Text>
            <Input className='ig-input' value={last_name} placeholder='YAMADA'
              onInput={e => this.set('last_name', e.detail.value)} />
          </View>
          <View className='ig ig-half'>
            <Text className='ig-label'>{t('addBankAccount.firstName')} <Text className='req-star'>*</Text></Text>
            <Input className='ig-input' value={first_name} placeholder='TARO'
              onInput={e => this.set('first_name', e.detail.value)} />
          </View>
        </View>

        {/* 口座名義 */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.acctName')} <Text className='req-star'>*</Text></Text>
          <Text className='ig-hint'>{t('addBankAccount.acctNameHint')}</Text>
          <Input className='ig-input' value={account_name} placeholder='YAMADA TARO'
            onInput={e => this.set('account_name', e.detail.value)} />
        </View>

        {/* 銀行コード + 支店コード */}
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

        {/* 住所 */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.postcode')} <Text className='req-star'>*</Text></Text>
          <Input className='ig-input' type='number' value={address_postcode} placeholder='1600022'
            maxlength={7} onInput={e => this.set('address_postcode', e.detail.value)} />
        </View>
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.city')} <Text className='req-star'>*</Text></Text>
          <Input className='ig-input' value={address_city} placeholder='Tokyo'
            onInput={e => this.set('address_city', e.detail.value)} />
        </View>
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.street')} <Text className='req-star'>*</Text></Text>
          <Input className='ig-input' value={address_street} placeholder='1-1-1 Shinjuku'
            onInput={e => this.set('address_street', e.detail.value)} />
        </View>

        {/* ニックネーム（任意） */}
        <View className='ig'>
          <Text className='ig-label'>{t('addBankAccount.nickname')}</Text>
          <Input className='ig-input' value={nickname} placeholder={t('addBankAccount.nicknamePh')}
            onInput={e => this.set('nickname', e.detail.value)} />
        </View>

        {/* デフォルト */}
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
