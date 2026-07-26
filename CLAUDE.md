# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 启动与开发命令

```bash
# 后端（TypeScript，tsx 直接运行，无需编译）
cd herix-server
DATABASE_URL=postgres://localhost:5432/herix \
JWT_SECRET=herix-dev-secret-change-in-production \
PORT=4005 \
node node_modules/tsx/dist/cli.mjs src/index.ts

# 类型检查（不输出文件）
npx tsc --noEmit

# 生产构建
npm run build        # 输出到 dist/
```

前端是静态 HTML，Express 服务器同时托管 `/`（静态文件目录为项目根目录），无需单独启动。
访问 `http://localhost:4005/herix.html` 即可。

---

## 架构概览

### 三端前端 + 一个后端

| 文件/目录 | 用途 | 角色 |
|------|------|------|
| `herix-miniapp/` | 赫使（KOL/大使）端 | **Taro(React) 双端**：微信小程序 + H5。浏览任务、报名、提交、钱包、消息、入驻引导；中日英三语 |
| `merchant.html` | 品牌商家端 | 发布任务、审核报名、审核内容、数据上传（纯 HTML 无构建） |
| `admin.html` | 运营后台 | 用户管理、任务管理、结算、KYC 审核、本地化词条矩阵（纯 HTML 无构建） |
| `herix-server/` | Express + TypeScript API | 统一后端，端口 4005（⚠️ 原 3005 与 MT5 回测 Agent 端口段 3000+ 冲突，2026-07-17 迁移）|

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
- 开发：Mac 本地 launchd 跑 `herix-server`（端口 4005，`launchctl kickstart -k gui/$(id -u)/com.herix.server` 重启；
  **改 plist 环境变量后 kickstart 不够，须 `launchctl bootout` + `bootstrap` 完整重载**），
  数据库为 **Mac 本机 PostgreSQL**（`localhost:5432/herix`，与生产完全独立——⚠️ 2026-07-17 之前本节误写为
  "经隧道连 ECS PG"，实测纠正：本地/生产是两个库，本地的数据和 seed 不会自动出现在生产）
- 生产：**正式入口 `herix.huaxuex.com`**（Cloudflare Tunnel `herix-app`/cloudflared-herix.service → ECS 8.210.73.0）。
  **ECS 部署手册（2026-07-17 首次全量部署实录）**：代码在 `/home/herix/Herix`，pm2 应用名 `herix`，
  跑的是**编译产物** `herix-server/dist/index.js`（非 tsx），端口 3005（ECS 无 MT5 冲突，勿与本地 4005 混淆）：
  1. Mac：`git push`（ECS 走 pull 部署，先推）
  2. ECS：`cd /home/herix/Herix && git status --short`（必须干净）→ `git pull`
  3. `cd herix-server && npm install && npm run build`（tsc → dist，**漏 build = 跑旧代码**）
  4. `pm2 restart herix --update-env` → `curl localhost:3005/api/tasks` 冒烟
  5. **前端均在 Mac 本地 build，ECS 不构建**，通过 rsync 同步（漏 rsync = 线上跑旧页面）：
     - H5 miniapp：`cd herix-miniapp && npm run build:h5 && rsync -az --delete dist/h5/ root@8.210.73.0:/home/herix/Herix/herix-miniapp/dist/h5/`
     - 商家端 React：`cd herix-merchant && npm run build && rsync -az --delete dist/ root@8.210.73.0:/home/herix/Herix/herix-merchant/dist/`
     - ⚠️ 凡改动 `herix-merchant/` 或 `herix-miniapp/` 下的文件，必须重新 build + rsync 对应端；纯 server 改动不需要
  6. 环境变量在 `herix-server/.env`（DATABASE_URL/JWT_SECRET/PORT/SMTP_*/REFERRAL_HASH_SALT/WX_PROXY_SECRET 已配齐）
  7. 生产 PG 独立于本地：schema 迁移由启动时 initDatabase 自动打上；**i18n 词条须在 ECS 上手动跑**
     `export $(grep -v '^#' .env | grep '=' | xargs) && npx tsx scripts/seed-i18n.ts`（新增词条的每次部署都要跑）
