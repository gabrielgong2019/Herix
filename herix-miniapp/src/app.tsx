import { Component, PropsWithChildren } from 'react';
import './app.scss';

declare const wx: any;

const CLOUD_ENV_ID = 'REPLACE_WITH_CLOUD_ENV_ID'; // 与 utils/api.ts 中保持一致

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    if (process.env.TARO_ENV === 'weapp' && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID });
    }
  }

  render() {
    return this.props.children;
  }
}

export default App;
