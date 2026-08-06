import Taro from '@tarojs/taro';
import type { ReviewDecision, UserRole } from '@herix/shared';
import { t, getLocale } from './i18n'; // 循环引用安全：仅在函数体内使用

// 微信原生 wx.cloud API，Taro 未完整封装，运行时在 weapp 端全局存在
declare const wx: any;

// ── 云托管配置（小程序端专用，需要在微信云托管控制台创建服务后填入）──
const CLOUD_ENV_ID = 'prod-herix-d5gh5h4nv767053ae'; // 云开发环境ID
const CLOUD_SERVICE_NAME = 'herix-proxy'; // 云托管服务名称，需与部署时一致
const DIAG_KEY = 'herix_diag_queue';
const DIAG_MAX = 20;

// H5 端用相对路径，自动打"当前页面所在的服务器"——本地测试（localhost:4005）
// 打本地后端，以后部署到哪个域名就自动打那个域名自己，不用写死成线上地址
const H5_BASE_URL = '/api';

// ── 诊断队列（2026-08-06）：请求失败先写本地，成功后补报服务器，
//    抓"冷启动首请求客户端超时、服务器无日志"这类问题。fire-and-forget，不阻塞业务。 ──
function queueDiag(entry: Record<string, unknown>) {
  try {
    const raw = Taro.getStorageSync(DIAG_KEY) || '[]';
    let arr: any[] = [];
    try { arr = JSON.parse(raw); } catch {}
    arr.push({ ...entry, ts: new Date().toISOString() });
    if (arr.length > DIAG_MAX) arr = arr.slice(-DIAG_MAX);
    Taro.setStorageSync(DIAG_KEY, JSON.stringify(arr));
  } catch {}
}

function flushDiag() {
  try {
    const raw = Taro.getStorageSync(DIAG_KEY) || '[]';
    let arr: any[] = [];
    try { arr = JSON.parse(raw); } catch {}
    if (!arr.length) return;
    const body = { events: arr };
    const send = () => {
      if (isWeapp) {
        return wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path: '/api/diag/miniapp',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: body,
        });
      }
      return Taro.request({ url: `${H5_BASE_URL}/diag/miniapp`, method: 'POST', header: { 'Content-Type': 'application/json' }, data: body, dataType: 'json' });
    };
    send().then(() => Taro.setStorageSync(DIAG_KEY, '[]')).catch(() => { /* 下次成功再补报 */ });
  } catch {}
}

/** 服务端相对资源路径（/uploads/...）→ 可渲染 URL：H5 同源直用，weapp 拼生产域名 */
export function assetUrl(p?: string | null): string {
  if (!p) return '';
  if (p.startsWith('http')) return p;
  return (isWeapp ? 'https://herix.huaxuex.com' : '') + p;
}

const isWeapp = process.env.TARO_ENV === 'weapp';

// 请求失败时，除了错误信息，把后端返回的完整 body（code/failures 等结构化字段）
// 一并挂在异常上，调用方需要时可以取，比如 applications.apply() 的 REQUIREMENTS_NOT_MET 场景

/** 后端错误 → 用户语言。约定: 后端返回 {error: 中文, code: 'SNAKE_CASE'}，
 *  词典里有 error.<code> 就用译文(带params插值)，没有则退回后端原文。 */
function apiErrorMessage(data: any): string {
  const code = data?.code;
  if (code) {
    const key = `error.${code}`;
    const tx = t(key, data);
    if (tx !== key) return tx;
  }
  return data?.error || t('error.GENERIC');
}