- 邮件发信域名：`noreply@huaxuex.com`（SendGrid Domain Authentication 已完成，Cloudflare 三条 CNAME + DMARC，
  2026-07-17 实测送达。⚠️ 不要用 @outlook.com 等公共邮箱地址当发件人——SPF 必然不对齐，微软直接判伪造）

部署到任何新环境的必做步骤：`initDatabase()` 启动自动建表（幂等）→ 手动跑一次 `npx tsx scripts/seed-i18n.ts` 灌词条。

小程序分享入口（URL Link + 小程序码，`utils/wechat.ts`）需要环境变量 `WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET`（可选 `WECHAT_MINI_ENV=trial` 测体验版）。未配置时端点返回 `available:false` 优雅降级，商家端显示"小程序发布后可用"——**前提是小程序已发布**，发布后在 launchd plist（生产环境同理）配上凭据即自动生效，无需改代码。

邮件（`utils/mailer.ts`，nodemailer SMTP 465）需要 `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`（发件地址，SendGrid/Resend 的 SMTP 用户名是字面量不是邮箱，所以单独配）。未配置时只打日志不真发。SendGrid：host=smtp.sendgrid.net、user=apikey、pass=API Key、from=已验证发件邮箱。

小程序账号体系（`auth.ts` wechat-login/register/bind-wechat/bind-email）：openid 取自云托管注入的
`X-WX-OPENID` 请求头。⚠️ 公网 ECS 可被直连伪造该头——**生产必须配 `WX_PROXY_SECRET`**，并让云托管代理
（herix-proxy）转发时附 `X-Proxy-Auth: <同值>` 头；未配置=开发模式放行。邮箱统一小写存储、登录 LOWER() 比较。

明细模式去重盐 `REFERRAL_HASH_SALT`（`utils/privacy.ts`）：邀请用户邮箱/ID 的 SHA-256 去重键所用全局盐。未配置有应用级默认值（开发可用），**生产必须显式配置**且配置后不可更换（换盐 = 历史去重键全部失效）。

### 产品路线图（v1.3）

见 `docs/Herix_Ambassador_PRD.md` 第19节，分三期：
- **一期**：评级+段位体系、资金链（充值/托管/打款）、作品集沉淀、品牌复购
- **二期**：AI 内容辅助工具、培训内容库
- **三期**：赫使付费订阅、品牌主动发现模式、MSO 汇款服务

### 运维待办（有触发条件的延期项）

- ~~task spec 表双写日落~~（2026-07-25 用户决策否决过渡态）：CTI 重构未上线，**不做双写，直接终态**——
  类型专属字段只存 task_content_specs/task_referral_specs，发版前去掉双写代码与 COALESCE，
  主表旧列回填后 DROP。见「任务板块整体方案」（2026-07-25 定稿）。

- **订阅服务 P1 正式化**（2026-07-26 记，触发条件：出现真实订阅客户）：P0 已上（brand_profiles
  三列 + admin 手动维护 + 发布并发不限）。P1 = `merchant_subscriptions` 表（档位/专属顾问/起止/
  **每月N次成交兜底权益台账**——平台保证接单交付，接不满顾问补位）+ admin 订阅管理页 +
  商户端权益展示 + 订阅捆绑佣金折扣（复用 commission_rate_override）。
  定价三档：基础版/高级版/定制版（合同单签），金额未定。

