import { Component, PropsWithChildren } from 'react';
import { initI18n } from './utils/i18n';
import './app.scss';

declare const wx: any;

const CLOUD_ENV_ID = 'prod-herix-d5gh5h4nv767053ae'; // 与 utils/api.ts 中保持一致

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    if (process.env.TARO_ENV === 'weapp' && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID });
    }
    initI18n(); // 语言检测 + 词典缓存加载 + 远端词典异步更新
  }

  render() {
    return this.props.children;
  }
}

export default App;
