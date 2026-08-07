/**
 * 轻量 i18n runtime（自研，~100行）
 *
 * 取值优先级: 远端词典(运营在 admin「本地化」矩阵改的) → 打包词典(当前语言) → 打包中文 → key
 * - 打包词典是兜底: API 挂/弱网也永远有文案
 * - 远端词典带版本缓存: 启动读 storage 立即可用，异步拉 API 比对版本更新
 * - 切换语言: profile 页调 setLocale()，tabBar 文字随之运行时更新
 */
import Taro from '@tarojs/taro';
import { emitSessionChange } from './session';
import { i18n as i18nApi } from './api';
import zh from '../i18n/zh.json';
import ja from '../i18n/ja.json';
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';

export type Locale = 'zh' | 'ja' | 'en' | 'vi';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
  { id: 'vi', label: 'Tiếng Việt' },
];

const BUNDLED: Record<Locale, Record<string, string>> = { zh, ja, en, vi };
const LOCALE_KEY = 'herix_locale';
const DICT_KEY = (l: Locale) => `herix_i18n_${l}`;

let currentLocale: Locale = 'zh';
let remoteDict: Record<string, string> = {};

function detectLocale(): Locale {
  try {
    const sys = (Taro.getSystemInfoSync().language || '').toLowerCase();
    if (sys.startsWith('zh')) return 'zh';
    if (sys.startsWith('ja')) return 'ja';
    if (sys.startsWith('en')) return 'en';
    if (sys.startsWith('vi')) return 'vi';
  } catch { /* 检测失败走默认 */ }
  return 'zh';
}

function interpolate(s: string, params?: Record<string, any>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

/** 取词条。远端 → 打包(当前语言) → 打包中文 → key 本身 */
export function t(key: string, params?: Record<string, any>): string {
  const v = remoteDict[key] ?? BUNDLED[currentLocale]?.[key] ?? BUNDLED.zh[key] ?? key;
  return interpolate(v, params);
}

export function getLocale(): Locale {
  return currentLocale;
}

/** 取词条,词典没有该 key 时用 fallback(用于动态数据的可选翻译,如分类 label:
 *  运营新建的分类没有词条时优雅降级显示后端原文) */
export function tf(key: string, fallback: string, params?: Record<string, any>): string {
  const v = t(key, params);
  return v === key ? fallback : v;
}

function loadCachedDict(locale: Locale) {
  try {
    const cached = Taro.getStorageSync(DICT_KEY(locale));
    remoteDict = (cached && cached.entries) || {};
  } catch {
    remoteDict = {};
  }
}

async function fetchRemoteDict(locale: Locale) {
  try {
    const d: any = await i18nApi.dict(locale);
    if (d && d.entries) {
      remoteDict = d.entries;
      Taro.setStorageSync(DICT_KEY(locale), { version: d.version, entries: d.entries });
    }
  } catch {
    /* 拉取失败无碍: 缓存/打包词典兜底 */
  }
}

/** tabBar 文字随语言运行时更新（tabBar 是静态配置，只能用 API 改） */
function applyTabBar() {
  const items = [
    { index: 0, text: t('tabbar.explore') },
    { index: 1, text: t('tabbar.tasks') },
    { index: 2, text: t('tabbar.messages') },
    { index: 3, text: t('tabbar.profile') },
  ];
  for (const it of items) {
    Taro.setTabBarItem({ index: it.index, text: it.text }).catch(() => { /* 非tabBar上下文时忽略 */ });
  }
}

/** app 启动时调用一次 */
export function initI18n() {
  let stored: Locale | '' = '';
  try {
    stored = Taro.getStorageSync(LOCALE_KEY);
  } catch { /* 无缓存 */ }
  currentLocale = (stored as Locale) || detectLocale();
  loadCachedDict(currentLocale);
  fetchRemoteDict(currentLocale).then(() => applyTabBar());
  if (currentLocale !== 'zh') applyTabBar(); // 非中文时先用打包词典立即刷 tabBar
}

/** 切换语言（profile 页调用）。返回 Promise 便于调用方切完 setState 重渲染 */
export async function setLocale(locale: Locale) {
  currentLocale = locale;
  try {
    Taro.setStorageSync(LOCALE_KEY, locale);
  } catch { /* 存不上也不阻断 */ }
  loadCachedDict(locale);
  applyTabBar(); // 先用打包词典即时生效
  await fetchRemoteDict(locale);
  applyTabBar(); // 远端词典到位后再刷一次
  emitSessionChange(); // 语言变化也是跨 tab 全局状态，通知订阅页重拉（任务标题/简介按语言）
}
