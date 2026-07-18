import { Component } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ambassador, getToken } from '../../utils/api';
import { PLATFORM_REGISTRY, platformById } from '../../utils/platforms';
import './index.scss';
import { t } from '../../utils/i18n';
import { validateWechatOrPhone } from '../../components/WechatOrPhoneInput';


// 微信输入实时提示（render 内计算，不操作 DOM）
function wechatHint(val: string): { text: string; color: string; showPrefix: boolean } {
  const v = (val || '').trim();
  if (/^\d+$/.test(v) && v.length > 0) {
    if (v.length < 11) return { text: t('ob.hintContinue'), color: 'var(--text-muted)', showPrefix: true };
    if (/^1[3-9]\d{9}$/.test(v)) return { text: t('ob.hintValid', { v }), color: 'var(--success)', showPrefix: true };
    return { text: t('ob.hintBad'), color: '#ef4444', showPrefix: true };
  }
  if (v.length === 0) return { text: t('ob.hintDefault'), color: 'var(--text-muted)', showPrefix: false };
  if (v.length < 6) return { text: t('wx.wechatMin'), color: 'var(--text-muted)', showPrefix: false };
  return { text: t('wx.wechatOk'), color: 'var(--success)', showPrefix: false };
}

// v 是落库值不翻译；labelKey 渲染时 t() 取值
// v 是入库的稳定 id（2026-07-18 从 CJK 文本迁移，存量归一见 db.ts 迁移），显示走词条
const VISAS = [
  { v: 'permanent', labelKey: 'ob.visa1' },
  { v: 'work', labelKey: 'ob.visa2' },
  { v: 'student', labelKey: 'ob.visa3' },
  { v: 'other', labelKey: 'ob.visa4' },
];
const BANK_METHODS = [
  { v: 'wise', l: 'Wise', subKey: 'ob.wiseSub' },
  { v: 'paypal', l: 'PayPal', subKey: 'ob.paypalSub' },
  { v: 'swift', labelKey: 'ob.swiftName', subKey: 'ob.swiftSub' },
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
    if (!getToken()) Taro.showToast({ title: t('ob.needLogin'), icon: 'none' });
  }

  set = <K extends keyof OnboardData>(key: K, val: OnboardData[K]) =>
    this.setState({ data: { ...this.state.data, [key]: val } });

  // step1 → step2
  nextPlatforms = () => {
    const { wechatId } = this.state.data;
    if (wechatId.trim()) {
      const check = validateWechatOrPhone(wechatId.trim());
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
      Taro.showToast({ title: t('ob.agreeFirst'), icon: 'none' });
      return;
    }
    this.submit();
  };

  nextBank = () => {
    const { bankType, bankEmail } = this.state.data;
    if ((bankType === 'wise' || bankType === 'paypal') && !bankEmail) {
      Taro.showToast({ title: t('ob.fillEmail'), icon: 'none' });
      return;
    }
    this.submit();
  };

  submit = async () => {
    if (this.state.submitting) return;
    const d = this.state.data;
    const platforms: any[] = [];
    if (d.wechatId) {
      const check = validateWechatOrPhone(d.wechatId.trim());
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
      Taro.showToast({ title: err?.message || t('common.submitFailed'), icon: 'none' });
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
      1: t('ob.title1'),
      2: t('ob.title2'),
      3: d.residence === 'japan' ? t('ob.title3jp') : t('ob.title3bank'),
      4: t('ob.title4'),
    };
    const subs: Record<number, string> = {
      1: t('ob.sub1'),
      2: t('ob.sub2'),
      3: d.residence === 'japan' ? t('ob.sub3jp') : t('ob.sub3bank'),
      4: t('ob.sub4'),
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
                  <Text className='wx-title'>{t('ob.wechatTitle')} <Text className='wx-opt'>{t('ob.recommended')}</Text></Text>
                  <Text className='wx-desc'>{t('ob.wechatWhy')}</Text>
                </View>
              </View>
              <View className='wx-input-row'>
                {hint.showPrefix && <Text className='wx-prefix'>+86</Text>}
                <Input
                  className='ob-input flex'
                  placeholder={t('wx.placeholder')}
                  value={d.wechatId}
                  onInput={e => this.set('wechatId', e.detail.value)}
                />
              </View>
              <Text className='wx-hint' style={{ color: hint.color }}>{hint.text}</Text>
            </View>

            <View className='card'>
              <Text className='card-title'>{t('ob.addSns')}</Text>
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
                  <Text className='field-label'>{selP.inputType === 'id' ? t('ob.accountId') : t('ob.homeLink')}</Text>
                  <Input
                    className='ob-input'
                    placeholder={selP.placeholder}
                    value={d.snsVal}
                    onInput={e => this.set('snsVal', e.detail.value)}
                  />
                  {selP.hasFollowers && (
                    <View>
                      <Text className='field-label'>{t('pai.followers')}</Text>
                      <Input
                        className='ob-input'
                        type='number'
                        placeholder={t('ob.followersPh')}
                        value={d.snsFollowers}
                        onInput={e => this.set('snsFollowers', e.detail.value)}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>

            <View className='btn-primary' onClick={this.nextPlatforms}>{t('ob.next')}</View>
            <Text className='skip' onClick={() => this.setState({ step: 2 })}>{t('ob.skip')}</Text>
          </View>
        )}

        {/* STEP 2: 居住地 */}
        {step === 2 && (
          <View>
            <View className={`choice ${d.residence === 'japan' ? 'sel' : ''}`} onClick={() => this.set('residence', 'japan')}>
              <Text className='choice-emoji'>🇯🇵</Text>
              <Text className='choice-name'>{t('ob.resJapan')}</Text>
              <Text className='choice-sub'>{t('ob.resJapanSub')}</Text>
            </View>
            <View className={`choice ${d.residence === 'overseas' ? 'sel' : ''}`} onClick={() => this.set('residence', 'overseas')}>
              <Text className='choice-emoji'>🌏</Text>
              <Text className='choice-name'>{t('ob.resOverseas')}</Text>
              <Text className='choice-sub'>{t('ob.resOverseasSub')}</Text>
            </View>
            {d.residence && <View className='btn-primary' onClick={this.nextResidence}>{t('ob.next')}</View>}
            <Text className='skip' onClick={this.submit}>{t('ob.skip')}</Text>
            <Text className='skip-note'>{t('ob.mustComplete')}</Text>
          </View>
        )}

        {/* STEP 3-japan: 在留资格 */}
        {step === 3 && d.residence === 'japan' && (
          <View>
            {VISAS.map(v => (
              <View key={v.v} className={`choice compact ${d.visaType === v.v ? 'sel' : ''}`} onClick={() => this.set('visaType', v.v)}>
                <Text className='choice-name sm'>{t(v.labelKey)}</Text>
              </View>
            ))}
            {d.visaType && (
              <View>
                <View className='declaration'>{t('ob.declaration')}</View>
                <View className='agree-row' onClick={() => this.set('agreed', !d.agreed)}>
                  <View className={`checkbox ${d.agreed ? 'checked' : ''}`}>{d.agreed ? '✓' : ''}</View>
                  <Text className='agree-label'>{t('ob.agree')}</Text>
                </View>
                <View className={`btn-primary ${submitting ? 'disabled' : ''}`} onClick={submitting ? undefined : this.nextJapan}>
                  {submitting ? t('withdraw.submitting') : t('ob.confirmDecl')}
                </View>
              </View>
            )}
            <Text className='skip' onClick={this.submit}>{t('ob.skip')}</Text>
          </View>
        )}

        {/* STEP 3-overseas: 打款方式 */}
        {step === 3 && d.residence !== 'japan' && (
          <View>
            {BANK_METHODS.map(m => (
              <View key={m.v} className={`choice ${d.bankType === m.v ? 'sel' : ''}`} onClick={() => this.set('bankType', m.v)}>
                <Text className='choice-name'>{(m as any).labelKey ? t((m as any).labelKey) : (m as any).l}</Text>
                <Text className='choice-sub'>{t((m as any).subKey)}</Text>
              </View>
            ))}
            {d.bankType && (
              <View>
                {d.bankType === 'wise' || d.bankType === 'paypal' ? (
                  <View>
                    <Text className='field-label'>{t('ob.bankEmail')}</Text>
                    <Input className='ob-input' placeholder='your@email.com' value={d.bankEmail} onInput={e => this.set('bankEmail', e.detail.value)} />
                  </View>
                ) : (
                  <View>
                    <Text className='field-label'>SWIFT Code</Text>
                    <Input className='ob-input' placeholder='XXXXXXXX' value={d.swiftCode} onInput={e => this.set('swiftCode', e.detail.value)} />
                    <Text className='field-label'>{t('ob.iban')}</Text>
                    <Input className='ob-input' placeholder={t('addMethod.ph.cnAcctNo')} value={d.iban} onInput={e => this.set('iban', e.detail.value)} />
                  </View>
                )}
                <View className={`btn-primary ${submitting ? 'disabled' : ''}`} onClick={submitting ? undefined : this.nextBank}>
                  {submitting ? t('withdraw.submitting') : t('common.submit')}
                </View>
              </View>
            )}
            <Text className='skip' onClick={this.submit}>{t('ob.skip')}</Text>
          </View>
        )}

        {/* STEP 4: 完成 */}
        {step === 4 && (
          <View className='done'>
            <Text className='done-emoji'>🎉</Text>
            <Text className='done-title'>{t('ob.doneTitle')}</Text>
            <Text className='done-sub'>{t('ob.doneSub')}</Text>
            <View className='btn-primary' onClick={this.finish}>{t('ob.explore')}</View>
          </View>
        )}
      </View>
    );
  }
}
