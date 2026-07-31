import { Component } from 'react';
import { View, Text, Input, Textarea, Button, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { submissions, tasks as taskApi, uploadSubmissionImage } from '../../utils/api';
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
const MAX_LINKS = 10;
const MAX_IMAGES = 9;

interface State {
  mode: 'draft' | 'final';
  links: string[];
  screenshots: string[];
  description: string;
  submitting: boolean;
  uploading: boolean;
  hints: string[];
  isResubmit: boolean;
  rejectNote: string;
  minImages: number;
  draftApprovedFlip: boolean; // 草稿已过，这次提交是自动转入的终稿（区别于任务本来就不要求草稿）
}

export default class Apply extends Component<{}, State> {
  state: State = {
    mode: 'final',
    links: [''],
    screenshots: [],
    description: '',
    submitting: false,
    uploading: false,
    hints: [DEFAULT_HINT_KEY],
    isResubmit: false,
    rejectNote: '',
    minImages: 0,
    draftApprovedFlip: false,
  };

  taskId = '';

  componentDidMount() {
    const params = Taro.getCurrentInstance().router?.params || {};
    this.taskId = (params.taskId as string) || '';
    // URL 的 mode 只做首屏乐观展示（避免闪一下默认态），真正准确的阶段由 loadContext
    // 结合任务的 require_draft_review + 已有提交记录重新计算——不能只信入口传的参数
    // （2026-07-27 修复：待办卡此前从不传 mode，导致要求草稿前置的任务直接进终稿提交界面，
    // 完全没有"这是草稿"的提示，赫使/平台审核都可能把草稿误当重复内容）
    const mode = params.mode === 'draft' ? 'draft' : 'final';
    this.setState({ mode });
    if (this.taskId) this.loadContext(this.taskId);
  }

  loadContext = async (taskId: string) => {
    // 平台复制提示 + 图片张数要求：读任务详情
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
      this.setState({
        hints: hints.length ? hints : [DEFAULT_HINT_KEY],
        minImages: Number(taskData?.min_images) || 0,
      });

      // 用真实数据校正阶段（权威，不再单信 URL 的 mode）——逻辑镜像服务端 decideSubmit：
      // 没有提交记录 → 按任务是否要求草稿前置决定；DRAFT+REJECTED → 重提草稿；
      // DRAFT+APPROVED → 草稿已过，本次自动转终稿；FINAL+REJECTED → 重提终稿
      const requireDraft = !!taskData?.require_draft_review;
      const subs = await submissions.my().catch(() => []);
      const row = (subs || []).find((s: any) => s.task_id === taskId);
      let mode: 'draft' | 'final' = requireDraft ? 'draft' : 'final';
      let draftApprovedFlip = false;
      if (row) {
        if (row.stage === 'DRAFT' && row.status === 'REJECTED') mode = 'draft';
        else if (row.stage === 'DRAFT' && row.status === 'APPROVED') { mode = 'final'; draftApprovedFlip = true; }
        else if (row.stage === 'FINAL') mode = 'final';
      }
      this.setState({ mode, draftApprovedFlip });

      // 重新提交：预填上次内容 + 显示被拒原因（多链接从 content_urls 解析，回落单链接旧字段）
      const prev = (subs || []).find((s: any) => s.task_id === taskId && s.status === 'REJECTED');
      if (prev) {
        let links: string[] = [];
        try { links = prev.content_urls ? JSON.parse(prev.content_urls) : []; } catch { links = []; }
        if (!links.length && prev.content_url) links = [prev.content_url];
        let shots: string[] = [];
        try { shots = prev.screenshot_urls ? JSON.parse(prev.screenshot_urls) : []; } catch { shots = []; }
        this.setState({
          isResubmit: true,
          links: links.length ? links : [''],
          screenshots: shots,
          description: prev.description || '',
          rejectNote: prev.review_note || '',
        });
      }
    } catch {
      /* 提示/阶段校正是辅助信息，失败时保留 URL 传入的乐观值，不阻塞提交 */
    }
  };

  setLink = (i: number, val: string) => {
    this.setState(prev => {
      const links = [...prev.links];
      links[i] = val;
      return { ...prev, links };
    });
  };

  addLink = () => {
    this.setState(prev => (prev.links.length >= MAX_LINKS ? prev : { ...prev, links: [...prev.links, ''] }));
  };

  removeLink = (i: number) => {
    this.setState(prev => {
      const links = prev.links.filter((_, idx) => idx !== i);
      return { ...prev, links: links.length ? links : [''] };
    });
  };

  pickImages = async () => {
    const { screenshots } = this.state;
    const remain = MAX_IMAGES - screenshots.length;
    if (remain <= 0) return;
    try {
      const res = await Taro.chooseImage({ count: remain, sizeType: ['compressed'] });
      this.setState({ uploading: true });
      const uploaded: string[] = [];
      for (const p of res.tempFilePaths) {
        try {
          uploaded.push(await uploadSubmissionImage(p));
        } catch (e: any) {
          Taro.showToast({ title: e?.message || t('apply.uploadFailed'), icon: 'none' });
        }
      }
      this.setState(prev => ({ ...prev, screenshots: [...prev.screenshots, ...uploaded], uploading: false }));
    } catch {
      this.setState({ uploading: false }); // 用户取消选图
    }
  };

  removeImage = (i: number) => {
    this.setState(prev => ({ ...prev, screenshots: prev.screenshots.filter((_, idx) => idx !== i) }));
  };

  handleSubmit = async () => {
    const { mode, links, screenshots, description, minImages } = this.state;
    const contentUrls = links.map(l => l.trim()).filter(Boolean);
    // 客户端前置校验（服务端同款闸机兜底）
    if (mode === 'final' && contentUrls.length === 0) {
      Taro.showToast({ title: t('apply.fillLink'), icon: 'none' });
      return;
    }
    if (mode === 'draft' && !description.trim() && !screenshots.length && contentUrls.length === 0) {
      Taro.showToast({ title: t('apply.fillDraft'), icon: 'none' });
      return;
    }
    if (minImages > 0 && screenshots.length < minImages) {
      Taro.showToast({ title: t('apply.needMinImages', { n: minImages }), icon: 'none' });
      return;
    }
    this.setState({ submitting: true });
    try {
      await submissions.submit(this.taskId, { contentUrls, description, screenshotUrls: screenshots });
      Taro.showToast({ title: t('apply.success'), icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1500);
      // 成功后刻意不复位 submitting——返回前的1.5s窗口内按钮保持禁用,防双击双提交
    } catch (err: any) {
      Taro.showToast({ title: err.message || t('apply.failed'), icon: 'none' });
      this.setState({ submitting: false });
    }
  };

  render() {
    const { mode, links, screenshots, description, submitting, uploading, hints, isResubmit, rejectNote, minImages, draftApprovedFlip } = this.state;
    const isDraft = mode === 'draft';

    const linkSection = (
      <View className='form-group'>
        <Text className='label'>{isDraft ? t('apply.previewLink') : t('apply.contentLinks')}</Text>
        {links.map((link, i) => (
          <View key={i} className='link-row'>
            <Input
              className='input link-input'
              placeholder='https://...'
              value={link}
              onInput={e => this.setLink(i, e.detail.value)}
            />
            {!isDraft && links.length > 1 && (
              <Text className='link-remove' onClick={() => this.removeLink(i)}>✕</Text>
            )}
          </View>
        ))}
        {!isDraft && links.length < MAX_LINKS && (
          <Text className='add-link' onClick={this.addLink}>＋ {t('apply.addLink')}</Text>
        )}
        <View className='hints'>
          {hints.map((hint, i) => (
            <Text key={i} className='hint'>💡 {t(hint)}</Text>
          ))}
        </View>
      </View>
    );

    const imageSection = (
      <View className='form-group'>
        <Text className='label'>
          {isDraft ? t('apply.draftScreenshots') : t('apply.screenshots')}
          {minImages > 0 && <Text className='label-sub'> · {t('apply.needMinImages', { n: minImages })}</Text>}
        </Text>
        <View className='shots-grid'>
          {screenshots.map((url, i) => (
            <View key={url} className='shot-item'>
              <Image className='shot-img' src={url} mode='aspectFill' />
              <Text className='shot-remove' onClick={() => this.removeImage(i)}>✕</Text>
            </View>
          ))}
          {screenshots.length < MAX_IMAGES && (
            <View className='shot-add' onClick={this.pickImages}>
              {uploading ? t('apply.uploading') : '＋'}
            </View>
          )}
        </View>
      </View>
    );

    const descSection = (
      <View className='form-group'>
        <Text className='label'>{isDraft ? t('apply.draftDescLabel') : t('apply.contentDesc')}</Text>
        <Textarea
          className='textarea'
          placeholder={isDraft ? t('apply.draftDescPh') : t('apply.descPh')}
          value={description}
          onInput={e => this.setState({ description: e.detail.value })}
          maxlength={2000}
        />
        {isDraft && <Text className='hint'>💡 {t('apply.cloudHint')}</Text>}
      </View>
    );

    return (
      <View className='apply-page'>
        <BackBar />
        <Text className='page-title'>
          {isDraft
            ? (isResubmit ? t('apply.redraftTitle') : t('apply.draftTitle'))
            : (isResubmit ? t('apply.resubmitTitle') : t('apply.title'))}
        </Text>

        {isDraft && <View className='draft-banner'>📝 {t('apply.draftIntro')}</View>}
        {isDraft && <View className='warn-banner'>⚠️ {t('apply.draftWarn')}</View>}
        {!isDraft && draftApprovedFlip && <View className='draft-banner'>🎉 {t('apply.draftApprovedIntro')}</View>}
        {isResubmit && !!rejectNote && <View className='reject-banner'>{t('apply.rejectBanner', { note: rejectNote })}</View>}

        {isDraft ? (
          <>
            {imageSection}
            {descSection}
            {linkSection}
          </>
        ) : (
          <>
            {linkSection}
            {imageSection}
            {descSection}
          </>
        )}

        <Button className='btn-primary' onClick={this.handleSubmit} loading={submitting} disabled={submitting || uploading}>
          {isDraft ? t('apply.submitDraftBtn') : t('apply.submitReview')}
        </Button>
      </View>
    );
  }
}
