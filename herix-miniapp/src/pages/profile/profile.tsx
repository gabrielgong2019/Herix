import { Component } from 'react';
import { View, Text, Input, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  auth as authApi,
  wallet as walletApi,
  ambassador,
  users,
  setToken,
  getToken,
  clearToken,
} from '../../utils/api';
import { PLATFORM_REGISTRY, platformById } from '../../utils/platforms';
import { t, LOCALES, getLocale, setLocale } from '../../utils/i18n';
import './profile.scss';
import { fmt } from '../../utils/format';
import { validateWechatOrPhone } from '../../components/WechatOrPhoneInput';

const AVATAR_COLORS = ['#D43B27', '#34c759', '#f5a623', '#ff3b30', '#5856d6', '#ff9500'];

function parseJSON(s: any, fallback: any) {
  if (!s) return fallback;
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
// 评级（等价 herix profileHTML）
function computeRating(rt: any): { level: string; color: string; next: string } {
  const ctasks = rt.completedTasks || 0;
  const grate = rt.goodRate || 0;
  // level 是内部码(英文级别名不翻译)；'' = 未评级，展示时用 t('profile.unrated')
  let level = '';
  let color = 'var(--text-muted)';
  if (ctasks >= 50 && grate >= 0.95) { level = 'Platinum'; color = '#7c3aed'; }
  else if (ctasks >= 25 && grate >= 0.85) { level = 'Gold'; color = '#f59e0b'; }
  else if (ctasks >= 10 && grate >= 0.75) { level = 'Silver'; color = '#9ca3af'; }
  else if (ctasks >= 3 && grate >= 0.6) { level = 'Bronze'; color = '#cd7f32'; }
  let next = '';
  if (!level) next = t('profile.next1', { level: 'Bronze', n: Math.max(0, 3 - ctasks) });
  else if (level === 'Bronze') next = t('profile.next2', { level: 'Silver', n: Math.max(0, 10 - ctasks), p: 75 });
  else if (level === 'Silver') next = t('profile.next2', { level: 'Gold', n: Math.max(0, 25 - ctasks), p: 85 });
  else if (level === 'Gold') next = t('profile.next2', { level: 'Platinum', n: Math.max(0, 50 - ctasks), p: 95 });
  return { level, color, next };
}

interface State {
  user: any;
  isLogin: boolean;
  account: string;
  password: string;
  email: string;
  nickname: string;
  roleIndex: number;
  loading: boolean;
  showRegister: boolean;
  balance: any;
  editingName: boolean;
  newNick: string;
  editingSocial: boolean;
  socialForm: Record<string, string>; // key: wechat / plat-<id> / fol-<id>
}

export default class Profile extends Component<{}, State> {
  state: State = {
    user: null,
    isLogin: !!getToken(),
    account: '',
    password: '',
    email: '',
    nickname: '',
    roleIndex: 1,
    loading: false,
    showRegister: false,
    balance: {},
    editingName: false,
    newNick: '',
    editingSocial: false,
    socialForm: {},
  };

  componentDidShow() {
    if (getToken()) this.loadUser();
  }

  loadUser = async () => {
    try {
      const user = await authApi.me();
      this.setState({ user, isLogin: true });
      Taro.setStorageSync('herix_user', user);
      if (user.role === 'HERALD') this.loadBalance();
    } catch {
      clearToken();
      this.setState({ isLogin: false });
    }
  };

  loadBalance = async () => {
    try {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const bal = await walletApi.balance({ from, to: now.toISOString() });
      this.setState({ balance: bal || {} });
    } catch {
      /* 钱包卡是辅助展示，失败忽略 */
    }
  };

  handleLogin = async () => {
    const { account, password } = this.state;
    if (!account || !password) {
      Taro.showToast({ title: t('profile.errAccountPass'), icon: 'none' });
      return;
    }
    this.setState({ loading: true });
    try {
      const res = await authApi.login({ account, password });
      setToken(res.token);
      Taro.setStorageSync('herix_user', res.user);
      this.setState({ user: res.user, isLogin: true });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('profile.loginFailed'), icon: 'none' });
    } finally {
      this.setState({ loading: false });
    }
  };

  handleRegister = async () => {
    const { email, password, nickname, roleIndex } = this.state;
    if (!email || !password) {
      Taro.showToast({ title: t('profile.errEmailPass'), icon: 'none' });
      return;
    }
    this.setState({ loading: true });
    try {
      const role = roleIndex === 0 ? 'BRAND' : 'HERALD';
      const res = await authApi.register({ email, password, nickname, role });
      setToken(res.token);
      Taro.setStorageSync('herix_user', res.user);
      this.setState({ user: res.user, isLogin: true, showRegister: false });
      // 新赫使引导入驻
      if (role === 'HERALD') Taro.navigateTo({ url: '/pages/onboard/index' });
      else this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('profile.registerFailed'), icon: 'none' });
    } finally {
      this.setState({ loading: false });
    }
  };

  handleLogout = () => {
    clearToken();
    Taro.removeStorageSync('herix_user');
    this.setState({ user: null, isLogin: false });
  };

  saveNickname = async () => {
    const name = this.state.newNick.trim();
    if (!name) {
      Taro.showToast({ title: t('profile.nicknameEmpty'), icon: 'none' });
      return;
    }
    try {
      await users.updateMe({ nickname: name });
      this.setState({ editingName: false });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('common.saveFailed'), icon: 'none' });
    }
  };

  toggleCurrency = async () => {
    const cur = this.state.user?.display_currency || 'JPY';
    const next = cur === 'CNY' ? 'JPY' : 'CNY';
    try {
      await ambassador.updateProfile({ display_currency: next } as any);
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('profile.switchFailed'), icon: 'none' });
    }
  };

  addBrandRole = async () => {
    const res = await Taro.showModal({ title: t('profile.addBrandTitle'), content: t('profile.addBrandConfirm'), confirmText: t('common.confirm'), cancelText: t('common.cancel') });
    if (!res.confirm) return;
    try {
      const r = await users.addRole('BRAND');
      if (r?.token) setToken(r.token);
      Taro.showToast({ title: t('profile.enabled'), icon: 'success' });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('profile.enableFailed'), icon: 'none' });
    }
  };

  switchAccount = async () => {
    try {
      const r = await authApi.switchAccount();
      if (r?.token) setToken(r.token);
      this.loadUser();
      Taro.showToast({ title: t('profile.switched'), icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('profile.switchFailed'), icon: 'none' });
    }
  };

  goOnboard = () => Taro.navigateTo({ url: '/pages/onboard/index' });
  goWallet = () => Taro.navigateTo({ url: '/pages/wallet/index' });

  switchLanguage = async () => {
    try {
      const res = await Taro.showActionSheet({ itemList: LOCALES.map(l => l.label) });
      const picked = LOCALES[res.tapIndex];
      if (picked && picked.id !== getLocale()) {
        await setLocale(picked.id);
        this.forceUpdate(); // 本页文案立即生效；其他页面在重新进入时生效
      }
    } catch {
      /* 用户取消 */
    }
  };

  // ── 社交编辑 ──
  openSocialEdit = () => {
    const socials = parseJSON(this.state.user?.social_platforms, []);
    const form: Record<string, string> = {};
    socials.forEach((s: any) => {
      if (s.platformId === 'wechat') form.wechat = (s.accountId || '').replace(/^\+86/, '');
      else {
        const p = platformById(s.platformId);
        form[`plat-${s.platformId}`] = p.inputType === 'id' ? s.accountId || '' : s.url || '';
        if (s.followers) form[`fol-${s.platformId}`] = String(s.followers);
      }
    });
    this.setState({ editingSocial: true, socialForm: form });
  };

  setSocial = (key: string, val: string) => this.setState({ socialForm: { ...this.state.socialForm, [key]: val } });

  saveSocial = async () => {
    const f = this.state.socialForm;
    const platforms: any[] = [];
    if (f.wechat && f.wechat.trim()) {
      const check = validateWechatOrPhone(f.wechat.trim());
      if (!check.ok) {
        Taro.showToast({ title: check.msg!, icon: 'none' });
        return;
      }
      if (check.saved) platforms.push({ platformId: 'wechat', accountId: check.saved, url: null, followers: null });
    }
    PLATFORM_REGISTRY.filter(p => p.id !== 'wechat').forEach(p => {
      const val = (f[`plat-${p.id}`] || '').trim();
      if (!val) return;
      const fol = f[`fol-${p.id}`] ? parseInt(f[`fol-${p.id}`], 10) : null;
      if (p.inputType === 'id') platforms.push({ platformId: p.id, accountId: val, url: null, followers: null });
      else platforms.push({ platformId: p.id, url: val, followers: fol, accountId: null });
    });
    try {
      await ambassador.updateProfile({ socialPlatforms: platforms });
      this.setState({ editingSocial: false });
      Taro.showToast({ title: t('profile.socialSaved'), icon: 'success' });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '保存失败', icon: 'none' });
    }
  };

  renderRow = (label: string, val: string, key?: string) => (
    <View className='info-row' key={key || label}>
      <Text className='info-label'>{label}</Text>
      <Text className='info-val'>{val}</Text>
    </View>
  );

  render() {
    const { user, isLogin, account, password, email, nickname, roleIndex, loading, showRegister } = this.state;

    if (!isLogin) {
      return (
        <View className='profile-page'>
          <View className='auth-card'>
            <Text className='auth-title'>{showRegister ? t('profile.register') : t('profile.login')}</Text>
            <Text className='auth-subtitle'>Herix 赫使</Text>
            {showRegister ? (
              <>
                <Input className='input' placeholder={t('profile.email')} value={email} onInput={e => this.setState({ email: e.detail.value })} />
                <Input className='input' placeholder={t('profile.nickname')} value={nickname} onInput={e => this.setState({ nickname: e.detail.value })} />
                <Input className='input' placeholder={t('profile.passwordMin')} password value={password} onInput={e => this.setState({ password: e.detail.value })} />
                <View className='role-select'>
                  <Text className={roleIndex === 1 ? 'role-active' : 'role'} onClick={() => this.setState({ roleIndex: 1 })}>{t('profile.iAmHerald')}</Text>
                  <Text className={roleIndex === 0 ? 'role-active' : 'role'} onClick={() => this.setState({ roleIndex: 0 })}>{t('profile.iAmBrand')}</Text>
                </View>
                <Button className='btn-primary' onClick={this.handleRegister} loading={loading}>{t('profile.register')}</Button>
                <Text className='switch-auth' onClick={() => this.setState({ showRegister: false })}>{t('profile.toLogin')}</Text>
              </>
            ) : (
              <>
                <Input className='input' placeholder={t('profile.account')} value={account} onInput={e => this.setState({ account: e.detail.value })} />
                <Input className='input' placeholder={t('profile.password')} password value={password} onInput={e => this.setState({ password: e.detail.value })} />
                <Button className='btn-primary' onClick={this.handleLogin} loading={loading}>{t('profile.login')}</Button>
                <Text className='switch-auth' onClick={() => this.setState({ showRegister: true })}>{t('profile.toRegister')}</Text>
              </>
            )}
          </View>
        </View>
      );
    }

    const u = user || {};
    const isHerald = u.role === 'HERALD';
    const initial = (u.nickname || '?')[0].toUpperCase();
    const color = AVATAR_COLORS[(u.nickname || '').charCodeAt(0) % AVATAR_COLORS.length] || AVATAR_COLORS[0];
    const bal = this.state.balance || {};
    const socials = parseJSON(u.social_platforms, []);
    const tierSnap = parseJSON(u.tier_snapshot, {});
    const bank = parseJSON(u.bank_account, null);
    const roles: string[] = u.roles || [u.role];
    const { editingName, newNick, editingSocial, socialForm } = this.state;

    return (
      <View className='profile-page logged'>
        {/* 顶部卡 */}
        <View className='top-card'>
          <View className='avatar' style={{ background: color }}>{initial}</View>
          <Text className='top-name'>{u.nickname}</Text>
          <Text className='top-role'>{isHerald ? t('profile.roleHerald') : t('profile.roleBrand')}</Text>
          {editingName ? (
            <View className='name-edit'>
              <Input className='input' placeholder={t('profile.newNickname')} value={newNick} onInput={e => this.setState({ newNick: e.detail.value })} />
              <View className='name-edit-btns'>
                <Text className='btn-outline sm' onClick={() => this.setState({ editingName: false })}>{t('common.cancel')}</Text>
                <Text className='btn-primary sm' onClick={this.saveNickname}>{t('common.save')}</Text>
              </View>
            </View>
          ) : (
            <Text className='btn-outline sm' onClick={() => this.setState({ editingName: true, newNick: u.nickname || '' })}>{t('profile.editNickname')}</Text>
          )}
        </View>

        {/* 钱包卡（赫使）*/}
        {isHerald && (
          <View className='wallet-card' onClick={this.goWallet}>
            <View className='wc-top'>
              <View>
                <Text className='wc-label'>{t('wallet.balance.available')}</Text>
                <Text className='wc-amount'>¥{fmt(bal.available)}</Text>
              </View>
              <Text className='wc-arrow'>{t('profile.walletArrow')}</Text>
            </View>
            <View className='wc-stats'>
              <View className='wc-stat'>
                <Text className='wc-stat-label'>{t('profile.pending')}</Text>
                <Text className='wc-stat-val'>¥{fmt(bal.pendingAmount)}</Text>
              </View>
              <View className='wc-stat'>
                <Text className='wc-stat-label'>{t('profile.monthIncome')}</Text>
                <Text className='wc-stat-val income'>+¥{fmt(bal.periodInflow)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 账号信息 */}
        <View className='card'>
          <Text className='card-head'>{t('profile.accountInfo')}</Text>
          {isHerald && (
            <>
              {this.renderRow(t('profile.residence'), u.residence === 'japan' ? t('profile.resJapan') : u.residence === 'china' ? t('profile.resChina') : u.residence === 'overseas' ? t('profile.resOverseas') : t('profile.notSet'))}
              {this.renderRow(t('profile.kyc'), u.kyc_status === 'approved' ? t('profile.kycApproved') : u.kyc_status === 'pending' ? t('profile.kycPending') : t('profile.kycNone'))}
              {u.residence === 'japan' && this.renderRow(t('profile.declaration'), u.declaration_status === 'submitted' || u.declaration_status === 'approved' ? t('profile.declSubmitted') : t('profile.kycNone'))}
              {this.renderRow(t('profile.payoutMethod'), bank ? bank.type || t('profile.isSet') : t('profile.notSet'))}
              <View className='info-row'>
                <Text className='info-label'>{t('profile.currency')}</Text>
                <Text className='info-val link' onClick={this.toggleCurrency}>
                  {(u.display_currency || 'JPY') === 'CNY' ? '🇨🇳 CNY' : '🇯🇵 JPY'} {t('profile.currencySwitch')}
                </Text>
              </View>
            </>
          )}
          {this.renderRow(t('profile.role'), isHerald ? t('profile.heraldFull') : t('profile.roleBrand'))}
        </View>

        {/* 评级卡（赫使）*/}
        {isHerald && u.rating && (() => {
          const rt = u.rating || {};
          const r = computeRating(rt);
          return (
            <View className='card'>
              <Text className='card-head'>{t('profile.growth')}</Text>
              <View className='rating-row'>
                <View className='rating-cell'>
                  <Text className='rating-cell-label'>{t('profile.ratingLevel')}</Text>
                  <Text className='rating-cell-val' style={{ color: r.color }}>{r.level || t('profile.unrated')}</Text>
                </View>
                <View className='rating-cell'>
                  <Text className='rating-cell-label'>{t('profile.completedTasks')}</Text>
                  <Text className='rating-cell-val'>{t('profile.taskCount', { n: rt.completedTasks || 0 })}</Text>
                </View>
                <View className='rating-cell'>
                  <Text className='rating-cell-label'>{t('profile.goodRate')}</Text>
                  <Text className='rating-cell-val'>{rt.ratedCount > 0 ? Math.round((rt.goodRate || 0) * 100) + '%' : '—'}</Text>
                </View>
              </View>
              {r.next && <Text className='rating-next'>{r.next}</Text>}
            </View>
          );
        })()}

        {/* 社交账号（赫使）*/}
        {isHerald && (
          <View className='card'>
            <View className='card-head-row'>
              <Text className='card-head'>{t('profile.social')}</Text>
              <Text className='card-action' onClick={editingSocial ? () => this.setState({ editingSocial: false }) : this.openSocialEdit}>
                {editingSocial ? t('profile.collapse') : t('profile.edit')}
              </Text>
            </View>
            {!editingSocial &&
              (socials.length === 0 ? (
                <View className='info-row'>
                  <Text className='social-empty'>{t('profile.socialEmpty')}<Text className='link' onClick={this.openSocialEdit}>{t('profile.addNow')}</Text></Text>
                </View>
              ) : (
                socials.map((s: any) => {
                  const sp = platformById(s.platformId);
                  const tier = tierSnap[s.platformId];
                  let sval = s.accountId || (s.url ? s.url.replace('https://', '').split('/')[0] : '—');
                  if (s.followers) sval += ` · ${t('profile.followers', { n: fmt(s.followers) })}`;
                  return (
                    <View className='info-row' key={s.platformId}>
                      <Text className='info-label'>{sp.icon} {sp.name}</Text>
                      <Text className='info-val'>{sval}{tier ? ` [${tier}]` : ''}</Text>
                    </View>
                  );
                })
              ))}
            {editingSocial && (
              <View className='social-edit'>
                <Text className='se-label'>{t('profile.wechatLabel')}</Text>
                <Input className='input' placeholder={t('profile.wechatOptionalPh')} value={socialForm.wechat || ''} onInput={e => this.setSocial('wechat', e.detail.value)} />
                <Text className='se-hint'>{t('wx.autoDetect')}</Text>
                {PLATFORM_REGISTRY.filter(p => p.id !== 'wechat').map(p => (
                  <View key={p.id} className='se-field'>
                    <Text className='se-label'>{p.icon} {p.name} <Text className='se-opt'>{t('profile.optionalSuffix')}</Text></Text>
                    <View className='se-row'>
                      <Input className='input flex' placeholder={p.placeholder} value={socialForm[`plat-${p.id}`] || ''} onInput={e => this.setSocial(`plat-${p.id}`, e.detail.value)} />
                      {p.hasFollowers && (
                        <Input className='input fol' type='number' placeholder='粉丝数' value={socialForm[`fol-${p.id}`] || ''} onInput={e => this.setSocial(`fol-${p.id}`, e.detail.value)} />
                      )}
                    </View>
                  </View>
                ))}
                <View className='btn-primary' onClick={this.saveSocial}>{t('common.save')}</View>
              </View>
            )}
          </View>
        )}

        {/* 操作 */}
        <View className='card actions'>
          <Text className='action-item' onClick={this.switchLanguage}>
            🌐 {t('profile.language')}：{LOCALES.find(l => l.id === getLocale())?.label}
          </Text>
          {!u.is_onboarded && <Text className='action-item primary' onClick={this.goOnboard}>{t('profile.finishOnboard')}</Text>}
          {!roles.includes('BRAND') && roles.includes('HERALD') && (
            <Text className='action-item' onClick={this.addBrandRole}>{t('profile.enableBrand')}</Text>
          )}
          {u.linkedAccount && (
            <Text className='action-item primary' onClick={this.switchAccount}>
              {t('profile.switchTo', { name: u.linkedAccount.nickname, role: u.linkedAccount.role === 'BRAND' ? t('profile.roleBrand') : t('profile.roleHerald') })}
            </Text>
          )}
          <Text className='action-item danger' onClick={this.handleLogout}>{t('profile.logout')}</Text>
        </View>
      </View>
    );
  }
}
