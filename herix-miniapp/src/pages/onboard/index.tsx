import { Component } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ambassador, getToken } from '../../utils/api';
import { PLATFORM_REGISTRY, platformById } from '../../utils/platforms';
import './index.scss';

// 微信/手机号校验（等价 herix obValidateWechat）
function validateWechat(val: string): { ok: boolean; saved?: string | null; msg?: string } {
  if (!val) return { ok: true, saved: null }; // 选填
  if (/^\d+$/.test(val)) {
    if (!/^1[3-9]\d{9}$/.test(val)) return { ok: false, msg: '手机号格式有误（需11位，以1开头）' };
    return { ok: true, saved: '+86' + val };
  }
  if (val.length < 6 || val.length > 20) return { ok: false, msg: '微信号需6-20位' };
  return { ok: true, saved: val };
}

// 微信输入实时提示（render 内计算，不操作 DOM）
function wechatHint(val: string): { text: string; color: string; showPrefix: boolean } {
  const v = (val || '').trim();
  if (/^\d+$/.test(v) && v.length > 0) {
    if (v.length < 11) return { text: '继续输入手机号（11位）', color: 'var(--text-muted)', showPrefix: true };
    if (/^1[3-9]\d{9}$/.test(v)) return { text: `✓ 有效手机号，将以 +86 ${v} 保存`, color: 'var(--success)', showPrefix: true };
    return { text: '手机号格式有误，请检查', color: '#ef4444', showPrefix: true };
  }
  if (v.length === 0) return { text: '微信号：字母+数字，6-20位 · 手机号：输入数字自动识别', color: 'var(--text-muted)', showPrefix: false };
  if (v.length < 6) return { text: '微信号至少6位', color: 'var(--text-muted)', showPrefix: false };
  return { text: '✓ 微信 ID', color: 'var(--success)', showPrefix: false };
}

const VISAS = [
  { v: '永住者', l: '永住者 / 定住者 / 日本人配偶' },
  { v: '就労', l: '就労・人文知識・国際業務等' },
  { v: '留学', l: '留学生（资格外活动许可）' },
  { v: '其他', l: '其他（请说明）' },
];
const BANK_METHODS = [
  { v: 'wise', l: 'Wise', sub: '推荐，手续费最低' },
  { v: 'paypal', l: 'PayPal', sub: '快速到账' },
  { v: 'swift', l: '国际电汇 (SWIFT)', sub: '适合大额' },
];

interface OnboardData {
  wechatId: string;
  snsPlatform: string;
  snsVal: string;
  snsFollowers: string;
  residence: string;
  visaType: string;
  agreed: boolean;
  bankType: string;
  bankEmail: string;
  swiftCode: string;
  iban: string;
}

interface State {
  step: number;
  data: OnboardData;
  submitting: boolean;
  taskId: string;
}

export default class Onboard extends Component<{}, State> {
  state: State = {
    step: 1,
    data: {
      wechatId: '',
      snsPlatform: '',
      snsVal: '',
      snsFollowers: '',
      residence: '',
      visaType: '',
      agreed: false,
      bankType: '',
      bankEmail: '',
      swiftCode: '',
      iban: '',
    },
    submitting: false,
    taskId: '',
  };

  componentDidMount() {
    const params = Taro.getCurrentInstance().router?.params || {};
    if (params.taskId) this.setState({ taskId: params.taskId as string });
    if (!getToken()) Taro.showToast({ title: '请先登录', icon: 'none' });
  }

  set = <K extends keyof OnboardData>(key: K, val: OnboardData[K]) =>
    this.setState({ data: { ...this.state.data, [key]: val } });

  // step1 → step2
  nextPlatforms = () => {
    const { wechatId } = this.state.data;
    if (wechatId.trim()) {
      const check = validateWechat(wechatId.trim());
      if (!check.ok) {
        Taro.showToast({ title: check.msg!, icon: 'none' });
        return;
      }
    }
    this.setState({ step: 2 });
  };

  nextResidence = () => {
    if (!this.state.data.residence) return;
    this.setState({ step: 3 });
  };

  nextJapan = () => {
    if (!this.state.data.agreed) {
      Taro.showToast({ title: '请先同意声明', icon: 'none' });
      return;
    }
    this.submit();
  };

  nextBank = () => {
    const { bankType, bankEmail } = this.state.data;
    if ((bankType === 'wise' || bankType === 'paypal') && !bankEmail) {
      Taro.showToast({ title: '请填写账户邮箱', icon: 'none' });
      return;
    }
    this.submit();
  };

