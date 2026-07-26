import { Component } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { brands as brandsApi, categories as categoriesApi } from '../../utils/api';
import TaskCard, { CategoryItem, TaskCardTask } from '../../components/TaskCard';
import { t } from '../../utils/i18n';
import { assetUrl } from '../../utils/api';
import './brand.scss';

interface BrandProfile {
  id: string;
  nickname: string;
  created_at: string;
  company_name: string;
  company_desc?: string | null;
  website?: string | null;
  industry?: string | null;
  logo_url?: string | null;
  promo_image_url?: string | null;
  is_agency: number | boolean;
  total_tasks: number;
  completed_tasks: number;
  total_heralds: number;
}

interface State {
  profile: BrandProfile | null;
  tasks: TaskCardTask[];
  categories: CategoryItem[];
  loading: boolean;
  error: string;
}

export default class BrandPage extends Component<{}, State> {
  state: State = {
    profile: null,
    tasks: [],
    categories: [],
    loading: true,
    error: '',
  };

  async componentDidMount() {
    const params = Taro.getCurrentInstance().router?.params || {};
    const userId = params.id as string;
    if (!userId) {
      this.setState({ loading: false, error: t('brand.notFound') });
      return;
    }
    try {
      const [brandRes, catRes] = await Promise.all([
        brandsApi.getProfile(userId),
        categoriesApi.list(),
      ]);
      Taro.setNavigationBarTitle({ title: brandRes.profile.company_name || brandRes.profile.nickname });
      this.setState({
        profile: brandRes.profile,
        tasks: brandRes.tasks,
        categories: catRes,
        loading: false,
      });
    } catch (e: any) {
      this.setState({
        loading: false,
        error: e?.message === 'brand_not_found' ? t('brand.notFound') : t('brand.loadError'),
      });
    }
  }

  render() {
    const { profile, tasks, categories, loading, error } = this.state;

    const backBtn = process.env.TARO_ENV === 'h5' ? (
      <View className='bp-back' onClick={() => Taro.navigateBack()}>
        <Text className='bp-back-icon'>‹</Text>
      </View>
    ) : null;

    if (loading) {
      return (
        <View className='brand-page bp-center'>
          {backBtn}
          <Text className='bp-muted'>{t('brand.loading')}</Text>
        </View>
      );
    }

    if (error || !profile) {
      return (
        <View className='brand-page bp-center'>
          {backBtn}
          <Text className='bp-error'>{error || t('brand.notFound')}</Text>
        </View>
      );
    }

    const logoSrc = profile.logo_url ? assetUrl(profile.logo_url) : '';
    const isAgency = profile.is_agency === 1 || profile.is_agency === true;
    const joinYear = profile.created_at ? new Date(profile.created_at).getFullYear() : null;

    return (
      <ScrollView scrollY className='brand-page'>
        {backBtn}
        {/* ── 品牌头部 ── */}
        <View className='bp-header'>
          <View className='bp-logo-wrap'>
            {logoSrc
              ? <View className='bp-logo' style={{ backgroundImage: `url(${logoSrc})` }} />
              : <View className='bp-logo bp-logo-fallback'>
                  <Text>{(profile.company_name || profile.nickname || 'B')[0]}</Text>
                </View>
            }
          </View>
          <View className='bp-identity'>
            <View className='bp-name-row'>
              <Text className='bp-name'>{profile.company_name || profile.nickname}</Text>
              {isAgency && <Text className='bp-badge-agency'>{t('brand.agency')}</Text>}
            </View>
            {profile.company_desc && (
              <Text className='bp-desc'>{profile.company_desc}</Text>
            )}
            <View className='bp-meta'>
              {joinYear && (
                <Text className='bp-meta-item'>{t('brand.since')} {joinYear}</Text>
              )}
              {profile.website && (
                <Text
                  className='bp-meta-item bp-website'
                  onClick={() => {
                    const url = profile.website!.startsWith('http') ? profile.website! : `https://${profile.website}`;
                    // H5 直接跳转，小程序无法跳外链——显示复制提示
                    if (process.env.TARO_ENV === 'h5') {
                      window.open(url, '_blank');
                    } else {
                      Taro.setClipboardData({ data: url }).then(() =>
                        Taro.showToast({ title: t('brand.websiteCopied'), icon: 'none' })
                      );
                    }
                  }}
                >
                  🔗 {profile.website}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* ── 数据统计 ── */}
        <View className='bp-stats'>
          <View className='bp-stat-item'>
            <Text className='bp-stat-num'>{profile.total_tasks}</Text>
            <Text className='bp-stat-label'>{t('brand.statTasks')}</Text>
          </View>
          <View className='bp-stat-divider' />
          <View className='bp-stat-item'>
            <Text className='bp-stat-num'>{profile.total_heralds}</Text>
            <Text className='bp-stat-label'>{t('brand.statHeralds')}</Text>
          </View>
          <View className='bp-stat-divider' />
          <View className='bp-stat-item'>
            <Text className='bp-stat-num'>{profile.completed_tasks}</Text>
            <Text className='bp-stat-label'>{t('brand.statCompleted')}</Text>
          </View>
        </View>

        {/* ── 当前招募任务 ── */}
        <View className='bp-section'>
          <Text className='bp-section-title'>{t('brand.activeJobs')}</Text>
          {tasks.length === 0
            ? <Text className='bp-muted bp-empty'>{t('brand.noTasks')}</Text>
            : tasks.map(task => (
                <TaskCard key={task.id} task={task} categories={categories} />
              ))
          }
        </View>
      </ScrollView>
    );
  }
}
