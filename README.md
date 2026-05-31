# Herix 赫使

连接品牌商家与海外侨民 KOL/KOC 的营销任务平台。

## 项目结构

```
Herix/
├── herix-server/        # 后端 API (Express + TypeScript + SQLite)
│   ├── src/
│   │   ├── index.ts          # 入口
│   │   ├── db.ts             # 数据库初始化 & 表结构
│   │   ├── middleware/auth.ts # JWT 认证中间件
│   │   ├── routes/            # API 路由
│   │   │   ├── auth.ts        # 注册 / 登录 / 用户信息
│   │   │   ├── tasks.ts       # 任务 CRUD / 发布 / 托管 / 完成
│   │   │   ├── applications.ts# 报名 / 审核
│   │   │   ├── submissions.ts # 提交结果 / 审核结算
│   │   │   └── users.ts       # 个人资料 / 交易记录
│   │   ├── types/index.ts     # Zod 校验 schema
│   │   └── utils/db.ts        # 数据库查询工具函数
│   └── package.json
├── herix-miniapp/       # 微信小程序 (Taro + React + TypeScript)
│   ├── src/
│   │   ├── app.tsx            # 应用入口
│   │   ├── app.config.ts      # 小程序配置 (含 tabBar)
│   │   ├── utils/api.ts       # API 封装
│   │   └── pages/
│   │       ├── index/         # 任务广场 (首页)
│   │       ├── task/          # 任务详情 / 报名 / 提交
│   │       ├── task-create/   # 商家发布任务
│   │       ├── apply/         # 赫使提交结果
│   │       └── profile/       # 登录注册 / 个人中心
│   └── package.json
└── README.md
```

## 快速启动

### 后端

```bash
cd herix-server
npm install
npm run dev
```

服务运行在 http://localhost:3001

### 前端 (小程序)

```bash
cd herix-miniapp
npm install --legacy-peer-deps

# 微信小程序编译 (需要微信开发者工具预览)
npm run dev:weapp

# H5 编译 (浏览器预览)
npm run dev:h5
```

## API 接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /api/auth/register | 注册 | 公开 |
| POST | /api/auth/login | 登录 | 公开 |
| GET | /api/auth/me | 当前用户 | 登录 |
| GET | /api/tasks | 任务列表 | 公开 |
| GET | /api/tasks/:id | 任务详情 | 公开 |
| POST | /api/tasks | 创建任务 | 品牌 |
| PATCH | /api/tasks/:id/publish | 发布任务 | 品牌 |
| PATCH | /api/tasks/:id/escrow | 托管资金 | 品牌 |
| POST | /api/applications/:taskId | 报名任务 | 赫使 |
| PATCH | /api/applications/:id/review | 审核报名 | 品牌 |
| POST | /api/submissions/:taskId | 提交结果 | 赫使 |
| PATCH | /api/submissions/:id/review | 审核结算 | 品牌 |
| PATCH | /api/users/profile/herald | 更新赫使资料 | 登录 |
| PATCH | /api/users/profile/brand | 更新品牌资料 | 登录 |
| GET | /api/users/me/transactions | 交易记录 | 登录 |

## 核心流程

```
商家创建任务 → 发布 → 托管资金
                ↓
          赫使报名 → 商家审核
                ↓
          赫使提交结果 → 商家审核通过
                ↓
          平台自动结算 (扣除 15% 服务费后释放)
```
