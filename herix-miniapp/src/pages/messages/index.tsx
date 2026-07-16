import { Component } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { notifications as notifApi, getToken } from '../../utils/api';
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
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso.slice(0, 10);
  const diff = Date.now() - t;
  const MIN = 60000;
  const HR = 3600000;
  const DAY = 86400000;
  if (diff < MIN) return '刚刚';
  if (diff < HR) return `${Math.floor(diff / MIN)}分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HR)}小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}天前`;
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
      const list = await notifApi.list();
      this.setState({ notifs: list || [], loading: false });
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
      Taro.showToast({ title: '操作失败', icon: 'none' });
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
            <Text className={`nc-title ${unread ? 'unread' : ''}`}>{n.title}</Text>
            <Text className='nc-time'>{timeAgo(n.created_at)}</Text>
          </View>
          <Text className='nc-text'>{n.body}</Text>
          {taskId && (
            <Text
              className='nc-link'
              onClick={e => {
                e.stopPropagation();
                this.goTask(taskId);
              }}
            >
              查看任务 →
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
            <Text className='empty-text'>请先登录后查看消息</Text>
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
          <Text className='msg-title'>消息</Text>
          {unreadList.length > 0 && (
            <Text className='msg-readall' onClick={this.markAll}>
              全部已读
            </Text>
          )}
        </View>

        {loading ? (
          <View className='empty-state'>
            <Text className='empty-text'>加载中…</Text>
          </View>
        ) : notifs.length === 0 ? (
          <View className='empty-state'>
            <Text className='empty-emoji'>📭</Text>
            <Text className='empty-title'>暂无消息</Text>
            <Text className='empty-sub'>任务审核、报名结果等通知会出现在这里</Text>
          </View>
        ) : (
          <View>
            {unreadList.length > 0 && (
              <View>
                {hasBoth && <Text className='group-label'>新消息</Text>}
                {unreadList.map(this.renderCard)}
              </View>
            )}
            {readList.length > 0 && (
              <View>
                <Text className={`group-label ${hasBoth ? 'gap' : ''}`}>历史消息</Text>
                {readList.map(this.renderCard)}
              </View>
            )}
          </View>
        )}
      </View>
    );
  }
}
