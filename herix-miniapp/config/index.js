// weapp 和 h5 分开输出目录，避免两个构建互相覆盖对方产物
// （app.json 属于 weapp 构建，index.html/js/css 属于 h5 构建，共用一个 dist/ 会互相冲掉）
const isH5 = process.env.TARO_ENV === 'h5';

export default {
  projectName: 'herix-miniapp',
  date: '2026-05-27',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
    375: 2 / 1,
  },
  sourceRoot: 'src',
  outputRoot: isH5 ? 'dist/h5' : 'dist/weapp',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5'],
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false },
  },
  devtool: 'cheap-source-map',
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      url: { enable: true, config: { limit: 1024 } },
    },
  },
  h5: {
    publicPath: '/app/', // H5 挂在 herix.huaxuex.com/app 路径下（子域名方案需付费多级证书，弃用）
    staticDirectory: 'static',
    template: 'src/index.html',
    // 内容哈希文件名：发布即换 URL，绕开浏览器/Cloudflare 对未哈希 app.js 的缓存（2026-08-05）
    // CSS 同样带内容 hash：499.css 这类未哈希 chunk 会被浏览器 immutable 缓存永久吃掉新样式
    miniCssExtractPluginOption: {
      filename: 'css/[name].[contenthash:8].css',
      chunkFilename: 'css/[name].[contenthash:8].css',
    },
    webpackChain(chain) {
      chain.output.filename('js/[name].[contenthash:8].js');
      chain.output.chunkFilename('js/[name].[contenthash:8].js');
    },
    router: { mode: 'hash' },
    devServer: {
      port: 10086,
      hot: false,
      liveReload: false,
      devMiddleware: { writeToDisk: true },
      proxy: {
        '/api': {
          target: "http://localhost:4005",
          changeOrigin: true,
        },
      },
    },
    postcss: {
      autoprefixer: { enable: true, config: {} },
    },
  },
};
