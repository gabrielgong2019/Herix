import { Component } from 'react';
import { View, Text, RichText } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { legal as legalApi } from '../../utils/api';
import { t, getLocale } from '../../utils/i18n';
import './legal.scss';

type Doc = 'user-agreement' | 'privacy-policy';

interface State {
  doc: Doc;
  html: string;
  loading: boolean;
  failed: boolean;
}

// scope 由编译目标决定：小程序端=中文协议(长沙主体)，网页端=通用协议(日/英)
const IS_WEAPP = process.env.TARO_ENV === 'weapp';
const SCOPE: 'weapp' | 'web' = IS_WEAPP ? 'weapp' : 'web';

// weapp 恒中文；web 仅提供 ja/en，按当前语言映射（日文→ja，其余→en）
function docLang(): string {
  if (SCOPE === 'weapp') return 'zh';
  return (getLocale() || '').startsWith('ja') ? 'ja' : 'en';
}

export default class Legal extends Component<Record<string, never>, State> {
  state: State = { doc: 'user-agreement', html: '', loading: true, failed: false };

  componentDidMount() {
    const p = Taro.getCurrentInstance().router?.params || {};
    const doc: Doc = p.doc === 'privacy-policy' ? 'privacy-policy' : 'user-agreement';
    this.setState({ doc }, this.load);
  }

  load = () => {
    this.setState({ loading: true, failed: false });
    legalApi.get(SCOPE, this.state.doc, docLang())
      .then(r => this.setState({ html: r.html, loading: false }))
      .catch(() => this.setState({ loading: false, failed: true }));
  };

  switchDoc = (doc: Doc) => {
    if (doc === this.state.doc) return;
    this.setState({ doc }, this.load);
  };

  render() {
    const { doc, html, loading, failed } = this.state;
    return (
      <View className='legal-page'>
        <View className='legal-tabs'>
          <Text
            className={`legal-tab ${doc === 'user-agreement' ? 'on' : ''}`}
            onClick={() => this.switchDoc('user-agreement')}
          >{t('legal.tabAgreement')}</Text>
          <Text
            className={`legal-tab ${doc === 'privacy-policy' ? 'on' : ''}`}
            onClick={() => this.switchDoc('privacy-policy')}
          >{t('legal.tabPrivacy')}</Text>
        </View>
        <View className='legal-body'>
          {loading && <Text className='legal-hint'>{t('legal.loading')}</Text>}
          {failed && <Text className='legal-hint' onClick={this.load}>{t('legal.loadFail')}</Text>}
          {!loading && !failed && <RichText nodes={html} />}
        </View>
      </View>
    );
  }
}
