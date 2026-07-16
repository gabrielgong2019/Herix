import { Component } from 'react';
import { View, Text, Input } from '@tarojs/components';
import './WechatOrPhoneInput.scss';

/**
 * 微信号 / 手机号 二选一输入框，从 herix.html 里 5 份几乎逐字重复的实现
 * （obWechatInput/asWxInput/reqWxInput/pcWechatInput/seWechatInput）收敛成一份。
 *
 * 规则：纯数字 → 按手机号校验（11位，1[3-9]开头，自动显示 +86 前缀）；
 *       否则按微信号校验（6-20位）。
 */

export interface WechatValidation {
  ok: boolean;
  msg?: string;
  /** 校验通过后实际要保存的值（手机号会加上 +86 前缀） */
  saved: string | null;
}

export function validateWechatOrPhone(raw: string): WechatValidation {
  const val = (raw || '').trim();
  if (!val) return { ok: true, saved: null };
  if (/^\d+$/.test(val)) {
    if (!/^1[3-9]\d{9}$/.test(val)) {
      return { ok: false, msg: '手机号格式有误（需11位，以1开头）', saved: null };
    }
    return { ok: true, saved: '+86' + val };
  }
  if (val.length < 6 || val.length > 20) {
    return { ok: false, msg: '微信号需6-20位', saved: null };
  }
  return { ok: true, saved: val };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

interface State {
  isPhone: boolean;
}

export default class WechatOrPhoneInput extends Component<Props, State> {
  state: State = { isPhone: false };

  handleInput = (val: string) => {
    this.setState({ isPhone: /^\d+$/.test(val) && val.length > 0 });
    this.props.onChange(val);
  };

  renderHint() {
    const val = (this.props.value || '').trim();
    if (this.state.isPhone) {
      if (val.length < 11) return { color: '#999', text: '继续输入（11位）' };
      const ok = /^1[3-9]\d{9}$/.test(val);
      return ok ? { color: '#10b981', text: '✓ +86 ' + val } : { color: '#ef4444', text: '手机号格式有误' };
    }
    if (val.length >= 6) return { color: '#10b981', text: '✓ 微信 ID' };
    if (val.length > 0) return { color: '#ef4444', text: '微信号至少6位' };
    return { color: '#999', text: '纯数字自动识别手机号' };
  }

  render() {
    const { value } = this.props;
    const hint = this.renderHint();

    return (
      <View className='wechat-or-phone-input'>
        <View style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {this.state.isPhone && (
            <View
              style={{
                padding: '11px 10px',
                background: '#f2f3f7',
                border: '1px solid #e5e5ea',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#999',
              }}
            >
              +86
            </View>
          )}
          <Input
            className='ob-input'
            style={{ flex: 1, margin: 0 }}
            placeholder='微信号 或 手机号'
            value={value}
            onInput={e => this.handleInput(e.detail.value)}
          />
        </View>
        <Text style={{ fontSize: '11px', marginTop: '3px', color: hint.color }}>{hint.text}</Text>
      </View>
    );
  }
}