export class ApiError extends Error {
  data: any;
  constructor(message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.data = data;
  }
}

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
  const startedAt = Date.now();
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = getToken();
    if (token) {
      header['Authorization'] = `Bearer ${token}`;
    }
  }

  const callWeapp = () => wx.cloud.callContainer({
    config: { env: CLOUD_ENV_ID },
    path: `/api${path}`,
    method,
    header: { ...header, 'X-WX-SERVICE': CLOUD_SERVICE_NAME },
    data,
  });

  try {
    if (isWeapp) {
      // 小程序端：走微信云托管，绕开服务器域名白名单/备案要求
      // 冷启动期间首次请求可能超时，静默重试一次再报错
      let res = await callWeapp().catch(async (e: any) => {
        if (e?.errMsg?.includes('timeout') || e?.errMsg?.includes('fail')) {
          await new Promise(r => setTimeout(r, 1500));
          return callWeapp();
        }
        throw e;
      });

      if (res.statusCode >= 400) {
        throw new ApiError(apiErrorMessage(res.data), res.data);
      }

      flushDiag();
      return res.data as T;
    }

    // H5 端：直连真实后端域名
    const res = await Taro.request({
      url: `${H5_BASE_URL}${path}`,
      method: method as any,
      header,
      data,
      dataType: 'json',
    });

    if (res.statusCode >= 400) {
      throw new ApiError(apiErrorMessage(res.data), res.data);
    }

    flushDiag();
    return res.data as T;
  } catch (err: any) {
    queueDiag({
      path, method,
      err: err?.errMsg || err?.message || String(err),
      status: err?.statusCode ?? null,
      elapsed: Date.now() - startedAt,
      env: isWeapp ? 'weapp' : 'h5',
      hasToken: !!getToken(),
      locale: getLocale(),
    });
    if (err.errMsg?.includes('timeout') || err.errMsg?.includes('fail')) {
      Taro.showToast({ title: t('error.NETWORK'), icon: 'none' });
    }
    throw err;
  }
}

