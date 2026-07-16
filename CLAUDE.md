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
访问 `http://localhost:3005/herix.html` 即可。

---

## 架构概览

### 三端前端 + 一个后端

| 文件/目录 | 用途 | 角色 |
|------|------|------|
| `herix-miniapp/` | 赫使（KOL/大使）端 | **Taro(React) 双端**：微信小程序 + H5。浏览任务、报名、提交、钱包、消息、入驻引导；中日英三语 |
| `merchant.html` | 品牌商家端 | 发布任务、审核报名、审核内容、数据上传（纯 HTML 无构建） |
| `admin.html` | 运营后台 | 用户管理、任务管理、结算、KYC 审核、本地化词条矩阵（纯 HTML 无构建） |
| `herix-server/` | Express + TypeScript API | 统一后端，端口 3005 |

**赫使端有构建步骤**：`cd herix-miniapp && npm run build:h5 / build:weapp`（输出分别到 `dist/h5` `dist/weapp`，勿共用）。
品牌/管理端仍是纯 `var`/DOM 单页 HTML，`XMLHttpRequest` 调 `/api/...`。`herix.html` 是赫使端旧版，待退役勿再开发。

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
    ├── wallet.ts      # 钱包余额 / 提现方式 / 提现申请（单事务） / 交易记录
    ├── referrals.ts   # 推荐码关联
    ├── notifications.ts / categories.ts / ratings.ts / qr.ts
    └── i18n.ts        # 三语词典（公开 GET /api/i18n/:locale + admin 矩阵，seed: scripts/seed-i18n.ts）
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

### 部署（2026-07-16 更新）

**Render 已弃用**（render.yaml 与 package.json 的 render-* scripts 已删除，PRD 中 onrender.com 地址全部作废）。

当前环境：
- 开发：Mac 本地 launchd 跑 `herix-server`（端口 3005，`launchctl kickstart -k gui/$(id -u)/com.herix.server` 重启），
  数据库为 ECS 上的 PostgreSQL（经 SSH 隧道 `localhost:15432`，凭据在 launchd plist 环境变量，不在 .env）
- 生产：部署方案待定稿后补充本节（定稿时遵守"文档联动"准则）

部署到任何新环境的必做步骤：`initDatabase()` 启动自动建表（幂等）→ 手动跑一次 `npx tsx scripts/seed-i18n.ts` 灌词条。

小程序分享入口（URL Link + 小程序码，`utils/wechat.ts`）需要环境变量 `WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET`（可选 `WECHAT_MINI_ENV=trial` 测体验版）。未配置时端点返回 `available:false` 优雅降级，商家端显示"小程序发布后可用"——**前提是小程序已发布**，发布后在 launchd plist（生产环境同理）配上凭据即自动生效，无需改代码。

邮件（`utils/mailer.ts`，nodemailer SMTP 465）需要 `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`（发件地址，SendGrid/Resend 的 SMTP 用户名是字面量不是邮箱，所以单独配）。未配置时只打日志不真发。SendGrid：host=smtp.sendgrid.net、user=apikey、pass=API Key、from=已验证发件邮箱。

### 产品路线图（v1.3）

见 `docs/Herix_Ambassador_PRD.md` 第19节，分三期：
- **一期**：评级+段位体系、资金链（充值/托管/打款）、作品集沉淀、品牌复购
- **二期**：AI 内容辅助工具、培训内容库
- **三期**：赫使付费订阅、品牌主动发现模式、MSO 汇款服务

---

## 工作准则

### 文档联动（2026-07-16 立）

**产品决策**（金额/规则/口径，如"最低提现 ¥1000"）和**架构变更**（载体切换/技术栈迁移/表结构语义变化）落码时，
**同一个 commit 顺手更新** `docs/Herix_Ambassador_PRD.md` 对应章节（重大项追加变更记录节）与 `docs/PRD_PROGRESS.md` 状态行。
纯实现细节不需要。背景：2026-07-08~16 文档与代码脱节 8 天，PRD 里留着已删除的载体和已作废的 seed 说明，对账成本很高。

### 本项目踩过的坑（新代码必须遵守）

- **Taro H5 页面样式全局生效**（小程序才按页隔离）：页面级类名必须带页面前缀（如 `hd-card`），裸 `.task-card`/`.card`/`.btn-primary` 曾造成跨页污染
- **模块级常量不存 `t()` 结果**（会冻结在启动时语言），存 `labelKey` 渲染时取值
- **局部变量不要叫 `t`**（遮蔽 i18n 的 `t()`，已炸过两次：messages timeAgo、apply loadContext）
- **i18n 词条 key 由代码 seed 创建**，运营只改译文；seed 只覆盖 `updated_by='seed'` 的行
- **钱包代码**：余额读写必须走 `utils/wallet.ts` 的 `applyWalletEntry`（行锁+幂等+事务）；多步业务+钱包操作用 extClient 合并进单事务
- **金额展示**统一用 `utils/format.ts` 的 `fmt`，不要 `toLocaleString`（小程序引擎差异）
- **配置类数值**（提现最低额等）走 `platform_settings` 单一事实源，前端由接口下发，禁止写死

