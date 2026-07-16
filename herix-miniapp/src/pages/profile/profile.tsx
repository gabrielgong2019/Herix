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

const AVATAR_COLORS = ['#D43B27', '#34c759', '#f5a623', '#ff3b30', '#5856d6', '#ff9500'];
const fmt = (n: any) => String(Math.round(Math.abs(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function parseJSON(s: any, fallback: any) {
  if (!s) return fallback;
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
// 微信/手机号校验（等价 herix obValidateWechat）
function validateWechat(val: string): { ok: boolean; saved?: string | null; msg?: string } {
  if (!val) return { ok: true, saved: null };
  if (/^\d+$/.test(val)) {
    if (!/^1[3-9]\d{9}$/.test(val)) return { ok: false, msg: '手机号格式有误（需11位，以1开头）' };
    return { ok: true, saved: '+86' + val };
  }
  if (val.length < 6 || val.length > 20) return { ok: false, msg: '微信号需6-20位' };
  return { ok: true, saved: val };
}
// 评级（等价 herix profileHTML）
function computeRating(rt: any): { level: string; color: string; next: string } {
  const ctasks = rt.completedTasks || 0;
  const grate = rt.goodRate || 0;
  let level = '未评级';
  let color = 'var(--text-muted)';
  if (ctasks >= 50 && grate >= 0.95) { level = 'Platinum'; color = '#7c3aed'; }
  else if (ctasks >= 25 && grate >= 0.85) { level = 'Gold'; color = '#f59e0b'; }
  else if (ctasks >= 10 && grate >= 0.75) { level = 'Silver'; color = '#9ca3af'; }
  else if (ctasks >= 3 && grate >= 0.6) { level = 'Bronze'; color = '#cd7f32'; }
  let next = '';
  if (level === '未评级') next = `距离 Bronze：还需完成 ${Math.max(0, 3 - ctasks)}单`;
  else if (level === 'Bronze') next = `距离 Silver：还需完成 ${Math.max(0, 10 - ctasks)}单，好评率达 75%`;
  else if (level === 'Silver') next = `距离 Gold：还需完成 ${Math.max(0, 25 - ctasks)}单，好评率达 85%`;
  else if (level === 'Gold') next = `距离 Platinum：还需完成 ${Math.max(0, 50 - ctasks)}单，好评率达 95%`;
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
      Taro.showToast({ title: '请填写账号和密码', icon: 'none' });
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
      Taro.showToast({ title: err.message || '登录失败', icon: 'none' });
    } finally {
      this.setState({ loading: false });
    }
  };

  handleRegister = async () => {
    const { email, password, nickname, roleIndex } = this.state;
    if (!email || !password) {
      Taro.showToast({ title: '请填写邮箱和密码', icon: 'none' });
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
      Taro.showToast({ title: err.message || '注册失败', icon: 'none' });
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
      Taro.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    try {
      await users.updateMe({ nickname: name });
      this.setState({ editingName: false });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '保存失败', icon: 'none' });
    }
  };

  toggleCurrency = async () => {
    const cur = this.state.user?.display_currency || 'JPY';
    const next = cur === 'CNY' ? 'JPY' : 'CNY';
    try {
      await ambassador.updateProfile({ display_currency: next } as any);
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '切换失败', icon: 'none' });
    }
  };

  addBrandRole = async () => {
    const res = await Taro.showModal({ title: '开通品牌商家', content: '开通后可发布任务招募赫使，确认开通？' });
    if (!res.confirm) return;
    try {
      const r = await users.addRole('BRAND');
      if (r?.token) setToken(r.token);
      Taro.showToast({ title: '已开通', icon: 'success' });
      this.loadUser();
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '开通失败', icon: 'none' });
    }
  };

  switchAccount = async () => {
    try {
      const r = await authApi.switchAccount();
      if (r?.token) setToken(r.token);
      this.loadUser();
      Taro.showToast({ title: '已切换', icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '切换失败', icon: 'none' });
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
      const check = validateWechat(f.wechat.trim());
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
      Taro.showToast({ title: '社交账号已保存', icon: 'success' });
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
            <Text className='auth-title'>{showRegister ? '注册' : '登录'}</Text>
            <Text className='auth-subtitle'>Herix 赫使</Text>
            {showRegister ? (
              <>
                <Input className='input' placeholder='邮箱' value={email} onInput={e => this.setState({ email: e.detail.value })} />
                <Input className='input' placeholder='昵称' value={nickname} onInput={e => this.setState({ nickname: e.detail.value })} />
                <Input className='input' placeholder='密码（至少6位）' password value={password} onInput={e => this.setState({ password: e.detail.value })} />
                <View className='role-select'>
                  <Text className={roleIndex === 1 ? 'role-active' : 'role'} onClick={() => this.setState({ roleIndex: 1 })}>我是赫使</Text>
                  <Text className={roleIndex === 0 ? 'role-active' : 'role'} onClick={() => this.setState({ roleIndex: 0 })}>我是商家</Text>
                </View>
                <Button className='btn-primary' onClick={this.handleRegister} loading={loading}>注册</Button>
                <Text className='switch-auth' onClick={() => this.setState({ showRegister: false })}>已有账号？去登录</Text>
              </>
            ) : (
              <>
                <Input className='input' placeholder='邮箱或手机号' value={account} onInput={e => this.setState({ account: e.detail.value })} />
                <Input className='input' placeholder='密码' password value={password} onInput={e => this.setState({ password: e.detail.value })} />
                <Button className='btn-primary' onClick={this.handleLogin} loading={loading}>登录</Button>
                <Text className='switch-auth' onClick={() => this.setState({ showRegister: true })}>没有账号？去注册</Text>
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
          <Text className='top-role'>{isHerald ? '赫使' : '品牌商家'}</Text>
          {editingName ? (
            <View className='name-edit'>
              <Input className='input' placeholder='新昵称' value={newNick} onInput={e => this.setState({ newNick: e.detail.value })} />
              <View className='name-edit-btns'>
                <Text className='btn-outline sm' onClick={() => this.setState({ editingName: false })}>取消</Text>
                <Text className='btn-primary sm' onClick={this.saveNickname}>保存</Text>
              </View>
            </View>
          ) : (
            <Text className='btn-outline sm' onClick={() => this.setState({ editingName: true, newNick: u.nickname || '' })}>修改昵称</Text>
          )}
        </View>

        {/* 钱包卡（赫使）*/}
        {isHerald && (
          <View className='wallet-card' onClick={this.goWallet}>
            <View className='wc-top'>
              <View>
                <Text className='wc-label'>可用余额</Text>
                <Text className='wc-amount'>¥{fmt(bal.available)}</Text>
              </View>
              <Text className='wc-arrow'>→ 钱包</Text>
            </View>
            <View className='wc-stats'>
              <View className='wc-stat'>
                <Text className='wc-stat-label'>待结算</Text>
                <Text className='wc-stat-val'>¥{fmt(bal.pendingAmount)}</Text>
              </View>
              <View className='wc-stat'>
                <Text className='wc-stat-label'>本月收入</Text>
                <Text className='wc-stat-val income'>+¥{fmt(bal.periodInflow)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 账号信息 */}
        <View className='card'>
          <Text className='card-head'>账号信息</Text>
          {isHerald && (
            <>
              {this.renderRow('居住地', u.residence === 'japan' ? '🇯🇵 在日本' : u.residence === 'china' ? '🇨🇳 中国' : u.residence === 'overseas' ? '🌏 海外' : '未设置')}
              {this.renderRow('KYC状态', u.kyc_status === 'approved' ? '✅ 已通过' : u.kyc_status === 'pending' ? '⏳ 审核中' : '未提交')}
              {u.residence === 'japan' && this.renderRow('在留声明', u.declaration_status === 'submitted' || u.declaration_status === 'approved' ? '✅ 已提交' : '未提交')}
              {this.renderRow('打款方式', bank ? bank.type || '已设置' : '未设置')}
              <View className='info-row'>
                <Text className='info-label'>结算/展示币种</Text>
                <Text className='info-val link' onClick={this.toggleCurrency}>
                  {(u.display_currency || 'JPY') === 'CNY' ? '🇨🇳 CNY' : '🇯🇵 JPY'} · 切换
                </Text>
              </View>
            </>
          )}
          {this.renderRow('角色', isHerald ? '赫使（大使）' : '品牌商家')}
        </View>

        {/* 评级卡（赫使）*/}
        {isHerald && u.rating && (() => {
          const rt = u.rating || {};
          const r = computeRating(rt);
          return (
            <View className='card'>
              <Text className='card-head'>成长档案</Text>
              <View className='rating-row'>
                <View className='rating-cell'>
                  <Text className='rating-cell-label'>评级</Text>
                  <Text className='rating-cell-val' style={{ color: r.color }}>{r.level}</Text>
                </View>
                <View className='rating-cell'>
                  <Text className='rating-cell-label'>完成任务</Text>
                  <Text className='rating-cell-val'>{rt.completedTasks || 0}单</Text>
                </View>
                <View className='rating-cell'>
                  <Text className='rating-cell-label'>好评率</Text>
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
              <Text className='card-head'>社交账号</Text>
              <Text className='card-action' onClick={editingSocial ? () => this.setState({ editingSocial: false }) : this.openSocialEdit}>
                {editingSocial ? '收起' : '编辑'}
              </Text>
            </View>
            {!editingSocial &&
              (socials.length === 0 ? (
                <View className='info-row'>
                  <Text className='social-empty'>未添加 · <Text className='link' onClick={this.openSocialEdit}>立即添加</Text></Text>
                </View>
              ) : (
                socials.map((s: any) => {
                  const sp = platformById(s.platformId);
                  const tier = tierSnap[s.platformId];
                  let sval = s.accountId || (s.url ? s.url.replace('https://', '').split('/')[0] : '—');
                  if (s.followers) sval += ` · ${fmt(s.followers)}粉`;
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
                <Text className='se-label'>💬 微信 ID / 手机号</Text>
                <Input className='input' placeholder='微信号 或 手机号（选填）' value={socialForm.wechat || ''} onInput={e => this.setSocial('wechat', e.detail.value)} />
                <Text className='se-hint'>手机号输入纯数字自动识别</Text>
                {PLATFORM_REGISTRY.filter(p => p.id !== 'wechat').map(p => (
                  <View key={p.id} className='se-field'>
                    <Text className='se-label'>{p.icon} {p.name} <Text className='se-opt'>(选填)</Text></Text>
                    <View className='se-row'>
                      <Input className='input flex' placeholder={p.placeholder} value={socialForm[`plat-${p.id}`] || ''} onInput={e => this.setSocial(`plat-${p.id}`, e.detail.value)} />
                      {p.hasFollowers && (
                        <Input className='input fol' type='number' placeholder='粉丝数' value={socialForm[`fol-${p.id}`] || ''} onInput={e => this.setSocial(`fol-${p.id}`, e.detail.value)} />
                      )}
                    </View>
                  </View>
                ))}
                <View className='btn-primary' onClick={this.saveSocial}>保存</View>
              </View>
            )}
          </View>
        )}

        {/* 操作 */}
        <View className='card actions'>
          <Text className='action-item' onClick={this.switchLanguage}>
            🌐 {t('profile.language')}：{LOCALES.find(l => l.id === getLocale())?.label}
          </Text>
          {!u.is_onboarded && <Text className='action-item primary' onClick={this.goOnboard}>完成入驻设置 →</Text>}
          {!roles.includes('BRAND') && roles.includes('HERALD') && (
            <Text className='action-item' onClick={this.addBrandRole}>🏢 开通品牌商家功能</Text>
          )}
          {u.linkedAccount && (
            <Text className='action-item primary' onClick={this.switchAccount}>
              🔁 切换到 {u.linkedAccount.nickname}（{u.linkedAccount.role === 'BRAND' ? '品牌商家' : '赫使'}）
            </Text>
          )}
          <Text className='action-item danger' onClick={this.handleLogout}>退出登录</Text>
        </View>
      </View>
    );
  }
}
