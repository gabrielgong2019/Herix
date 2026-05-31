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
  outputRoot: 'dist',
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
    publicPath: '/',
    staticDirectory: 'static',
    template: 'src/index.html',
    router: { mode: 'hash' },
    devServer: {
      port: 10086,
      hot: false,
      liveReload: false,
      devMiddleware: { writeToDisk: true },
      proxy: {
        '/api': {
          target: "http://localhost:3005",
          changeOrigin: true,
        },
      },
    },
    postcss: {
      autoprefixer: { enable: true, config: {} },
    },
  },
};
