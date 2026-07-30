import { Component } from 'react';
import { View, Text, Input, Button, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  auth as authApi,
  wallet as walletApi,
  ambassador,
  users,
  specialtyTags,
  setToken,
  getToken,
  clearToken,
} from '../../utils/api';
import logoIcon from '../../assets/herix-icon.png';
import { PLATFORM_REGISTRY, platformById } from '../../utils/platforms';
import { t, LOCALES, getLocale, setLocale } from '../../utils/i18n';
import { refreshUnreadBadge } from '../../utils/badge';
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
  loading: boolean;
  showRegister: boolean;
  balance: any;
  editingName: boolean;
  newNick: string;
  /** 逐账号编辑弹层：null=关闭 */
  socialSheet: null | { mode: 'edit' | 'add'; platformId: string; account: string; followers: string };
  /** 添加账号的平台选择器 */
  platformPickerOpen: boolean;
  /** 注册表单的邮箱验证码 */
  vcode: string;
  codeCountdown: number;
  /** 微信登录：openid 无账号时的选择界面 */
  wxChoice: boolean;
  /** 登录表单提交到"登录并绑定微信" */
  wxBindMode: boolean;
  /** 绑定邮箱弹层（微信注册用户） */
  beSheet: null | { email: string; code: string; password: string };
  beCountdown: number;
  /** 擅长领域标签 */
  allTags: { id: string; sort_order: number }[];
  myTagIds: string[];
  tagSheetOpen: boolean;
  tagSaving: boolean;
  tagError: string;
}

export default class Profile extends Component<{}, State> {
  state: State = {
    user: null,
    isLogin: !!getToken(),
    account: '',
    password: '',
    email: '',
    nickname: '',
    loading: false,
    showRegister: false,
    balance: {},
    editingName: false,
    newNick: '',
    socialSheet: null,
    platformPickerOpen: false,
    vcode: '',
    codeCountdown: 0,
    wxChoice: false,
    wxBindMode: false,
    beSheet: null,
    beCountdown: 0,
    allTags: [],
    myTagIds: [],
    tagSheetOpen: false,
    tagSaving: false,
    tagError: '',
  };

  componentDidShow() {
    if (getToken()) this.loadUser();
    // 小程序端：无 token 时先试静默登录（openid 已有账号则零操作进入）
    else if (process.env.TARO_ENV === 'weapp') this.trySilentWechatLogin();
  }

  trySilentWechatLogin = async () => {
    try {
      const res = await authApi.wechatLogin();
      if (res?.token) {
        setToken(res.token);
        Taro.setStorageSync('herix_user', res.user);
        this.setState({ user: res.user, isLogin: true });
        this.loadUser();
      }
      // needRegister：停留在登录页，用户自选一键注册或绑定已有账号
    } catch { /* 静默失败不打扰 */ }
  };

  loadUser = async () => {
    refreshUnreadBadge();
    try {
      const user = await authApi.me();
      this.setState({ user, isLogin: true });
      Taro.setStorageSync('herix_user', user);
      if (user.role === 'HERALD') { this.loadBalance(); this.loadTags(); }
    } catch {
      clearToken();
      this.setState({ isLogin: false });
    }
  };

  loadTags = async () => {
    try {
      const [all, mine] = await Promise.all([
        specialtyTags.list(),
        specialtyTags.myTags(),
      ]);
      this.setState({ allTags: all || [], myTagIds: (mine || []).map((tg: any) => tg.id) });
    } catch { /* 非关键，失败忽略 */ }
  };