  submit = async () => {
    if (this.state.submitting) return;
    const d = this.state.data;
    const platforms: any[] = [];
    if (d.wechatId) {
      const check = validateWechat(d.wechatId.trim());
      if (check.saved) platforms.push({ platformId: 'wechat', accountId: check.saved, url: null, followers: null });
    }
    if (d.snsPlatform && d.snsVal) {
      const meta = platformById(d.snsPlatform);
      if (meta.inputType === 'id') platforms.push({ platformId: d.snsPlatform, accountId: d.snsVal, url: null, followers: null });
      else platforms.push({ platformId: d.snsPlatform, url: d.snsVal, followers: d.snsFollowers ? parseInt(d.snsFollowers, 10) : null, accountId: null });
    }
    const body = {
      residence: d.residence || undefined,
      visaType: d.visaType || undefined,
      hasWorkPermit: true,
      bankAccountType: d.bankType || undefined,
      bankDetails: d.bankType ? { email: d.bankEmail, swiftCode: d.swiftCode, iban: d.iban } : undefined,
      socialPlatforms: platforms.length > 0 ? platforms : undefined,
    };
    this.setState({ submitting: true });
    try {
      await ambassador.onboard(body);
      this.setState({ step: 4, submitting: false });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '提交失败', icon: 'none' });
      this.setState({ submitting: false });
    }
  };

  finish = () => {
    const { taskId } = this.state;
    if (taskId) Taro.redirectTo({ url: `/pages/task/task?id=${taskId}` });
    else Taro.switchTab({ url: '/pages/index/index' });
  };

  render() {
    const { step, data: d, submitting } = this.state;
    const titles: Record<number, string> = {
      1: '你的社交账号',
      2: '你在哪里生活？',
      3: d.residence === 'japan' ? '在留资格声明' : '打款账户信息',
      4: '设置完成！',
    };
    const subs: Record<number, string> = {
      1: '帮助品牌方了解你的影响力，入驻后可随时补充',
      2: '居住地决定你的税务规则和打款方式',
      3: d.residence === 'japan' ? '请确认你的在留资格，这是日本法规要求' : '选择你的收款方式',
      4: '欢迎加入赫使！你已可以浏览和接取任务',
    };
    const sns = PLATFORM_REGISTRY.filter(p => p.id !== 'wechat');
    const hint = wechatHint(d.wechatId);
    const selP = d.snsPlatform ? platformById(d.snsPlatform) : null;

    return (
      <View className='onboard-page'>
        {/* 进度条 */}
        <View className='progress'>
          {[1, 2, 3, 4].map(i => (
            <View key={i} className={`progress-seg ${i <= step ? 'on' : ''}`} />
          ))}
        </View>

        <Text className='ob-title'>{titles[step]}</Text>
        <Text className='ob-sub'>{subs[step]}</Text>

        {/* STEP 1: 社交账号 */}
        {step === 1 && (
          <View>
            <View className='card'>
              <View className='wx-head'>
                <Text className='wx-emoji'>💬</Text>
                <View>
                  <Text className='wx-title'>微信 ID / 手机号 <Text className='wx-opt'>建议填写</Text></Text>
                  <Text className='wx-desc'>用于品牌方与你直接沟通</Text>
                </View>
              </View>
              <View className='wx-input-row'>
                {hint.showPrefix && <Text className='wx-prefix'>+86</Text>}
                <Input
                  className='ob-input flex'
                  placeholder='微信号 或 手机号'
                  value={d.wechatId}
                  onInput={e => this.set('wechatId', e.detail.value)}
                />
              </View>
              <Text className='wx-hint' style={{ color: hint.color }}>{hint.text}</Text>
            </View>

            <View className='card'>
              <Text className='card-title'>添加一个社交账号（选填）</Text>
              <View className='chips'>
                {sns.map(p => (
                  <Text
                    key={p.id}
                    className={`chip ${d.snsPlatform === p.id ? 'sel' : ''}`}
                    onClick={() => this.set('snsPlatform', d.snsPlatform === p.id ? '' : p.id)}
                  >
                    {p.icon} {p.name}
                  </Text>
                ))}
              </View>
              {selP && (
                <View>
                  <Text className='field-label'>{selP.inputType === 'id' ? '账号 ID' : '主页链接'}</Text>
                  <Input
                    className='ob-input'
                    placeholder={selP.placeholder}
                    value={d.snsVal}
                    onInput={e => this.set('snsVal', e.detail.value)}
                  />
                  {selP.hasFollowers && (
                    <View>
                      <Text className='field-label'>粉丝数（选填）</Text>
                      <Input
                        className='ob-input'
                        type='number'
                        placeholder='例：5000'
                        value={d.snsFollowers}
                        onInput={e => this.set('snsFollowers', e.detail.value)}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>

            <View className='btn-primary' onClick={this.nextPlatforms}>下一步</View>
            <Text className='skip' onClick={() => this.setState({ step: 2 })}>跳过，稍后再填</Text>
          </View>
        )}

        {/* STEP 2: 居住地 */}
        {step === 2 && (
          <View>
            <View className={`choice ${d.residence === 'japan' ? 'sel' : ''}`} onClick={() => this.set('residence', 'japan')}>
              <Text className='choice-emoji'>🇯🇵</Text>
              <Text className='choice-name'>在日本居住</Text>
              <Text className='choice-sub'>日本银行振込，需提交在留资格声明</Text>
            </View>
            <View className={`choice ${d.residence === 'overseas' ? 'sel' : ''}`} onClick={() => this.set('residence', 'overseas')}>
              <Text className='choice-emoji'>🌏</Text>
              <Text className='choice-name'>海外其他地区</Text>
              <Text className='choice-sub'>Wise / PayPal / 国际电汇</Text>
            </View>
            {d.residence && <View className='btn-primary' onClick={this.nextResidence}>下一步</View>}
            <Text className='skip' onClick={this.submit}>跳过，稍后再填</Text>
            <Text className='skip-note'>收款时必须完善</Text>
          </View>
        )}

        {/* STEP 3-japan: 在留资格 */}
        {step === 3 && d.residence === 'japan' && (
          <View>
            {VISAS.map(v => (
              <View key={v.v} className={`choice compact ${d.visaType === v.v ? 'sel' : ''}`} onClick={() => this.set('visaType', v.v)}>
                <Text className='choice-name sm'>{v.l}</Text>
              </View>
            ))}
            {d.visaType && (
              <View>
                <View className='declaration'>
                  本人は上記の在職資格を保持しており、副業活動を得ることが法的に認められています。虚偽申告の場合、報酬は没収されます。
                </View>
                <View className='agree-row' onClick={() => this.set('agreed', !d.agreed)}>
                  <View className={`checkbox ${d.agreed ? 'checked' : ''}`}>{d.agreed ? '✓' : ''}</View>
                  <Text className='agree-label'>上記声明内容に同意します</Text>
                </View>
                <View className={`btn-primary ${submitting ? 'disabled' : ''}`} onClick={submitting ? undefined : this.nextJapan}>
                  {submitting ? '提交中...' : '确认声明，继续'}
                </View>
              </View>
            )}
            <Text className='skip' onClick={this.submit}>跳过，稍后再填</Text>
          </View>
        )}

        {/* STEP 3-overseas: 打款方式 */}
        {step === 3 && d.residence !== 'japan' && (
          <View>
            {BANK_METHODS.map(m => (
              <View key={m.v} className={`choice ${d.bankType === m.v ? 'sel' : ''}`} onClick={() => this.set('bankType', m.v)}>
                <Text className='choice-name'>{m.l}</Text>
                <Text className='choice-sub'>{m.sub}</Text>
              </View>
            ))}
            {d.bankType && (
              <View>
                {d.bankType === 'wise' || d.bankType === 'paypal' ? (
                  <View>
                    <Text className='field-label'>账户邮箱</Text>
                    <Input className='ob-input' placeholder='your@email.com' value={d.bankEmail} onInput={e => this.set('bankEmail', e.detail.value)} />
                  </View>
                ) : (
                  <View>
                    <Text className='field-label'>SWIFT Code</Text>
                    <Input className='ob-input' placeholder='XXXXXXXX' value={d.swiftCode} onInput={e => this.set('swiftCode', e.detail.value)} />
                    <Text className='field-label'>IBAN / 账户号</Text>
                    <Input className='ob-input' placeholder='账户号码' value={d.iban} onInput={e => this.set('iban', e.detail.value)} />
                  </View>
                )}
                <View className={`btn-primary ${submitting ? 'disabled' : ''}`} onClick={submitting ? undefined : this.nextBank}>
                  {submitting ? '提交中...' : '提交'}
                </View>
              </View>
            )}
            <Text className='skip' onClick={this.submit}>跳过，稍后再填</Text>
          </View>
        )}

        {/* STEP 4: 完成 */}
        {step === 4 && (
          <View className='done'>
            <Text className='done-emoji'>🎉</Text>
            <Text className='done-title'>入驻完成</Text>
            <Text className='done-sub'>现在可以浏览任务，开始你的赫使之旅</Text>
            <View className='btn-primary' onClick={this.finish}>开始探索</View>
          </View>
        )}
      </View>
    );
  }
}
