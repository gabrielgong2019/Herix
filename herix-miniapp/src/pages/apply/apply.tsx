import { Component } from 'react';
import { View, Text, Input, Textarea, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { submissions, tasks as taskApi } from '../../utils/api';
import './apply.scss';

// 各平台"如何复制链接"提示（对齐 herix submitHTML）
const PLATFORM_HINTS: Record<string, string> = {
  xiaohongshu: '小红书：打开笔记 → 右上角「…」→「分享」→「复制链接」',
  instagram: 'Instagram：打开帖子 → 右上角「⋯」→「复制链接」',
  tiktok: 'TikTok：打开视频 → 右侧「分享」→「复制链接」',
  youtube: 'YouTube：视频下方「分享」→「复制链接」',
  douyin: '抖音：打开视频 → 右侧「分享」→「复制链接」',
  twitter: 'X(Twitter)：点推文右下角「分享」→「复制链接」',
  facebook: 'Facebook：帖子右上角「…」→「复制链接」',
};
const DEFAULT_HINT = '小红书：打开笔记 → 右上角「…」→「分享」→「复制链接」';

interface State {
  contentUrl: string;
  description: string;
  submitting: boolean;
  hints: string[];
  isResubmit: boolean;
  rejectNote: string;
}

export default class Apply extends Component<{}, State> {
  state: State = {
    contentUrl: '',
    description: '',
    submitting: false,
    hints: [DEFAULT_HINT],
    isResubmit: false,
    rejectNote: '',
  };

  taskId = '';

  componentDidMount() {
    this.taskId = (Taro.getCurrentInstance().router?.params?.taskId as string) || '';
    if (this.taskId) this.loadContext(this.taskId);
  }

  loadContext = async (taskId: string) => {
    // 平台复制提示：读任务的 platform_requirements
    try {
      const t: any = await taskApi.detail(taskId);
      let reqs: any[] = [];
      try {
        reqs = typeof t?.platform_requirements === 'string' ? JSON.parse(t.platform_requirements) : t?.platform_requirements || [];
      } catch {
        reqs = [];
      }
      const hints = reqs.map(r => PLATFORM_HINTS[r.platformId]).filter(Boolean);
      this.setState({ hints: hints.length ? hints : [DEFAULT_HINT] });
    } catch {
      /* 提示是辅助信息，失败用默认 */
    }
    // 重新提交：预填上次内容 + 显示被拒原因
    try {
      const subs = await submissions.my();
      const prev = (subs || []).find((s: any) => s.task_id === taskId && s.status === 'REJECTED');
      if (prev) {
        this.setState({
          isResubmit: true,
          contentUrl: prev.content_url || '',
          description: prev.description || '',
          rejectNote: prev.review_note || '',
        });
      }
    } catch {
      /* 无历史提交，正常首次提交 */
    }
  };

  handleSubmit = async () => {
    const { contentUrl, description } = this.state;
    if (!contentUrl) {
      Taro.showToast({ title: '请填写内容链接', icon: 'none' });
      return;
    }
    this.setState({ submitting: true });
    try {
      await submissions.submit(this.taskId, { contentUrl, description });
      Taro.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1500);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setState({ submitting: false });
    }
  };

  render() {
    const { contentUrl, description, submitting, hints, isResubmit, rejectNote } = this.state;

    return (
      <View className='apply-page'>
        <Text className='page-title'>{isResubmit ? '重新提交内容' : '提交结果'}</Text>

        {isResubmit && !!rejectNote && <View className='reject-banner'>上次被拒原因：{rejectNote}</View>}

        <View className='form-group'>
          <Text className='label'>内容链接 *</Text>
          <Input
            className='input'
            placeholder='https://...'
            value={contentUrl}
            onInput={e => this.setState({ contentUrl: e.detail.value })}
          />
          <View className='hints'>
            {hints.map((hint, i) => (
              <Text key={i} className='hint'>💡 {hint}</Text>
            ))}
          </View>
        </View>

        <View className='form-group'>
          <Text className='label'>内容说明</Text>
          <Textarea
            className='textarea'
            placeholder='简单描述你的推广内容...'
            value={description}
            onInput={e => this.setState({ description: e.detail.value })}
            maxlength={500}
          />
        </View>

        <Button className='btn-primary' onClick={this.handleSubmit} loading={submitting} disabled={submitting}>
          提交审核
        </Button>
      </View>
    );
  }
}