  saveTags = async () => {
    this.setState({ tagSaving: true, tagError: '' });
    try {
      await specialtyTags.saveTags(this.state.myTagIds);
      this.setState({ tagSheetOpen: false, tagError: '' });
      Taro.showToast({ title: t('common.save'), icon: 'success' });
    } catch (err: any) {
      this.setState({ tagError: err.message || t('error.GENERIC') });
    } finally {
      this.setState({ tagSaving: false });
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
    const { account, password, wxBindMode } = this.state;
    if (!account || !password) {
      Taro.showToast({ title: t('profile.errAccountPass'), icon: 'none' });
      return;
    }
    this.setState({ loading: true });
    try {
      // 绑定模式（小程序）：邮箱密码验证通过后把当前微信挂到该账号，双端同一身份
      const res = wxBindMode
        ? await authApi.bindWechat({ account, password })
        : await authApi.login({ account, password });
      setToken(res.token);
      Taro.setStorageSync('herix_user', res.user);
      this.setState({ user: res.user, isLogin: true, wxBindMode: false, wxChoice: false });
      if (wxBindMode) Taro.showToast({ title: t('auth.wechatBoundOk'), icon: 'success' });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('profile.loginFailed'), icon: 'none' });
    } finally {
      this.setState({ loading: false });
    }
  };

  // ── 微信登录（weapp 专用，openid 由云托管注入）──
  handleWechatTap = async () => {
    this.setState({ loading: true });
    try {
      const res = await authApi.wechatLogin();
      if (res?.token) {
        setToken(res.token);
        Taro.setStorageSync('herix_user', res.user);
        this.setState({ user: res.user, isLogin: true });
        this.loadUser();
      } else if (res?.needRegister) {
        await this.handleWechatRegister();
      }
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('profile.loginFailed'), icon: 'none' });
    } finally {
      this.setState({ loading: false });
    }
  };

  handleWechatRegister = async () => {
    this.setState({ loading: true });
    try {
      const res = await authApi.wechatRegister();
      setToken(res.token);
      Taro.setStorageSync('herix_user', res.user);
      this.setState({ user: res.user, isLogin: true, wxChoice: false });
      Taro.navigateTo({ url: '/pages/onboard/index' });
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('profile.registerFailed'), icon: 'none' });
    } finally {
      this.setState({ loading: false });
    }
  };

  // ── 注册验证码 ──
  codeTimer: ReturnType<typeof setInterval> | null = null;
  beTimer: ReturnType<typeof setInterval> | null = null;

  componentWillUnmount() {
    if (this.codeTimer) clearInterval(this.codeTimer);
    if (this.beTimer) clearInterval(this.beTimer);
  }

  sendRegCode = async () => {
    const em = this.state.email.trim();
    if (!em) {
      Taro.showToast({ title: t('landing.fillEmailFirst'), icon: 'none' });
      return;
    }
    if (this.state.codeCountdown > 0) return;
    try {
      await authApi.sendCode(em, 'REGISTER');
      this.setState({ codeCountdown: 60 });
      Taro.showToast({ title: t('landing.codeSent'), icon: 'none' });
      this.codeTimer = setInterval(() => {
        const s = this.state.codeCountdown - 1;
        if (s <= 0 && this.codeTimer) { clearInterval(this.codeTimer); this.codeTimer = null; }
        this.setState({ codeCountdown: Math.max(0, s) });
      }, 1000);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('common.opFailed'), icon: 'none' });
    }
  };

  // ── 绑定邮箱（微信注册用户补邮箱+密码）──
  sendBindCode = async () => {
    const sheet = this.state.beSheet;
    if (!sheet || !sheet.email.trim()) {
      Taro.showToast({ title: t('landing.fillEmailFirst'), icon: 'none' });
      return;
    }
    if (this.state.beCountdown > 0) return;
    try {
      await authApi.sendCode(sheet.email.trim(), 'BIND_EMAIL');
      this.setState({ beCountdown: 60 });
      Taro.showToast({ title: t('landing.codeSent'), icon: 'none' });
      this.beTimer = setInterval(() => {
        const s = this.state.beCountdown - 1;
        if (s <= 0 && this.beTimer) { clearInterval(this.beTimer); this.beTimer = null; }
        this.setState({ beCountdown: Math.max(0, s) });
      }, 1000);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('common.opFailed'), icon: 'none' });
    }
  };

  submitBindEmail = async () => {
    const sheet = this.state.beSheet;
    if (!sheet) return;
    if (!sheet.email.trim() || !sheet.code.trim() || sheet.password.length < 6) {
      Taro.showToast({ title: t('profile.bindEmailInvalid'), icon: 'none' });
      return;
    }
    try {
      await authApi.bindEmail({ email: sheet.email.trim(), code: sheet.code.trim(), password: sheet.password });
      this.setState({ beSheet: null });
      Taro.showToast({ title: t('profile.emailBoundOk'), icon: 'success' });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('common.opFailed'), icon: 'none' });
    }
  };

  handleRegister = async () => {
    const { email, password, nickname, vcode } = this.state;
    if (!email || !password) {
      Taro.showToast({ title: t('profile.errEmailPass'), icon: 'none' });
      return;
    }
    if (!vcode.trim()) {
      Taro.showToast({ title: t('landing.codeRequired'), icon: 'none' });
      return;
    }
    this.setState({ loading: true });
    try {
      // 注册恒定赫使：商家/广告代理走 merchant.html 入驻向导（2026-07-19 移除身份切换）
      const role = 'HERALD';
      const res = await authApi.register({ email, password, nickname, role, code: vcode.trim() });
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
    const MERCHANT_URL = 'https://herix.huaxuex.com/merchant.html';
    const res = await Taro.showModal({ title: t('profile.addBrandTitle'), content: t('profile.addBrandConfirm'), confirmText: t('common.confirm'), cancelText: t('common.cancel') });
    if (!res.confirm) return;
    if (process.env.TARO_ENV === 'weapp') {
      Taro.setClipboardData({ data: MERCHANT_URL });
      Taro.showToast({ title: t('profile.brandUrlCopied'), icon: 'none', duration: 3000 });
    } else {
      window.open(MERCHANT_URL, '_blank');
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
        users.updateMe({ lang: picked.id }).catch(() => { /* 同步失败不阻断 */ });
        this.forceUpdate(); // 本页文案立即生效；其他页面在重新进入时生效
      }
    } catch {
      /* 用户取消 */
    }
  };

  // ── 社交账号：逐账号增删改（2026-07-17 由全量表单改造；接口仍收整个数组，前端改一行发全量）──
  openAccountEdit = (s: any) => {
    const p = platformById(s.platformId);
    const account = s.platformId === 'wechat'
      ? (s.accountId || '').replace(/^\+86/, '')
      : (p.inputType === 'id' ? s.accountId || '' : s.url || '');
    this.setState({ socialSheet: { mode: 'edit', platformId: s.platformId, account, followers: s.followers ? String(s.followers) : '' } });
  };

  pickPlatform = (platformId: string) => {
    this.setState({ platformPickerOpen: false, socialSheet: { mode: 'add', platformId, account: '', followers: '' } });
  };

  /** 用弹层内容替换/追加对应平台后，整个数组发回后端 */
  buildPlatforms = (sheet: NonNullable<State['socialSheet']> | null, removeId?: string): any[] | null => {
    const socials = parseJSON(this.state.user?.social_platforms, []);
    const rest = socials.filter((s: any) => s.platformId !== (removeId || sheet?.platformId));
    if (!sheet) return rest;
    const p = platformById(sheet.platformId);
    const val = sheet.account.trim();
    if (!val) {
      Taro.showToast({ title: t('profile.accountRequired'), icon: 'none' });
      return null;
    }
    let entry: any;
    if (sheet.platformId === 'wechat') {
      const check = validateWechatOrPhone(val);
      if (!check.ok) {
        Taro.showToast({ title: check.msg!, icon: 'none' });
        return null;
      }
      entry = { platformId: 'wechat', accountId: check.saved, url: null, followers: null };
    } else {
      const fol = sheet.followers ? parseInt(sheet.followers, 10) : null;
      entry = p.inputType === 'id'
        ? { platformId: sheet.platformId, accountId: val, url: null, followers: null }
        : { platformId: sheet.platformId, url: val, followers: fol, accountId: null };
    }
    return [...rest, entry];
  };

  savePlatforms = async (platforms: any[]) => {
    try {
      await ambassador.updateProfile({ socialPlatforms: platforms });
      this.setState({ socialSheet: null });
      Taro.showToast({ title: t('profile.socialSaved'), icon: 'success' });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '保存失败', icon: 'none' });
    }
  };

  saveSheet = () => {
    const platforms = this.buildPlatforms(this.state.socialSheet);
    if (platforms) this.savePlatforms(platforms);
  };

  deleteAccount = async () => {
    const sheet = this.state.socialSheet;
    if (!sheet) return;
    const p = platformById(sheet.platformId);
    const res = await Taro.showModal({
      title: t('profile.deleteAccount'),
      content: t('profile.deleteConfirm', { name: p.name }),
    });
    if (!res.confirm) return;
    const platforms = this.buildPlatforms(null, sheet.platformId);
    if (platforms) this.savePlatforms(platforms);
  };

  renderRow = (label: string, val: string, key?: string) => (
    <View className='info-row' key={key || label}>
      <Text className='info-label'>{label}</Text>
      <Text className='info-val'>{val}</Text>
    </View>
  );

  render() {
    const { user, isLogin, account, password, email, nickname, loading, showRegister } = this.state;

    if (!isLogin) {
      if (process.env.TARO_ENV === 'weapp') {
        return (
          <View className='profile-page login-weapp'>
            <View className='login-brand'>
              <Image className='login-logo' src={logoIcon} mode='aspectFit' />
              <Text className='login-name'>Herix</Text>
              <Text className='login-tagline'>{t('auth.tagline')}</Text>
            </View>
            <View className='login-actions'>
              <Button className='btn-wechat' onClick={this.handleWechatTap} loading={loading}>{t('auth.wechatOneTap')}</Button>
              <Text className='login-lang' onClick={this.switchLanguage}>
                🌐 {LOCALES.find(l => l.id === getLocale())?.label}
              </Text>
            </View>
          </View>
        );
      }

      return (
        <View className='profile-page'>
          <View className='auth-card'>
            <Text className='auth-title'>{showRegister ? t('profile.register') : t('profile.login')}</Text>
            <Text className='auth-subtitle'>Herix 赫使</Text>
            {(
              // H5：邮箱登录 / 注册
              showRegister ? (
                <>
                  <Input className='input' placeholder={t('profile.email')} placeholderClass='ph' value={email} onInput={e => this.setState({ email: e.detail.value })} />
                  <View className='pf-code-row'>
                    <Input className='input pf-code-input' type='number' maxlength={6} placeholder={t('landing.codePlaceholder')} placeholderClass='ph' value={this.state.vcode} onInput={e => this.setState({ vcode: e.detail.value })} />
                    <View className={`pf-code-btn ${this.state.codeCountdown > 0 ? 'disabled' : ''}`} onClick={this.state.codeCountdown > 0 ? undefined : this.sendRegCode}>
                      {this.state.codeCountdown > 0 ? t('landing.codeResend', { s: this.state.codeCountdown }) : t('landing.codeSend')}
                    </View>
                  </View>
                  <Input className='input' placeholder={t('profile.nickname')} placeholderClass='ph' value={nickname} onInput={e => this.setState({ nickname: e.detail.value })} />
                  <Input className='input' placeholder={t('profile.passwordMin')} placeholderClass='ph' password value={password} onInput={e => this.setState({ password: e.detail.value })} />
                  <Button className='btn-primary' onClick={this.handleRegister} loading={loading}>{t('profile.register')}</Button>
                  <Text className='switch-auth' onClick={() => this.setState({ showRegister: false })}>{t('profile.toLogin')}</Text>
                </>
              ) : (
                <>
                  <Input className='input' placeholder={t('profile.account')} placeholderClass='ph' value={account} onInput={e => this.setState({ account: e.detail.value })} />
                  <Input className='input' placeholder={t('profile.password')} placeholderClass='ph' password value={password} onInput={e => this.setState({ password: e.detail.value })} />
                  <Button className='btn-primary' onClick={this.handleLogin} loading={loading}>{t('profile.login')}</Button>
                  <Text className='switch-auth' onClick={() => this.setState({ showRegister: true })}>{t('profile.toRegister')}</Text>
                </>
              )
            )}
            {/* 未登录也能切语言(此前入口只在登录后的操作区) */}
            <Text className='switch-auth' onClick={this.switchLanguage}>
              🌐 {LOCALES.find(l => l.id === getLocale())?.label}
            </Text>
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
    const { editingName, newNick } = this.state;

    return (
      <View className='profile-page logged'>
        {/* 顶部卡 */}
        <View className='top-card'>
          <View className='avatar' style={{ background: color }}>{initial}</View>
          <Text className='top-name'>{u.nickname}</Text>
          <Text className='top-role'>{isHerald ? t('profile.roleHerald') : t('profile.roleBrand')}</Text>
          {editingName ? (
            <View className='name-edit'>
              <Input className='input' placeholder={t('profile.newNickname')} placeholderClass='ph' value={newNick} onInput={e => this.setState({ newNick: e.detail.value })} />
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

        {/* 社交账号（赫使）：逐行编辑 + 添加 */}
        {isHerald && (
          <View className='card'>
            <View className='card-head-row'>
              <Text className='card-head'>{t('profile.social')}</Text>
              <Text className='card-action' onClick={() => this.setState({ platformPickerOpen: true })}>
                ＋ {t('profile.addAccount')}
              </Text>
            </View>
            {socials.length === 0 ? (
              <View className='info-row'>
                <Text className='social-empty'>{t('profile.socialEmpty')}<Text className='link' onClick={() => this.setState({ platformPickerOpen: true })}>{t('profile.addNow')}</Text></Text>
              </View>
            ) : (
              socials.map((s: any) => {
                const sp = platformById(s.platformId);
                const tier = tierSnap[s.platformId];
                // 行内只放最有信息量的：有粉丝数显示 粉丝数+段位标签，否则显示账号简写
                const sval = s.followers
                  ? t('profile.followers', { n: fmt(s.followers) })
                  : s.accountId || (s.url ? s.url.replace('https://', '').split('/')[0] : '—');
                return (
                  <View className='info-row ps-account-row' key={s.platformId} onClick={() => this.openAccountEdit(s)}>
                    <Text className='info-label'>{sp.icon} {sp.name}</Text>
                    <Text className='info-val'>
                      {sval}
                      {s.followers && tier ? <Text className='ps-tier'>{tier}</Text> : null}
                      <Text className='ps-chevron'>›</Text>
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* 擅长领域（赫使）*/}
        {isHerald && (
          <View className='card'>
            <View className='card-head-row'>
              <Text className='card-head'>{t('specialty.selectTitle')}</Text>
              <Text className='card-action' onClick={() => this.setState({ tagSheetOpen: true })}>
                {t('common.edit')}
              </Text>
            </View>
            <View className='tag-chips'>
              {this.state.myTagIds.length === 0 ? (
                <Text className='tag-empty' onClick={() => this.setState({ tagSheetOpen: true })}>
                  {t('specialty.selectHint')}
                </Text>
              ) : (
                this.state.myTagIds.map(id => (
                  <Text key={id} className='tag-chip'>{t(`specialty.${id}`)}</Text>
                ))
              )}
            </View>
          </View>
        )}

        {/* 标签选择器 overlay */}
        {isHerald && this.state.tagSheetOpen && (
          <View className='ps-overlay' onClick={() => this.setState({ tagSheetOpen: false, tagError: '' })}>
            <View className='ps-sheet tag-sheet' onClick={e => e.stopPropagation()}>
              <Text className='ps-title'>{t('specialty.selectTitle')}</Text>
              <Text className='ps-hint'>{t('specialty.selectHint')}</Text>
              {this.state.tagError ? (
                <Text className='tag-error'>{this.state.tagError}</Text>
              ) : null}
              <View className='tag-picker-grid'>
                {this.state.allTags.map(tag => {
                  const selected = this.state.myTagIds.includes(tag.id);
                  const maxed = !selected && this.state.myTagIds.length >= 5;
                  return (
                    <View
                      key={tag.id}
                      className={`tag-pick-item ${selected ? 'selected' : ''} ${maxed ? 'maxed' : ''}`}
                      onClick={maxed ? undefined : () => {
                        const ids = this.state.myTagIds;
                        const next = selected ? ids.filter(i => i !== tag.id) : [...ids, tag.id];
                        this.setState({ myTagIds: next });
                      }}
                    >
                      {t(`specialty.${tag.id}`)}
                    </View>
                  );
                })}
              </View>
              <View
                className={`btn-primary${this.state.tagSaving ? ' disabled' : ''}`}
                onClick={this.state.tagSaving ? undefined : this.saveTags}
              >
                {this.state.tagSaving ? t('common.saving') : t('specialty.save')}
              </View>
            </View>
          </View>
        )}

        {/* 绑定邮箱弹层（微信注册用户） */}
        {this.state.beSheet && (() => {
          const be = this.state.beSheet!;
          return (
            <View className='ps-overlay' onClick={() => this.setState({ beSheet: null })}>
              <View className='ps-sheet' onClick={e => e.stopPropagation()}>
                <Text className='ps-title'>📧 {t('profile.bindEmail')}</Text>
                <Text className='ps-hint'>{t('profile.bindEmailHint')}</Text>
                <Text className='ps-label'>{t('profile.emailAddr')}</Text>
                <Input className='input' type='text' placeholder={t('profile.emailAddr')} placeholderClass='ph' value={be.email} onInput={e => this.setState({ beSheet: { ...be, email: e.detail.value } })} />
                <Text className='ps-label'>{t('landing.codePlaceholder')}</Text>
                <View className='pf-code-row'>
                  <Input className='input pf-code-input' type='number' maxlength={6} placeholder={t('landing.codePlaceholder')} placeholderClass='ph' value={be.code} onInput={e => this.setState({ beSheet: { ...be, code: e.detail.value } })} />
                  <View className={`pf-code-btn ${this.state.beCountdown > 0 ? 'disabled' : ''}`} onClick={this.state.beCountdown > 0 ? undefined : this.sendBindCode}>
                    {this.state.beCountdown > 0 ? t('landing.codeResend', { s: this.state.beCountdown }) : t('landing.codeSend')}
                  </View>
                </View>
                <Text className='ps-label'>{t('profile.setPassword')}</Text>
                <Input className='input' password placeholder={t('profile.passwordMin')} placeholderClass='ph' value={be.password} onInput={e => this.setState({ beSheet: { ...be, password: e.detail.value } })} />
                <View className='btn-primary' onClick={this.submitBindEmail}>{t('common.save')}</View>
              </View>
            </View>
          );
        })()}

        {/* 平台选择器（添加账号第一步） */}
        {this.state.platformPickerOpen && (
          <View className='ps-overlay' onClick={() => this.setState({ platformPickerOpen: false })}>
            <View className='ps-sheet' onClick={e => e.stopPropagation()}>
              <Text className='ps-title'>{t('profile.pickPlatform')}</Text>
              <View className='ps-grid'>
                {PLATFORM_REGISTRY.map(p => {
                  const added = socials.some((s: any) => s.platformId === p.id);
                  return (
                    <View
                      key={p.id}
                      className={`ps-plat ${added ? 'added' : ''}`}
                      onClick={added ? undefined : () => this.pickPlatform(p.id)}
                    >
                      <Text className='ps-plat-icon'>{p.icon}</Text>
                      <Text className='ps-plat-name'>{p.name}</Text>
                      {added && <Text className='ps-plat-added'>{t('profile.alreadyAdded')}</Text>}
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* 账号编辑弹层（添加/编辑共用） */}
        {this.state.socialSheet && (() => {
          const sheet = this.state.socialSheet!;
          const p = platformById(sheet.platformId);
          const isWechat = sheet.platformId === 'wechat';
          return (
            <View className='ps-overlay' onClick={() => this.setState({ socialSheet: null })}>
              <View className='ps-sheet' onClick={e => e.stopPropagation()}>
                <Text className='ps-title'>{p.icon} {p.name}</Text>
                <Text className='ps-label'>{isWechat ? t('profile.wechatLabel') : (p.inputType === 'id' ? t('profile.accountId') : t('profile.homepageUrl'))}</Text>
                <Input
                  className='input'
                  placeholder={isWechat ? t('profile.wechatOptionalPh') : p.placeholder}
                  value={sheet.account}
                  onInput={e => this.setState({ socialSheet: { ...sheet, account: e.detail.value } })}
                />
                {isWechat && <Text className='ps-hint'>{t('wx.autoDetect')}</Text>}
                {!isWechat && p.hasFollowers && (
                  <View>
                    <Text className='ps-label'>{t('profile.followersLabel')}</Text>
                    <Input
                      className='input'
                      type='number'
                      placeholder={t('profile.followersLabel')}
                      value={sheet.followers}
                      onInput={e => this.setState({ socialSheet: { ...sheet, followers: e.detail.value } })}
                    />
                  </View>
                )}
                <View className='btn-primary' onClick={this.saveSheet}>{t('common.save')}</View>
                {sheet.mode === 'edit' && (
                  <Text className='ps-delete' onClick={this.deleteAccount}>{t('profile.deleteAccount')}</Text>
                )}
              </View>
            </View>
          );
        })()}

        {/* 操作 */}
        <View className='card actions'>
          <Text className='action-item' onClick={this.switchLanguage}>
            🌐 {t('profile.language')}：{LOCALES.find(l => l.id === getLocale())?.label}
          </Text>
          {/* 微信注册用户补绑邮箱（可用邮箱登录网页版 + 接收邮件提醒） */}
          {!u.email && (
            <Text className='action-item' onClick={() => this.setState({ beSheet: { email: '', code: '', password: '' } })}>
              📧 {t('profile.bindEmail')}
            </Text>
          )}
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
