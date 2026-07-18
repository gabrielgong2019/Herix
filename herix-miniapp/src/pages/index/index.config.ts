export default {
  navigationBarTitleText: '',
  // 接管原生标题栏，把 logo 挪到跟胶囊按钮同一行（见 index.tsx 的 navMetrics 计算）。
  // 仅 weapp 有意义；H5 没有原生标题栏/胶囊概念，H5 端不受影响
  navigationStyle: 'custom',
};