// ── Auth ──
export const auth = {
  register: (data: { email: string; password: string; nickname?: string; role: string; code?: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/register', data, false),
  /** 邮箱验证码（REGISTER 注册 / BIND_EMAIL 绑定邮箱；60秒限频，30分钟有效） */
  sendCode: (email: string, purpose: 'REGISTER' | 'BIND_EMAIL' = 'REGISTER') =>
    request<{ sent: boolean }>('POST', '/auth/send-code', { email, purpose }, false),
  /** 小程序静默登录（openid 由云托管注入）。无账号时返回 {needRegister:true} */
  wechatLogin: () => request<{ token?: string; user?: any; needRegister?: boolean }>('POST', '/auth/wechat-login', {}, false),
  /** 微信一键注册（幂等：已注册直接返回登录态） */
  wechatRegister: (nickname?: string) =>
    request<{ token: string; user: any }>('POST', '/auth/wechat-register', { nickname }, false),
  /** 已有邮箱账号登录并绑定当前微信 */
  bindWechat: (data: { account: string; password: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/bind-wechat', data, false),
  /** 微信注册用户补绑邮箱+密码 */
  bindEmail: (data: { email: string; code: string; password: string }) =>
    request<{ bound: boolean; email: string }>('POST', '/auth/bind-email', data),
  /** 给已登录用户自己的邮箱发修改密码验证码 */
  sendSetPasswordCode: () =>
    request<{ sent: boolean }>('POST', '/auth/send-set-password-code'),
  /** 修改密码：OTP 方式 { newPassword, code } 或原密码方式 { newPassword, oldPassword } */
  changePassword: (data: { newPassword: string; code?: string; oldPassword?: string }) =>
    request<{ changed: boolean }>('POST', '/auth/change-password', data),
  login: (data: { account: string; password: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/login', data, false),
  me: () => request<any>('GET', '/auth/me'),
  switchAccount: () => request<{ token: string; user: any }>('POST', '/auth/switch-account'),
};

// ── Tasks ──
export const tasks = {
  list: (params?: { status?: string; mode?: string; page?: number; search?: string; category?: string; allCommunities?: boolean }) =>
    request<{ tasks: any[]; pagination: any }>('GET', '/tasks', { ...params, lang: getLocale() }, false),
  detail: (id: string) => request<any>('GET', `/tasks/${id}`, { lang: getLocale() }, false),
  create: (data: any) => request<any>('POST', '/tasks', data),
  publish: (id: string) => request<any>('PATCH', `/tasks/${id}/publish`),
  escrow: (id: string) => request<any>('PATCH', `/tasks/${id}/escrow`),
  complete: (id: string) => request<any>('PATCH', `/tasks/${id}/complete`),
};

// ── Applications ──
export const applications = {
  apply: (taskId: string, message?: string, proposalText?: string, proposalLinks?: string[]) =>
    request<any>('POST', `/applications/${taskId}`, { message, proposalText, proposalLinks }),
  review: (id: string, status: ReviewDecision) =>
    request<any>('PATCH', `/applications/${id}/review`, { status }),
  my: () => request<any[]>('GET', '/applications/my', { lang: getLocale() }),
  withdraw: (id: string) => request<any>('POST', `/applications/${id}/withdraw`),
};

// ── Submissions ──
/** 提交图片上传（multipart）。weapp 走生产域名直传——需在小程序后台配置 uploadFile 合法域名
 *  https://herix.huaxuex.com（云托管 callContainer 不支持 multipart，2026-07-26） */
export async function uploadSubmissionImage(filePath: string): Promise<string> {
  const token = getToken();
  const url = (isWeapp ? 'https://herix.huaxuex.com' : '') + '/api/uploads/submission-image';
  const res = await Taro.uploadFile({
    url,
    filePath,
    name: 'file',
    header: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body: any = res.data;
  try { body = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* keep raw */ }
  if (res.statusCode >= 400 || !body?.url) {
    throw new ApiError(apiErrorMessage(body), body);
  }
  return body.url as string;
}

export interface TaskSubmissionContext {
  submission: any | null;
  nextAction: 'SUBMIT_DRAFT' | 'SUBMIT_FINAL' | 'WAITING_REVIEW' | 'DONE';
  requireDraft: boolean;
  minImages: number;
  platformHints: string[];
}

export const submissions = {
  submit: (taskId: string, data: { contentUrls?: string[]; description?: string; screenshotUrls?: string[] }) =>
    request<any>('POST', `/submissions/${taskId}`, data),
  review: (id: string, status: ReviewDecision, reviewNote?: string) =>
    request<any>('PATCH', `/submissions/${id}/review`, { status, reviewNote }),
  byTask: (taskId: string) => request<any[]>('GET', `/submissions/task/${taskId}`),
  /** 赫使侧：单次获取提交状态 + 下一步动作 + 任务配置，替代原来两次串行请求 */
  myForTask: (taskId: string) => request<TaskSubmissionContext>('GET', `/submissions/task/${taskId}/my`),
  my: () => request<any[]>('GET', '/submissions/my'),
  /** 评审往来审计链（商家赫使同源），供审核往来时间线渲染 */
  revisions: (subId: string) => request<any[]>('GET', `/submissions/${subId}/revisions`),
};

// ── Arbitrations（改稿额度用尽后的平台仲裁）──
export const arbitrations = {
  open: (submissionId: string, reason: string) =>
    request<any>('POST', '/arbitrations', { submissionId, reason }),
};

// ── Users ──
export const users = {
  addRole: (role: Extract<UserRole, 'HERALD' | 'BRAND'>) =>
    request<{ token: string; roles: string[] }>('POST', '/users/add-role', { role }),
  updateMe: (data: { nickname?: string; lang?: string }) => request<any>('PATCH', '/users/me', data),
};

// ── Ambassador（赫使身份/入驻）──
export const ambassador = {
  getProfile: () => request<any>('GET', '/ambassador/profile'),
  updateProfile: (data: {
    residence?: string;
    residenceCountry?: string;
    kycStatus?: string;
    visaType?: string;
    bankAccount?: any;
    socialPlatforms?: any[];
  }) => request<any>('PATCH', '/ambassador/profile', data),
  onboard: (data: {
    residence?: string;
    residenceCountry?: string;
    visaType?: string;
    hasWorkPermit?: boolean;
    workPermitHours?: number;
    bankAccountType?: string;
    bankDetails?: any;
    socialPlatforms?: any[];
  }) => request<{ success: boolean; profile: any }>('POST', '/ambassador/onboard', data),
};

// ── Wallet ──
export const wallet = {
  balance: (params?: { from?: string; to?: string }) => request<any>('GET', '/wallet/balance', params),
  transactions: (params?: { type?: string; page?: number; limit?: number; walletType?: string; from?: string; to?: string }) =>
    request<{ transactions: any[]; total: number; page: number; limit: number }>('GET', '/wallet/transactions', params),
  methods: () => request<any[]>('GET', '/wallet/methods'),
  addMethod: (data: { type: string; country?: string; label: string; account_details: any; is_default?: boolean }) =>
    request<{ id: string }>('POST', '/wallet/methods', data),
  deleteMethod: (id: string) => request<any>('DELETE', `/wallet/methods/${id}`),
  withdrawalInfo: (amount: number, methodId?: string) =>
    request<{ requestAmount: number; fee: number; netAmount: number; scheduleMode: string; nextPayoutDate?: string; note?: string }>(
      'GET', '/wallet/withdrawal-info', { amount, ...(methodId ? { methodId } : {}) },
    ),
  withdrawRequest: (data: { amount: number; method: string; accountDetails: any; methodId?: string }) =>
    request<any>('POST', '/wallet/withdraw-request', data),
  // withdraw: 对应新设计的提现执行接口，后端还没有（见迁移计划第7节），Phase 3 补上后端后再加这个方法
};

// ── Referrals ──
export const referrals = {
  myCodes: () => request<any[]>('GET', '/referrals/my-codes', { lang: getLocale() }),
  /** 明细模式：本人在某任务下的邀请进度（脱敏标识） */
  myRecords: (taskId: string) => request<any[]>('GET', `/referrals/my-records/${taskId}`),
  /** 保存赫使自定义推广文案 */
  patchShareIntro: (id: string, share_intro: string | null) =>
    request<{ ok: boolean }>('PATCH', `/referrals/my-codes/${id}/share-intro`, { share_intro }),
};

// ── Categories ──
export const categories = {
  list: () => request<any[]>('GET', '/categories', undefined, false),
};

// ── Specialty Tags ──
export const specialtyTags = {
  list: () => request<{ id: string; sort_order: number }[]>('GET', '/specialty-tags', undefined, false),
  myTags: () => request<{ id: string; source: string }[]>('GET', '/specialty-tags/herald/me', undefined, true),
  saveTags: (tagIds: string[]) => request<any>('PUT', '/specialty-tags/herald/me', { tagIds }, true),
};

// ── Communities ──
export const communities = {
  list: () => request<{ id: string; labelKey: string; region: string }[]>('GET', '/communities', undefined, false),
};

// ── i18n（公开，不需登录）──
export const i18n = {
  dict: (locale: string) => request<{ version: string; locale: string; entries: Record<string, string> }>(
    'GET', `/i18n/${locale}`, undefined, false,
  ),
};

// ── Legal（服务协议/隐私政策，公开，不需登录）──
export const legal = {
  get: (scope: 'weapp' | 'web', doc: 'user-agreement' | 'privacy-policy', lang: string) =>
    request<{ scope: string; doc: string; lang: string; html: string }>(
      'GET', `/legal/${scope}/${doc}?lang=${lang}`, undefined, false,
    ),
};

// ── Brands（品牌主页，公开）──
export const brands = {
  getProfile: (userId: string) =>
    request<{ profile: any; tasks: any[] }>('GET', `/brands/${userId}`, undefined, false),
};

// ── Notifications ──
export const notifications = {
  // 本端=赫使端, 声明 role 做通知隔离(双角色账号的商家侧通知不在这里出现)
  list: () => request<{ unread: number; notifications: any[] }>('GET', '/notifications?role=HERALD'),
  markRead: (id: string) => request<any>('PATCH', `/notifications/${id}/read`),
  markAllRead: () => request<any>('PATCH', '/notifications/read-all?role=HERALD'),
};
