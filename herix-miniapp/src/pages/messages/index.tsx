import { Component } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { notifications as notifApi, getToken } from '../../utils/api';
import { t } from '../../utils/i18n';
import './index.scss';

const ACCENT_MAP: Record<string, string> = {
  SUB_APPROVED: '#16a34a',
  SUB_REJECTED: '#dc2626',
  APP_APPROVED: '#16a34a',
  APP_REJECTED: '#dc2626',
  SETTLEMENT_BLOCKED: '#d97706',
};
const ICON_MAP: Record<string, string> = {
  SUB_APPROVED: '✅',
  SUB_REJECTED: '❌',
  APP_APPROVED: '🎉',
  APP_REJECTED: '😔',
  SETTLEMENT_BLOCKED: '⚠️',
};

// 相对时间（等价 herix formatNotifTime）
function timeAgo(iso: string): string {
  if (!iso) return '';
  // 注意变量名不能叫 t——会遮蔽 i18n 的 t() 函数
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return iso.slice(0, 10);
  const diff = Date.now() - ts;
  const MIN = 60000;
  const HR = 3600000;
  const DAY = 86400000;
  if (diff < MIN) return t('common.justNow');
  if (diff < HR) return t('common.minutesAgo', { n: Math.floor(diff / MIN) });
  if (diff < DAY) return t('common.hoursAgo', { n: Math.floor(diff / HR) });
  if (diff < 7 * DAY) return t('common.daysAgo', { n: Math.floor(diff / DAY) });
  return iso.slice(0, 10);
}

function metaTaskId(n: any): string | null {
  try {
    const meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata || '{}') : n.metadata || {};
    return meta.taskId || null;
  } catch {
    return null;
  }
}

interface State {
  loading: boolean;
  loggedIn: boolean;
  notifs: any[];
}

export default class Messages extends Component<{}, State> {
  state: State = {
    loading: true,
    loggedIn: true,
    notifs: [],
  };

  componentDidShow() {
    if (!getToken()) {
      this.setState({ loggedIn: false, loading: false });
      return;
    }
    this.setState({ loggedIn: true });
    this.load();
  }

  load = async () => {
    try {
      // 接口返回 {unread, notifications}，不是裸数组
      const d: any = await notifApi.list();
      const list = Array.isArray(d) ? d : d?.notifications || [];
      this.setState({ notifs: list, loading: false });
    } catch (err) {
      console.error('load notifications error:', err);
      this.setState({ loading: false });
    }
  };

  markAll = async () => {
    try {
      await notifApi.markAllRead();
      this.setState({ notifs: this.state.notifs.map(n => ({ ...n, is_read: true })) });
    } catch (err) {
      Taro.showToast({ title: t('common.opFailed'), icon: 'none' });
    }
  };

  onNotifClick = async (n: any) => {
    if (n.is_read) return;
    try {
      await notifApi.markRead(n.id);
      this.setState({ notifs: this.state.notifs.map(x => (x.id === n.id ? { ...x, is_read: true } : x)) });
    } catch (err) {
      console.error('mark read error:', err);
    }
  };

  goTask = (taskId: string) => Taro.navigateTo({ url: `/pages/task/task?id=${taskId}` });

  renderCard = (n: any) => {
    const unread = !n.is_read;
    const accent = ACCENT_MAP[n.type] || 'var(--primary)';
    const icon = ICON_MAP[n.type] || '💬';
    const taskId = metaTaskId(n);
    // 通知三语：metadata 带 taskTitle 且词典有该 type 的词条 → 前端按语言渲染；
    // 否则(老数据/未知类型)兜底展示落库时的中文 title/body
    let meta: any = {};
    try { meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata || '{}') : n.metadata || {}; } catch { meta = {}; }
    const titleKey = `notif.${n.type}.title`;
    const canTranslate = !!meta.taskTitle && t(titleKey) !== titleKey;
    const title = canTranslate ? t(titleKey, { taskTitle: meta.taskTitle }) : n.title;
    let body = canTranslate ? t(`notif.${n.type}.body`, { taskTitle: meta.taskTitle }) : n.body;
    if (canTranslate && meta.note) body += ' ' + t('task.reason', { note: meta.note });
    return (
      <View
        key={n.id}
        className='notif-card'
        style={{ borderLeftColor: unread ? accent : 'transparent' }}
        onClick={() => this.onNotifClick(n)}
      >
        <View className='nc-icon'>{icon}</View>
        <View className='nc-body'>
          <View className='nc-top'>
            <Text className={`nc-title ${unread ? 'unread' : ''}`}>{title}</Text>
            <Text className='nc-time'>{timeAgo(n.created_at)}</Text>
          </View>
          <Text className='nc-text'>{body}</Text>
          {taskId && (
            <Text
              className='nc-link'
              onClick={e => {
                e.stopPropagation();
                this.goTask(taskId);
              }}
            >
              {t('messages.viewTask')}
            </Text>
          )}
        </View>
      </View>
    );
  };

  render() {
    const { loading, loggedIn, notifs } = this.state;

    if (!loggedIn) {
      return (
        <View className='messages-page'>
          <View className='empty-state'>
            <Text className='empty-text'>{t('messages.needLogin')}</Text>
          </View>
        </View>
      );
    }

    const unreadList = notifs.filter(n => !n.is_read);
    const readList = notifs.filter(n => !!n.is_read);
    const hasBoth = unreadList.length > 0 && readList.length > 0;

    return (
      <View className='messages-page'>
        <View className='msg-head'>
          <Text className='msg-title'>{t('messages.title')}</Text>
          {unreadList.length > 0 && (
            <Text className='msg-readall' onClick={this.markAll}>
              {t('messages.readAll')}
            </Text>
          )}
        </View>

        {loading ? (
          <View className='empty-state'>
            <Text className='empty-text'>{t('common.loading')}</Text>
          </View>
        ) : notifs.length === 0 ? (
          <View className='empty-state'>
            <Text className='empty-emoji'>📭</Text>
            <Text className='empty-title'>{t('messages.emptyTitle')}</Text>
            <Text className='empty-sub'>{t('messages.emptySub')}</Text>
          </View>
        ) : (
          <View>
            {unreadList.length > 0 && (
              <View>
                {hasBoth && <Text className='group-label'>{t('messages.newGroup')}</Text>}
                {unreadList.map(this.renderCard)}
              </View>
            )}
            {readList.length > 0 && (
              <View>
                <Text className={`group-label ${hasBoth ? 'gap' : ''}`}>{t('messages.historyGroup')}</Text>
                {readList.map(this.renderCard)}
              </View>
            )}
          </View>
        )}
      </View>
    );
  }
}
