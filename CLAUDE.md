# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 启动与开发命令

```bash
# 后端（TypeScript，tsx 直接运行，无需编译）
cd herix-server
DATABASE_URL=postgres://localhost:5432/herix \
JWT_SECRET=herix-dev-secret-change-in-production \
PORT=3005 \
node node_modules/tsx/dist/cli.mjs src/index.ts

# 类型检查（不输出文件）
npx tsc --noEmit

# 生产构建
npm run build        # 输出到 dist/
```

前端是静态 HTML，Express 服务器同时托管 `/`（静态文件目录为项目根目录），无需单独启动。
访问 `http://localhost:3005/preview.html` 即可。

---

## 架构概览

### 三端前端 + 一个后端

| 文件 | 用途 | 角色 |
|------|------|------|
| `preview.html` | 赫使（KOL/大使）端 | 浏览任务、报名、提交内容、钱包 |
| `merchant.html` | 品牌商家端 | 发布任务、审核报名、审核内容、数据上传 |
| `admin.html` | 运营后台 | 用户管理、任务管理、结算、KYC 审核 |
| `herix-server/` | Express + TypeScript API | 统一后端，端口 3005 |

**前端没有构建步骤**：三个 HTML 文件是独立的单页应用，纯 `var`/DOM 操作，无框架。所有 API 调用用 `XMLHttpRequest`，路径为相对路径 `/api/...`（同源，端口 3005）。

`shared/auth.js` 和 `shared/sidebar.js` 是三端共用的 UI 组件，用 `<script src>` 引入。

---

### 后端结构

```
herix-server/src/
├── index.ts          # Express 入口，挂载所有路由，同时托管静态文件
├── db.ts             # PostgreSQL 连接池（pg），initDatabase() 建表 + 迁移
├── utils/db.ts       # findOne / findMany / insert / update / remove（? → $N 转换）
├── middleware/auth.ts # JWT，requireAuth / optionalAuth / requireRole
├── types/index.ts    # Zod schema（RegisterSchema、CreateTaskSchema 等）
└── routes/
    ├── auth.ts        # 注册 / 登录（含 parseRoles 兼容旧 token）
    ├── tasks.ts       # 任务 CRUD / 发布 / 推广码池 / CSV 数据回传
    ├── applications.ts# 报名 / 审核（含平台要求校验）
    ├── submissions.ts # 提交内容 / 审核结算
    ├── users.ts       # 资料更新 / 多角色 add-role / 品牌入驻
    ├── ambassador.ts  # 赫使入驻 onboard / 档案更新 / 在留声明
    ├── admin.ts       # 管理员接口（requireRole('ADMIN') 全局守卫）
    ├── wallet.ts      # 钱包余额 / 提现方式 / 交易记录
    └── referrals.ts   # 推荐码关联
```

---

### 数据库关键设计

**PostgreSQL**，`DATABASE_URL` 环境变量必须设置，启动时抛错。

`db.ts` 内的 `initDatabase()` 使用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 迁移模式，每次启动自动执行，幂等安全。

**多角色**：`users.roles TEXT`（JSON 数组，如 `["HERALD","BRAND"]`），`users.role TEXT` 保留主角色向后兼容。JWT 同时携带 `role` 和 `roles`。`requireRole(...allowed)` 检查 `roles` 数组，任一匹配通过。

**推广码池**：PERFORMANCE 类型任务创建时生成 N 个码存入 `task_promo_codes`；报名审核通过时从池中分配一个码给赫使。

**SQL 占位符**：代码里统一写 `?`，`utils/db.ts` 的 `toPgSql()` 在执行前自动转换为 `$1, $2, ...`。

---

### 路由顺序陷阱

`tasks.ts` 中 `GET /my/stats` **必须** 注册在 `GET /:id` 之前，否则 `my` 会被当作 task ID 导致 404。其他路由文件同理，精确路径要在通配参数路由之前。

---

### 前端状态管理模式

三个前端文件各自维护一个 `state` 对象（全局变量），每次变更后调用 `render()` 重绘整个页面。无虚拟 DOM，全量字符串拼接 innerHTML。

`bindPage()` / `bindDetail()` 等函数在 `render()` 之后调用，用于绑定事件。动态生成的表格行使用**事件委托**（`closest('[data-id]')`），不直接在 `<tr onclick>` 上绑定。

Auth 回调需要同时设置 `onLogin` 和 `onRegister`：
```javascript
Auth.init({ onLogin: function(d){ afterAuth(d); }, onRegister: function(d){ afterAuth(d); }, api: API + '/auth' });
```

---

### 社交平台注册表

`shared/platforms.js` 是平台数据的**唯一来源**，三端通过 `<script src="/shared/platforms.js">` 引入。
包含：`PLATFORM_REGISTRY`（平台列表）、`calcTier(followers)`（前端展示用段位计算）、`platformById(id)`（按 id 查找）。

`inputType: 'id'` 表示收账号 ID（微信、LINE、Zalo、WhatsApp）；`inputType: 'url'` 表示收主页链接。

段位的**权威值**存储在后端 `herald_profiles.tier_snapshot`（JSON，如 `{"xiaohongshu":"Micro","tiktok":"Nano"}`），在 `ambassador.ts` 的 `onboard` 和 `PATCH /profile` 时自动计算写入。前端 `calcTier()` 仅用于即时展示，以后端 `tier_snapshot` 为准。

---

### 部署（Render）

`render.yaml` 配置单服务 + PostgreSQL 数据库，新加坡区域。
构建命令：`cd herix-server && npm install && npx tsc`
启动命令：`cd herix-server && node dist/index.js`
环境变量：`JWT_SECRET`（自动生成）、`DATABASE_URL`（来自 Render 数据库）。

本地开发环境变量写在 `herix-server/.env`（不提交）。

---

### 产品路线图（v1.3）

见 `docs/Herix_Ambassador_PRD.md` 第19节，分三期：
- **一期**：评级+段位体系、资金链（充值/托管/打款）、作品集沉淀、品牌复购
- **二期**：AI 内容辅助工具、培训内容库
- **三期**：赫使付费订阅、品牌主动发现模式、MSO 汇款服务
