# patches/

## @tarojs+runtime+4.2.0.patch

修复 `removeEventListener` 降级逻辑的 bug：节点失去全部事件时降级到
`pure-${nodeName}`，但 Taro 模板系统只有 `pure-view`，不存在
`pure-text`/`pure-image`，导致 `componentsAlias['pure-text']` 为
`undefined`，读 `._num` 抛 TypeError，炸穿 React commit，整棵树报废——
表现为小程序页面能显示、能滚动，但所有点击彻底无响应（H5 不受影响）。

backport 自 Taro 官方 main 分支已合并的修复。上游 issue：
https://github.com/NervJS/taro/issues/16641

postinstall 用 `--error-on-fail`：Taro 发新版把这个 bug 修了之后，
patch 上下文对不上会直接装不上、构建报错，提醒删掉这个 patch 再升级，
不会静默失效。

## 为什么 @tarojs/taro-loader / babel-preset-taro 显式锁在 ^4.0.1

这两个包原本没有被声明过，是被移除的 `@tarojs/mini-runner`（Taro3
遗留、从未真正用于构建）隐式带出来的：
- `babel.config.js` 的 `taro` preset 依赖 `babel-preset-taro`
- webpack 从项目根解析 loader，`mini-runner` 把 `taro-loader@4.0.1`
  顶到了根目录，覆盖了 `webpack5-runner@4.2.0` 自带的 4.2.0——也就是说
  生产构建实际上一直在用 4.0.1 的 loader，不是看起来对齐的 4.2.0

移除 mini-runner 后必须把这两个包显式声明出来，构建才不会
`Cannot find package`。已验证 4.0.1 组合下 `build:weapp` 产物与
清理前逐字节一致。

**以后想升级 Taro 全家桶时会踩的坑**：`@tarojs/taro-loader` 能顺畅升到
最新版（实测 4.2.1 无冲突）；但 `babel-preset-taro` 不管升到哪个版本
（含最新 4.2.1）都会报 `ERESOLVE`——它自己声明的
`peerOptional react-refresh: ^0.14.0` 从未更新过，和本项目
`react-refresh@^0.18.0`（React 18 fast refresh 需要）冲突。这是 Taro
自己包之间 peer 声明没同步的问题，不是本项目引入的。升级时需要要么
`--legacy-peer-deps` 接受这个不一致，要么等 Taro 更新
`babel-preset-taro` 的 peer 声明。
