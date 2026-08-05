import { Component } from 'react';
import { View, Text, Input } from '@tarojs/components';
import WechatOrPhoneInput, { validateWechatOrPhone } from './WechatOrPhoneInput';
import { platformById } from '../utils/platforms';
import './PlatformAccountInput.scss';
import { t } from '../utils/i18n';

/**
 * "添加/编辑一个社交平台账号" 表单，从 herix.html 里 4 处近似重复实现
 * （showAddAccountSheet / showRequirementsModal 内嵌区块 / showPlatformCollectModal / socialEditFormHTML）收敛成一份。
 */

export interface PlatformAccountValue {
  platformId: string;
  accountId: string | null;
  url: string | null;
  followers: number | null;
}

interface Props {
  platformId: string;
  existingValue?: Partial<PlatformAccountValue>;
  onChange: (value: PlatformAccountValue) => void;
}

interface State {
  rawValue: string;
  followersText: string;
}

export default class PlatformAccountInput extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const existing = props.existingValue;
    this.state = {
      rawValue: existing?.accountId || existing?.url || '',
      followersText: existing?.followers != null
        ? String(existing.followers)
        : '',
    };
  }

  // 预填的默认好友数要主动推给父组件，否则赫使没碰输入框、提交时仍是空（2026-07-29）
  componentDidMount() {
    if (this.state.followersText) this.emit(this.state.rawValue, this.state.followersText);
  }

  emit(rawValue: string, followersText: string) {
    const platform = platformById(this.props.platformId);
    const followers = followersText ? parseInt(followersText, 10) : null;

    // followers 承载"数量门槛"数字（内容平台=粉丝数，联系平台=好友数），三条路径都要带上，
    // 否则微信/LINE 填了好友数存不进档案，报名时校验必然 INSUFFICIENT 卡死（2026-07-29 修）
    if (this.props.platformId === 'wechat') {
      const check = validateWechatOrPhone(rawValue);
      this.props.onChange({
        platformId: this.props.platformId,
        accountId: check.ok ? check.saved : null,
        url: null,
        followers,
      });
      return;
    }

    if (platform.inputType === 'id') {
      this.props.onChange({ platformId: this.props.platformId, accountId: rawValue.trim() || null, url: null, followers });
    } else {
      this.props.onChange({ platformId: this.props.platformId, url: rawValue.trim() || null, accountId: null, followers });
    }
  }

  handleRawChange = (value: string) => {
    this.setState({ rawValue: value });
    this.emit(value, this.state.followersText);
  };

  handleFollowersChange = (value: string) => {
    this.setState({ followersText: value });
    this.emit(this.state.rawValue, value);
  };

  render() {
    const { platformId } = this.props;
    const platform = platformById(platformId);
    const { rawValue, followersText } = this.state;

    return (
      <View className='platform-account-input'>
        <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <Text style={{ fontSize: '13px', fontWeight: 600 }}>
            {platform.icon} {platform.name}{' '}
            {platformId === 'wechat' ? t('pai.wechatTitle') : (platform.inputType === 'id' ? t('pai.accountOrPhone') : t('pai.homeLink'))}
          </Text>
        </View>
        {platformId === 'wechat' ? (
          <WechatOrPhoneInput value={rawValue} onChange={this.handleRawChange} />
        ) : (
          <Input
            className='ob-input'
            style={{ margin: 0 }}
            placeholder={platform.placeholder}
            value={rawValue}
            adjustPosition
            cursorSpacing={20}
            onInput={e => this.handleRawChange(e.detail.value)}
          />
        )}
        <View style={{ marginTop: '14px' }}>
          <Text style={{ fontSize: '12px', fontWeight: 600 }}>
            {t(platform.countLabel === 'friends' ? 'pai.friendsLabel' : 'pai.followersLabel')}
          </Text>
          <Text style={{ fontSize: '11px', color: '#9ca3af', display: 'block', marginTop: '2px' }}>{t('pai.countHint')}</Text>
        </View>
        <Input
          className='ob-input'
          style={{ margin: '6px 0 0', fontSize: '13px' }}
          type='number'
          placeholder={t(platform.countLabel === 'friends' ? 'pai.friendsPlaceholder' : 'pai.followersPlaceholder')}
          value={followersText}
          adjustPosition
          cursorSpacing={20}
          onInput={e => this.handleFollowersChange(e.detail.value)}
        />
      </View>
    );
  }
}
