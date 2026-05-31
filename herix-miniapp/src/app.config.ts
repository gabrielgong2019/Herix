export default {
  pages: [
    'pages/index/index',
    'pages/task/task',
    'pages/task-create/task-create',
    'pages/apply/apply',
    'pages/profile/profile',
  ],
  window: {
    navigationBarTitleText: 'Herix 赫使',
    navigationBarBackgroundColor: '#1a1a2e',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f5f5',
  },
  tabBar: {
    color: '#999',
    selectedColor: '#1a1a2e',
    backgroundColor: '#fff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '任务',
        iconPath: 'assets/task.png',
        selectedIconPath: 'assets/task-active.png',
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
