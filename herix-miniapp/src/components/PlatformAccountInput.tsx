import { Component } from 'react';
import { View, Text, Input } from '@tarojs/components';
import WechatOrPhoneInput, { validateWechatOrPhone } from './WechatOrPhoneInput';
import { platformById } from '../utils/platforms';
import './PlatformAccountInput.scss';

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
      followersText: existing?.followers != null ? String(existing.followers) : '',
    };
  }

  emit(rawValue: string, followersText: string) {
    const platform = platformById(this.props.platformId);
    const followers = followersText ? parseInt(followersText, 10) : null;

    if (this.props.platformId === 'wechat') {
      const check = validateWechatOrPhone(rawValue);
      this.props.onChange({
        platformId: this.props.platformId,
        accountId: check.ok ? check.saved : null,
        url: null,
        followers: null,
      });
      return;
    }

    if (platform.inputType === 'id') {
      this.props.onChange({ platformId: this.props.platformId, accountId: rawValue.trim() || null, url: null, followers: null });
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
        <Text style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
          {platform.icon} {platform.name} {platform.inputType === 'id' ? '— 账号 ID' : '— 主页链接'}
        </Text>
        {platformId === 'wechat' ? (
          <WechatOrPhoneInput value={rawValue} onChange={this.handleRawChange} />
        ) : (
          <>
            <Input
              className='ob-input'
              style={{ margin: 0 }}
              placeholder={platform.placeholder}
              value={rawValue}
              onInput={e => this.handleRawChange(e.detail.value)}
            />
            {platform.hasFollowers && (
              <Input
                className='ob-input'
                style={{ margin: '6px 0 0', fontSize: '13px' }}
                type='number'
                placeholder='粉丝数（选填）'
                value={followersText}
                onInput={e => this.handleFollowersChange(e.detail.value)}
              />
            )}
          </>
        )}
      </View>
    );
  }
}
