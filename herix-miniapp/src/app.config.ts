// 赫使端页面全集。landing 是 H5 专属营销落地页，只注册进 H5，不打进小程序包
const pages = [
  'pages/index/index', // explore：发现（tab1，启动页）
  'pages/herald-dashboard/index', // tasks：我的任务（tab2）
  'pages/messages/index', // messages：消息（tab3）
  'pages/profile/profile', // profile：我的（tab4）
  'pages/task/task', // 任务详情（次级）
  'pages/apply/apply', // 报名/提交作品（次级，submit 复用此页）
  'pages/wallet/index', // 钱包（次级）
  'pages/withdraw/index', // 提现（次级）
  'pages/add-method/index', // 添加收款方式（次级）
  'pages/onboard/index', // 赫使入职引导（注册后进入）
  'pages/task-create/task-create', // ⚠️ 品牌端发任务：Phase2 不迁品牌端，此页为历史现状，暂留不动
];

if (process.env.TARO_ENV === 'h5') {
  pages.push('pages/landing/index'); // 落地页仅 H5
}

export default {
  pages,
  // 按需注入：只加载当前页面用到的组件代码，加快启动（微信代码质量体检项）
  lazyCodeLoading: 'requiredComponents',
  // 颜色对齐 herix.html：顶栏/下拉背景用品牌灰 #f5f5f7 黑字，
  // tab 选中态是黑字（herix.html 的 .tab-item.active 就是黑字加粗，不是红色）
  window: {
    navigationBarTitleText: 'Herix 赫使',
    navigationBarBackgroundColor: '#f5f5f7',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f5f7',
  },
  // 底部 4 tab 对齐 herix.html：发现 / 我的任务 / 消息 / 我的
  // ⚠️ explore、messages 目前用现有图标 cp 出来的占位（explore.png=task 图标、
  //    messages.png=profile 图标），TODO：补两组专属图标，只需替换 assets 下同名 png
  tabBar: {
    color: '#8a8a8e',
    selectedColor: '#111111',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '探索', // 文案对齐 herix.html 原版
        iconPath: 'assets/explore.png',
        selectedIconPath: 'assets/explore-active.png',
      },
      {
        pagePath: 'pages/herald-dashboard/index',
        text: '任务', // 文案对齐 herix.html 原版
        iconPath: 'assets/task.png',
        selectedIconPath: 'assets/task-active.png',
      },
      {
        pagePath: 'pages/messages/index',
        text: '消息',
        iconPath: 'assets/messages.png',
        selectedIconPath: 'assets/messages-active.png',
      },
      {
        pagePath: 'pages/profile/profile',
        text: '我的',
        iconPath: 'assets/profile.png',
        selectedIconPath: 'assets/profile-active.png',
      },
    ],
  },
};
