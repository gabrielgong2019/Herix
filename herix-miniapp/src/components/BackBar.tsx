import Taro from '@tarojs/taro';
import { View, Text } from '@tarojs/components';
import { t } from '../utils/i18n';
import './BackBar.scss';

/** 次级页顶部返回条——仅 H5 渲染（小程序有原生导航栏返回，不重复）。
 *  直链/redirectTo 进入无上一页时回首页 tab。 */
export default function BackBar() {
  if (process.env.TARO_ENV !== 'h5') return null;
  const goBack = () => {
    const pages = Taro.getCurrentPages();
    if (pages && pages.length > 1) Taro.navigateBack();
    else Taro.switchTab({ url: '/pages/index/index' });
  };
  return (
    <View className='back-bar' onClick={goBack}>
      <Text className='back-bar-arrow'>‹</Text>
      <Text className='back-bar-text'>{t('common.back')}</Text>
    </View>
  );
}
