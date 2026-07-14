import Taro from '@tarojs/taro';

// 微信原生 wx.cloud API，Taro 未完整封装，运行时在 weapp 端全局存在
declare const wx: any;

// ── 云托管配置（小程序端专用，需要在微信云托管控制台创建服务后填入）──
const CLOUD_ENV_ID = 'REPLACE_WITH_CLOUD_ENV_ID'; // 云开发环境ID
const CLOUD_SERVICE_NAME = 'herix-proxy'; // 云托管服务名称，需与部署时一致

// H5 / 开发调试走的直连地址（真实 HTTPS 域名，不能用相对路径）
const H5_BASE_URL = 'https://herix.huaxuex.com/api';

const isWeapp = process.env.TARO_ENV === 'weapp';

// 存储 token 的 key
const TOKEN_KEY = 'herix_token';

export function getToken(): string | null {
  try {
    return Taro.getStorageSync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export function clearToken() {
  Taro.removeStorageSync(TOKEN_KEY);
}

// 通用请求
async function request<T = any>(
  method: string,
  path: string,
  data?: any,
  auth = true,
): Promise<T> {
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = getToken();
    if (token) {
      header['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    if (isWeapp) {
      // 小程序端：走微信云托管，绕开服务器域名白名单/备案要求
      const res = await wx.cloud.callContainer({
        config: { env: CLOUD_ENV_ID },
        path: `/api${path}`,
        method,
        header: { ...header, 'X-WX-SERVICE': CLOUD_SERVICE_NAME },
        data,
      });

      if (res.statusCode >= 400) {
        throw new Error(res.data?.error || '请求失败');
      }

      return res.data as T;
    }

    // H5 端：直连真实后端域名
    const res = await Taro.request({
      url: `${H5_BASE_URL}${path}`,
      method,
      header,
      data,
      dataType: 'json',
    });

    if (res.statusCode >= 400) {
      throw new Error(res.data?.error || '请求失败');
    }

    return res.data as T;
  } catch (err: any) {
    if (err.errMsg?.includes('timeout') || err.errMsg?.includes('fail')) {
      Taro.showToast({ title: '网络连接失败', icon: 'none' });
    }
    throw err;
  }
}

// ── Auth ──
export const auth = {
  register: (data: { email: string; password: string; nickname?: string; role: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/register', data, false),
  login: (data: { account: string; password: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/login', data, false),
  me: () => request<any>('GET', '/auth/me'),
};

// ── Tasks ──
export const tasks = {
  list: (params?: { status?: string; mode?: string; page?: number }) =>
    request<{ tasks: any[]; pagination: any }>('GET', '/tasks', params, false),
  detail: (id: string) => request<any>('GET', `/tasks/${id}`, undefined, false),
  create: (data: any) => request<any>('POST', '/tasks', data),
  publish: (id: string) => request<any>('PATCH', `/tasks/${id}/publish`),
  escrow: (id: string) => request<any>('PATCH', `/tasks/${id}/escrow`),
  complete: (id: string) => request<any>('PATCH', `/tasks/${id}/complete`),
};

// ── Applications ──
export const applications = {
  apply: (taskId: string, message?: string) =>
    request<any>('POST', `/applications/${taskId}`, { message }),
  review: (id: string, status: 'APPROVED' | 'REJECTED') =>
    request<any>('PATCH', `/applications/${id}/review`, { status }),
  my: () => request<any[]>('GET', '/applications/my'),
};

// ── Submissions ──
export const submissions = {
  submit: (taskId: string, data: { contentUrl: string; description?: string; screenshotUrls?: string[] }) =>
    request<any>('POST', `/submissions/${taskId}`, data),
  review: (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) =>
    request<any>('PATCH', `/submissions/${id}/review`, { status, reviewNote }),
  byTask: (taskId: string) => request<any[]>('GET', `/submissions/task/${taskId}`),
  my: () => request<any[]>('GET', '/submissions/my'),
};

// ── Users ──
export const users = {
  updateBrandProfile: (data: any) => request<any>('PATCH', '/users/profile/brand', data),
  updateHeraldProfile: (data: any) => request<any>('PATCH', '/users/profile/herald', data),
  getHeralds: () => request<any[]>('GET', '/users/heralds', undefined, false),
  getPublic: (id: string) => request<any>('GET', `/users/${id}`, undefined, false),
  myTransactions: () => request<any[]>('GET', '/users/me/transactions'),
};
