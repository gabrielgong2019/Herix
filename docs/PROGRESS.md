# Herix 项目进度追踪

> 更新: 2026-05-30 (接手)
> 用途: AI Agent 交接文档

---

## 1. 项目概述

- **仓库**: `/Users/gabrielg/Herix/`
- **后端**: Express + TypeScript + SQLite (2097 行)
- **前端**: 三端分离 (preview/merchant/admin 三个 HTML 文件)
- **数据库**: 13 张表
- **PRD**: `docs/Herix_Ambassador_PRD.md` (754 行)
- **端口**: 后端 3004

---

## 2. 启动

```bash
cd /Users/gabrielg/Herix && bash start.sh
```

| 页面 | URL |
|------|-----|
| 赫使端 | http://localhost:3002/preview.html |
| 品牌端 | http://localhost:3002/merchant.html |
| 运营后台 | http://localhost:3002/admin.html |

测试账号:

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 品牌商家 | brand@demo.com | 123456 |
| 赫使 | herald@demo.com | 123456 |
| 运营 | admin@herix.com | 123456 |

---

## 3. 进度总览

### 基础架构

| 模块 | 状态 | 说明 |
|------|------|------|
| 多角色账号 | ✅ | `users.roles` 字段, JWT 含 roles 数组, 后端 parseRoles() |
| 三端分离 | ✅ | preview(赫使) / merchant(品牌) / admin(运营) |
| 自我交易防护 | ✅ | API 层校验 applicant≠creator |

### 功能层

| 模块 | 状态 | 后端 | 前端 |
|------|------|------|------|
| 用户注册/登录 | ✅ | ✅ | ✅ |
| 任务 CRUD/发布/托管 | ✅ | ✅ | ✅ |
| 报名/审核 | ✅ | ✅ | ✅ |
| 提交/审核/结算 | ✅ | ✅ | ✅ |
| 评价系统 | ✅ | ✅ | ❌ |
| 大使入驻 (3步) | ✅ | ✅ | ✅ (preview) |
| 品牌入驻 (2步) | ✅ | ✅ | ✅ (merchant) |
| 推广码系统 | ✅ | task_promo_codes 表 | ✅ (merchant CSV下载) |
| 邮件通知 | ✅ | mailer.ts utils | — |
| 结算管理 | ✅ | payouts 表 + 月结API | ✅ (admin) |
| 运营后台 | ✅ | admin.ts route | ✅ (admin.html) |
| 品牌管理后台 | ✅ | — | ✅ (merchant.html) |
| 数据看板(7日) | ✅ | admin /stats 接口 | ✅ (admin) |

### 已知修复

| Bug | 修复方式 |
|-----|---------|
| Express 路由顺序 /my/stats 被 /:id 截获 | 特化路由放通用路由前面 |
| 前端竞态: nav 切换清空 state.tasks | 加 loading 状态 + 判断 XHR 返回时 view 没变才赋值 |

### 数据库 (13 表)

新增 `task_promo_codes` 表: 推广码预生成 + 分配 + 自定义上传

---

## 4. 后端 API (完整清单)

| 分组 | 端点 | 说明 |
|------|------|------|
| Auth | POST /api/auth/register | 注册, 含多角色支持 |
| Auth | POST /api/auth/login | 登录, 返回 roles 数组 |
| Auth | POST /api/auth/switch-role | 切换当前活跃角色 |
| Auth | GET /api/auth/me | 当前用户信息 |
| Tasks | GET /api/tasks | 列表(支持 status/mode/creator/page) |
| Tasks | GET /api/tasks/:id | 详情 |
| Tasks | POST /api/tasks | 创建 |
| Tasks | PATCH /api/tasks/:id/publish | 发布 |
| Tasks | PATCH /api/tasks/:id/escrow | 托管 |
| Tasks | POST /api/tasks/:id/promo-codes | 批量生成推广码 |
| Tasks | GET /api/tasks/:id/promo-codes | 查看/下载推广码 |
| Tasks | POST /api/tasks/:id/promo-codes/upload | 商家上传自定义码 |
| Apps | POST /api/applications/:taskId | 报名 |
| Apps | PATCH /api/applications/:id/review | 审核 |
| Apps | GET /api/applications/my | 我的报名 |
| Subs | POST /api/submissions/:taskId | 提交 |
| Subs | PATCH /api/submissions/:id/review | 审核+结算 |
| Subs | GET /api/submissions/task/:taskId | 任务提交列表 |
| Subs | GET /api/submissions/my | 我的提交 |
| Ambassador | GET /api/ambassador/status | 合规检查 |
| Ambassador | PATCH /api/ambassador/profile | 更新资料 |
| Ambassador | POST /api/ambassador/onboard | 一次性入驻 |
| Ambassador | POST /api/ambassador/declaration | 在留声明 |
| Referrals | POST /api/referrals/assign/:taskId | 领取推广码 |
| Referrals | GET /api/referrals/my-codes | 我的推广码 |
| Referrals | POST /api/referrals/csv-import | CSV导入 |
| Ratings | POST /api/ratings/:taskId | 评价 |
| Admin | GET /api/admin/stats | 数据看板 |
| Admin | GET /api/admin/declarations | 声明列表 |
| Admin | PATCH /api/admin/declarations/:id | 审核声明 |
| Admin | GET /api/admin/users | 用户列表 |
| Admin | PATCH /api/admin/users/:id | 管理用户 |
| Admin | GET /api/admin/tasks | 任务列表 |
| Admin | DELETE /api/admin/tasks/:id | 删除任务 |
| Admin | GET /api/admin/settlements | 结算列表 |
| Admin | POST /api/admin/settlements/mark-paid | 标记已付款 |
| Users | PATCH /api/users/profile/* | 更新资料 |
| Users | GET /api/users/me/transactions | 交易记录 |

---

## 5. 代码结构

```
Herix/
├── start.sh              # 启动脚本
├── preview.html          # 赫使端 (71K, 原生JS SPA)
├── merchant.html         # 品牌端 (62K, 原生JS SPA)
├── admin.html            # 运营后台 (29K, 原生JS SPA)
├── docs/
│   ├── PROGRESS.md       # 本文档
│   ├── Herix_Ambassador_PRD.md  # PRD (754行)
│   └── field-research-*.md
├── herix-server/         # 后端 (2097行 TS)
│   └── src/
│       ├── index.ts           # 入口
│       ├── db.ts              # DB初始化
│       ├── middleware/auth.ts # JWT+多角色
│       ├── utils/mailer.ts    # 邮件发送
│       ├── routes/
│       │   ├── auth.ts        # 注册/登录/切换角色
│       │   ├── tasks.ts       # 任务+推广码
│       │   ├── applications.ts
│       │   ├── submissions.ts
│       │   ├── users.ts
│       │   ├── ambassador.ts  # 入驻
│       │   ├── referrals.ts
│       │   ├── ratings.ts
│       │   └── admin.ts       # 运营后台
│       └── types/
└── herix-miniapp/        # Taro 小程序 (待同步)
```

---

## 6. 接手后下一步建议

1. **熟悉三端代码**: 预览(preview) / 品牌(merchant) / 运营(admin) 分别读一遍
2. **验证全流程**: 品牌发任务→赫使报名→提交→审核结算 走一遍确保没因为重构出问题
3. **Taro 小程序同步**: 三端功能同步到小程序代码
4. **邮件通知**: mailer.ts 已写, 需接入真实 SMTP
5. **PRD 落地度**: 对照 754 行 PRD, 盘点差距

