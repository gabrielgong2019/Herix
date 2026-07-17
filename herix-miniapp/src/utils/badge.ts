/**
 * 消息 tab 未读气泡（2026-07-17）。
 * 调用时机：App onShow、消息页加载/已读操作后、登录成功后。
 * setTabBarBadge 在非 tab 页调用会抛错，一律静默吞掉。
 */
import Taro from '@tarojs/taro';
import { notifications, getToken } from './api';

/** 消息页在 app.config.ts tabBar.list 中的下标 */
const MESSAGES_TAB_INDEX = 2;

export async function refreshUnreadBadge(): Promise<void> {
  try {
    if (!getToken()) {
      await Taro.removeTabBarBadge({ index: MESSAGES_TAB_INDEX }).catch(() => {});
      return;
    }
    const d: any = await notifications.list();
    const unread = Number(d?.unread) || 0;
    if (unread > 0) {
      await Taro.setTabBarBadge({ index: MESSAGES_TAB_INDEX, text: unread > 99 ? '99+' : String(unread) });
    } else {
      await Taro.removeTabBarBadge({ index: MESSAGES_TAB_INDEX });
    }
  } catch {
    /* 非 tab 页 / 未登录 / 网络失败：气泡是辅助提示，静默 */
  }
}