- **图片存储迁移 OSS + uploads 备份**（2026-07-25 记，用户定为"正式上线后 3 个月"复查）：
  当前图片（logo/promo/cover/KYB证件）存 ECS 本地磁盘无备份，磁盘损坏即全丢。
  提前触发条件（任一满足即做，不必等 3 个月）：①真实商家开始付费入驻 ②uploads 目录超过几 GB。
  短期止血项 = uploads 目录 crontab 定时备份；正式方案 = 迁阿里云 OSS（内网免流量费）+ CDN。
  迁移成本低：存图已收口在 `saveBrandAsset`/`saveTaskCover`（utils/uploads.ts），换 OSS SDK 只改这一处，
  存量文件 rsync 一次搬完。流程层（multipart+sharp压缩+DB只存URL）已是最佳实践不用动。

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
- **i18n 词条 key 由代码 seed 创建**，运营只改译文；seed 只覆盖 `updated_by='seed'` 的行。
  **任何触碰 i18n 的改动（含其他 AI 会话的）收尾跑 `/i18n-review`**——体系是四件套(三语json+context+seed双库+构建部署)，外部改动常只做第一件（2026-07-17 实例）
- **国际化分叉（2026-07-19，PRD §27.1/§27.2）**：越南语(vi)**仅覆盖客户端（赫使端小程序/H5）**；
  韩文(ko)**仅覆盖商户端**(merchant.* 全部 + merchant.html/shared/auth.js 引用的共享键，checkKoParity 守卫)；
  主页(index.html)=中日英韩(内嵌静态词典，不走DB)；admin维持中日英。规则由三层强制：
  ①新增**客户端**词条必须同时写 zh/ja/en/vi 四份，`check-terms.js` 的 checkViParity()
  会警告缺失（merchant.* 混进 vi.json 则直接报错退出）；
  ②admin 本地化矩阵 merchant.* 行的 vi 列显示"—"不给输入框；
  ③服务端 PATCH /admin/i18n/:key 拒绝给 merchant.* 写 vi。
  将来商家侧若真要加语言，是独立决策——别顺手"补齐"。
- **钱包代码**：余额读写必须走 `utils/wallet.ts` 的 `applyWalletEntry`（行锁+幂等+事务）；多步业务+钱包操作用 extClient 合并进单事务
- **金额展示**统一用 `utils/format.ts` 的 `fmt`，不要 `toLocaleString`（小程序引擎差异）
- **配置类数值**（提现最低额等）走 `platform_settings` 单一事实源，前端由接口下发，禁止写死
- **枚举/分类字段一律存稳定 ASCII id，禁止存显示文本**（2026-07-18 立）：DB 里存 `beauty`/`permanent` 这类 id，
  显示文本属于展示层（i18n 词条或前端映射表）。存文本的代价是三连锁：没法翻译、没法改文案（改了和历史数据对不上）、
  没法做逻辑分支（字符串比对撞上简繁/全半角）。已踩过的实例：`industry` 存"美妆"、`visa_type` 存"永住者"，
  都靠幂等 UPDATE 迁移 + 前端兼容层才救回来。新增任何枚举字段前对照 `/db-design-review` 原则 #8 自查；
  写选项列表时的自检问题："这个 value 如果直接拼进 SQL 或 URL 会不会出现非 ASCII？"会 → 说明存的是文案不是 id


## 品牌术语规范（2026-07-17 定稿，PRD §27 为唯一权威）

对外文案（主页/后台/小程序词条/邮件/通知）必须使用定稿术语，**写文案前查表，改完跑检查器**：

| 概念 | 中 | 日 | 英 |
|------|-----|-----|-----|
| 推广者 | 赫使 | アンバサダー | Ambassador（禁 Heralds） |
| 代理 | 广告代理（禁"代理商"） | 広告代理店 | Agency |
| 推广码 | 推广码 | 紹介コード（禁プロモコード） | Referral code |
| 转化/结算 | 转化/结算 | コンバージョン（禁転換）/ 精算（禁結算） | Conversion / Settlement |
| 定位 | 海外生活社群（禁"海外华人"） | 海外ルーツコミュニティ（禁移住者） | Diaspora communities |
| 一单合作 | 任务 | 案件（营销文案层；界面词条现用タスク） | Campaign（营销层；界面用 task） |

- **检查器**：`node scripts/check-terms.js`（扫全部对外文案文件，违例退出码 1）——发版前必跑
- 新增对外文案文件时，把路径补进 check-terms.js 的 TARGETS
- 术语变更 = 产品决策：先改 PRD §27，再改 check-terms.js 禁用词表，最后改文案
