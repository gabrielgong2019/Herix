import { Component } from 'react';
import { View, Text, Input, Textarea, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { submissions, uploadSubmissionImage, assetUrl } from '../../utils/api';
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
    // 单次请求获取提交状态 + 下一步动作 + 任务配置（替代原来任务详情 + 全量提交两次串行请求）
    // nextAction 由服务端状态机计算，客户端不再重新推导
    try {
      const ctx = await submissions.myForTask(taskId);

      const hints = ctx.platformHints
        .map(id => PLATFORM_HINT_KEYS[id])
        .filter(Boolean) as string[];

      let mode: 'draft' | 'final' = 'final';
      let draftApprovedFlip = false;
      if (ctx.nextAction === 'SUBMIT_DRAFT') {
        mode = 'draft';
      } else if (ctx.nextAction === 'SUBMIT_FINAL') {
        mode = 'final';
        draftApprovedFlip = ctx.submission?.stage === 'DRAFT';
      }

      this.setState({
        mode,
        draftApprovedFlip,
        hints: hints.length ? hints : [DEFAULT_HINT_KEY],
        minImages: ctx.minImages,
      });

      // 重提：预填上次内容 + 显示被拒原因
      const prev = ctx.submission?.status === 'REJECTED' ? ctx.submission : null;
      if (prev) {
        const links: string[] = prev.content_urls || [];
        const shots: string[] = prev.screenshot_urls || [];
        this.setState({
          isResubmit: true,
          links: links.length ? links : [''],
          screenshots: shots,
          description: prev.description || '',
          rejectNote: prev.review_note || '',
        });
      }
    } catch {
      /* 失败时保留 URL 传入的乐观值，服务端仍会校验阶段合法性 */
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
          // 微信 fail 的错误信息在 errMsg（如 url not in domain list），message 恒空，
          // 之前只显示通用文案，域名未配置时无从排查（2026-08-06）
          Taro.showToast({ title: e?.errMsg || e?.message || t('apply.uploadFailed'), icon: 'none' });
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
      await submissions.submit(this.taskId, { contentUrls, description, screenshotUrls: screenshots.length ? screenshots : undefined });
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
          {isDraft && <Text className='hint'>💡 {t('apply.cloudHint')}</Text>}
          {!isDraft && hints.map((hint, i) => (
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
              {/* 上传接口返回相对路径，weapp 必须拼生产域名，否则 Image 当包内资源找不到 */}
              <Image className='shot-img' src={assetUrl(url)} mode='aspectFill' />
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

        <View
          className={`btn-primary${submitting || uploading ? ' btn-primary--disabled' : ''}`}
          onClick={submitting || uploading ? undefined : this.handleSubmit}
        >
          {submitting ? t('common.loading') : (isDraft ? t('apply.submitDraftBtn') : t('apply.submitReview'))}
        </View>
      </View>
    );
  }
}
