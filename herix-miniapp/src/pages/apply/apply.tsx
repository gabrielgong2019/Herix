import { Component } from 'react';
import { View, Text, Input, Textarea, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { submissions, tasks as taskApi } from '../../utils/api';
import './apply.scss';
import { t } from '../../utils/i18n';
import BackBar from '../../components/BackBar';

// 各平台"如何复制链接"提示（对齐 herix submitHTML）
// 存词条 key，渲染时 t() 取值
const PLATFORM_HINT_KEYS: Record<string, string> = {
  xiaohongshu: 'apply.hint.xiaohongshu',
  instagram: 'apply.hint.instagram',
  tiktok: 'apply.hint.tiktok',
  youtube: 'apply.hint.youtube',
  douyin: 'apply.hint.douyin',
  twitter: 'apply.hint.twitter',
  facebook: 'apply.hint.facebook',
};
const DEFAULT_HINT_KEY = 'apply.hint.xiaohongshu';

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
    hints: [DEFAULT_HINT_KEY],
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
      // 注意变量名不能叫 t——会遮蔽 i18n 的 t()
      const taskData: any = await taskApi.detail(taskId);
      let reqs: any[] = [];
      try {
        reqs = typeof taskData?.platform_requirements === 'string' ? JSON.parse(taskData.platform_requirements) : taskData?.platform_requirements || [];
      } catch {
        reqs = [];
      }
      const hints = reqs.map(r => PLATFORM_HINT_KEYS[r.platformId]).filter(Boolean);
      this.setState({ hints: hints.length ? hints : [DEFAULT_HINT_KEY] });
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
      Taro.showToast({ title: t('apply.fillLink'), icon: 'none' });
      return;
    }
    this.setState({ submitting: true });
    try {
      await submissions.submit(this.taskId, { contentUrl, description });
      Taro.showToast({ title: t('apply.success'), icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1500);
      // 成功后刻意不复位 submitting——返回前的1.5s窗口内按钮保持禁用,防双击双提交
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('apply.failed'), icon: 'none' });
      this.setState({ submitting: false });
    }
  };

  render() {
    const { contentUrl, description, submitting, hints, isResubmit, rejectNote } = this.state;

    return (
      <View className='apply-page'>
        <BackBar />
        <Text className='page-title'>{isResubmit ? t('apply.resubmitTitle') : t('apply.title')}</Text>

        {isResubmit && !!rejectNote && <View className='reject-banner'>{t('apply.rejectBanner', { note: rejectNote })}</View>}

        <View className='form-group'>
          <Text className='label'>{t('apply.contentLink')}</Text>
          <Input
            className='input'
            placeholder='https://...'
            value={contentUrl}
            onInput={e => this.setState({ contentUrl: e.detail.value })}
          />
          <View className='hints'>
            {hints.map((hint, i) => (
              <Text key={i} className='hint'>💡 {t(hint)}</Text>
            ))}
          </View>
        </View>

        <View className='form-group'>
          <Text className='label'>{t('apply.contentDesc')}</Text>
          <Textarea
            className='textarea'
            placeholder={t('apply.descPh')}
            value={description}
            onInput={e => this.setState({ description: e.detail.value })}
            maxlength={500}
          />
        </View>

        <Button className='btn-primary' onClick={this.handleSubmit} loading={submitting} disabled={submitting}>
          {t('apply.submitReview')}
        </Button>
      </View>
    );
  }
}
