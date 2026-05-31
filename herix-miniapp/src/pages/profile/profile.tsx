import { Component } from 'react';
import { View, Text, Input, Button, Navigator } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { auth as authApi, setToken, getToken, clearToken } from '../../utils/api';
import './profile.scss';

interface User {
  id: string;
  nickname: string;
  role: string;
  isVerified: boolean;
}

interface State {
  user: User | null;
  isLogin: boolean;
  account: string;
  password: string;
  email: string;
  nickname: string;
  roleIndex: number;
  loading: boolean;
  showRegister: boolean;
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
  };

  componentDidMount() {
    if (getToken()) {
      this.loadUser();
    }
  }

  loadUser = async () => {
    try {
      const user = await authApi.me();
      this.setState({ user, isLogin: true });
      Taro.setStorageSync('herix_user', user);
    } catch {
      clearToken();
      this.setState({ isLogin: false });
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
      Taro.showToast({ title: '登录成功', icon: 'success' });
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
      Taro.showToast({ title: '注册成功', icon: 'success' });
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

    return (
      <View className='profile-page'>
        {/* 用户信息 */}
        <View className='user-card'>
          <View className='avatar'>
            <Text>{user?.nickname?.[0] || 'U'}</Text>
          </View>
          <Text className='user-name'>{user?.nickname}</Text>
          <Text className='user-role'>{user?.role === 'BRAND' ? '品牌商家' : '赫使'}</Text>
        </View>

        {/* 菜单 */}
        <View className='menu-list'>
          {user?.role === 'HERALD' && (
            <>
              <Navigator className='menu-item' url='/pages/index/index'>
                <Text>我的报名</Text>
                <Text className='arrow'>›</Text>
              </Navigator>
              <Navigator className='menu-item' url='/pages/index/index'>
                <Text>我的提交</Text>
                <Text className='arrow'>›</Text>
              </Navigator>
            </>
          )}
          {user?.role === 'BRAND' && (
            <>
              <Navigator className='menu-item' url='/pages/task-create/task-create'>
                <Text>发布任务</Text>
                <Text className='arrow'>›</Text>
              </Navigator>
              <Navigator className='menu-item' url='/pages/index/index'>
                <Text>我的任务</Text>
                <Text className='arrow'>›</Text>
              </Navigator>
            </>
          )}
          <Navigator className='menu-item' url='/pages/index/index'>
            <Text>交易记录</Text>
            <Text className='arrow'>›</Text>
          </Navigator>
        </View>

        <Button className='btn-logout' onClick={this.handleLogout}>退出登录</Button>
      </View>
    );
  }
}
