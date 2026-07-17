# Herix PRD 实现进度

> 更新日期：2026-07-16  
> 对照版本：PRD v1.4（含 §24 定向任务、§15.9 多语言、§26 变更记录）

图例：✅ 已实现 · ⚠️ 部分实现 · ❌ 未实现

---

## 一期 P0（上线前必须）

| 功能 | PRD 章节 | 状态 | 备注 |
|------|---------|------|------|
| 定向任务（Private Task） | §24 | ❌ | `task_invitations` 表未建，`tasks.visibility` 字段未加，API 全缺，前端两端均无 UI |
| 资金链：品牌充值 | §21.6 | ✅ | 4步向导已实现（merchant.html），topup_requests 完整 |
| 资金链：任务锁定 / 结算 / 退款 | §21 | ✅ | task_transactions + wallet_entries 双账本已实现 |
| 资金链：赫使提现申请 | §11 | ✅ | withdraw-request API + admin 审批已实现 |
| 提现收款方式管理 | §10 | ✅ | withdrawal_methods CRUD 已实现 |

---

## 一期 P1（上线后尽快）

| 功能 | PRD 章节 | 状态 | 备注 |
|------|---------|------|------|
| KYC / 在留资格审核（admin 端） | §9、§10 | ⚠️ | declarations 表已建，admin.html 有审批入口；但身份证件上传、银行账户收集步骤未完整实现 |
| 品牌入驻方案选择（Launch/Scale/Alliance） | §22.1 | ❌ | brand_profiles 无 plan 字段，无 credit_limit，入驻向导只有通用2步，未区分方案 |
| 报名档案展示（品牌审核时查赫使完整档案） | §17.4 | ⚠️ | 有基础档案显示，但作品集、成长路径、全平台段位展示未实现 |
| 评级 + 段位体系 | §17.2 / §17.3 | ⚠️ | tier_snapshot 字段已建，calcTier() 已实现，task_ratings 表已建，ratings 路由已实现；但 admin 端打分 UI、herald 端评级展示卡片未完整 |

---

## 一期 P2

| 功能 | PRD 章节 | 状态 | 备注 |
|------|---------|------|------|
| 作品集自动沉淀 | §17.5 | ❌ | 审核通过时无自动写档案逻辑，herald_profiles 无作品集字段 |
| 成长路径可视化 | §17.6 | ❌ | 赫使端小程序 profile 页已有成长档案卡（评级/完成数/好评率/升级进度），但按平台段位的进度可视化未实现 |

---

## 一期 P3

| 功能 | PRD 章节 | 状态 | 备注 |
|------|---------|------|------|
| 品牌复购机制 | §17.7 | ❌ | 可用定向任务代替，等定向任务实现后一并完成 |
| 定价矩阵引导 | §18 | ❌ | 创建任务时无建议报酬范围提示 |

---

## 其他功能模块

| 功能 | PRD 章节 | 状态 | 备注 |
|------|---------|------|------|
| 推广码任务全流程（类型A） | §3 | ✅ | 码池、CSV上传、转化记录、分配逻辑均已实现 |
| 体验分享任务全流程（类型B） | §6、§7、§8 | ✅ | 提交、审核、拒绝重提交均已实现 |
| 存续时间二次截图核查 | §8 | ❌ | check_due_date 未实现，30天到期提醒 + 逾期扣款逻辑全缺 |
| 大使进度看板（今日/本月统计） | §5 | ⚠️ | 载体已迁 miniapp「任务」中心（herald-dashboard）：收支摘要+待办+报名历史已实现；推介明细列表（英文Token、三步骤状态）未完整实现 |
| 审核 Checklist 界面 | §8 | ⚠️ | admin 有审核操作，但无 ContentRequirements 自动生成的逐项 checklist |
| 居住地收集 + 税务分支 | §9 | ✅ | 入驻向导已收集 residence，japan/overseas 分支已实现 |
| 在职资格声明（在日大使） | §9 | ✅ | declarations 表完整，ambassador.ts 处理声明流程 |
| 防重复提交（URL去重+hash） | §11 | ⚠️ | ambassador/task 唯一约束已实现，但截图 MD5 hash 去重未实现 |
| 任务容量控制（max_ambassadors） | §3.1 | ✅ | 已实现 |
| 多角色账号体系 | §15.2 | ✅ | roles 数组、add-role API、JWT 兼容均已实现 |
| 社交平台注册表 | §15 | ✅ | shared/platforms.js，PLATFORM_REGISTRY 完整 |
| 报名时平台验证 | §15.0.5 | ⚠️ | 硬性门槛检查已实现，软性提示 UI 不完整 |
| 邮件通知 | §15.5 | ⚠️ | nodemailer 已配置，部分节点已触发；打款完成通知未实现 |
| 品牌 LOGO / 宣传图上传 | §22.4 | ✅ | uploads.ts + sharp 处理均已实现 |
| 请求书 / 领收书 PDF 自动生成 | §22.2 | ❌ | 充值确认时无 PDF 生成，月结请求书也未实现 |
| Scale / Alliance 信用额度 + 月结 | §22.3 | ❌ | credit_limit 字段未建，余额负值逻辑未实现，月结批处理未实现 |
| 自动种子数据 | §16.3 | ❌ | **2026-07-16 已删除**：seedIfEmpty 写的旧表 transactions 在 PG 不存在，空库启动会崩；需要 demo 数据须重写对齐新 schema |
| 部署 | §16.7 | ⚠️ | **Render 已弃用（2026-07-16 移除配置）**；开发=本地+ECS PG，生产方案待定 |

---

## 平台与基建落地（2026-07-09 ~ 07-16，PRD 功能表之外的工程项）

| 项 | 状态 | 说明 |
|---|------|------|
| 赫使端 Taro 迁移（weapp+H5 双端） | ✅ | 11 页面全量，preview.html 删除，herix.html 待退役 |
| 桌面响应式布局 | ✅ | ≥768px：列表两列/详情侧栏/表单限宽；rem 密度锁定 |
| 中日英三语体系 | ✅ | 416 词条×3语+语境，admin 本地化矩阵，错误 code 化，通知三语（详见 PRD §15.9） |
| 钱包并发安全 | ✅ | 行锁修复丢更新；提现申请单事务化 |
| 最低提现 ¥1,000 统一 | ✅ | platform_settings 单一事实源，前端动态下发 |
| 死代码清理 + 架构评审 | ✅ | 评审报告见 2026-07-16 会话；遗留项列于 PRD §26.7 |
| ja/en 译文人工审校 | ❌ | 机翻初稿待运营过矩阵（日语敬语/法律声明优先） |
| 流水标签三语化 | ❌ | ENTRY_TYPE_LABELS 仍后端中文，i18n 体系最后一处尾巴 |
| 定价模块（分商家费率+促销） | ✅ | 2026-07-16：默认抽佣定稿20%；pricing_promotions 表+决策链 min(协议价??默认, 促销)；admin「定价」页；行为学测试6/6（详见 pricing_module_prd.md §九） |
| 未登录语言切换入口 | ✅ | 2026-07-16：landing + profile 登录页均可切换三语 |
| 通知角色隔离 | ✅ | 2026-07-16 修复：隔离维度从"拥有的角色集合"改为"当前端声明角色"（?role= + 服务端校验），双角色账号商家端不再看到赫使侧通知，read-all 也按端隔离 |
| 转化数据上传生效 + 赫使通知 | ✅ | 2026-07-16：修3处根因——①历史 PERFORMANCE 任务 upload_token 为 NULL（迁移回填）②码匹配不归一化+全跳过仍显示绿色成功（归一化+skippedCodes 如实警示）③HERIX_PLATFORM 用户缺失致首次结算 FK 崩服务器（迁移种子+unhandledRejection 兜底）。新增 CONVERSION_SETTLED/CONVERSION_UPDATED 赫使通知（三语），行为测试 11/11（详见 PRD §4） |
| 分享区块三入口 | ✅ | 2026-07-17：H5链接（永久）+ 小程序 URL Link（30天DB缓存自动续，`GET /tasks/:id/weapp-link`）+ 小程序码（永久，`GET /tasks/:id/weapp-qrcode`，landing 支持 scene 参数）。凭据未配置/小程序未发布时优雅降级显示占位——**待用户发布小程序后配 WECHAT_MINI_APPID/SECRET**（见 CLAUDE.md 部署节） |
| 资格要求"任N满足/全部满足" | ✅ | 2026-07-17：tasks.req_mode(ALL/ANY_N)+req_min_count；ANY_N=列出项全算候选、满足任意N项即可（忽略单项"必须"标志）；ALL=现行为不变。创建/草稿编辑/meta编辑三处UI+接口，服务端校验带 needCount/satisfiedCount，Taro 预检面板同语义+anyN提示行（三语）。行为测试 7/7 |
| 数据回传明细模式 | ✅ | 2026-07-17：tasks.data_mode(AGGREGATE/DETAIL,发布后锁定,不可混用)+referral_records 表(UNIQUE(task_id,user_hash) 身份去重+行级 settled_txn_id)。一人多码各码分别计费(multiCodeUsers 透明提示,当日修订取代冲突拦截+改判设计,理由:赫使推广真实发生就该有回报)；隐私三底线(原文不落库/全局盐哈希/脱敏展示)；商家「跟踪明细」tab+赫使「邀请进度」(三语)；两个上传页模式感知+注意事项清单；旧 referrals 死表删除。行为测试 17/17（详见 PRD §4） |
| 上传页条款同意门 + 获客钩子 | ✅ | 2026-07-17：upload.html 品牌方(非平台用户)进入前须点击同意「数据上传条款」，upload_consents 表记录时间/IP/UA 电子证据；token 通道服务端强制(无同意记录 403 CONSENT_REQUIRED)，Bearer 商家通道豁免(入驻已签协议)。商家服务协议升 2026-07-17-v2：第五条扩充为数据处理(委托)条款(不存明文/用途限定/可清除/72h泄露通知)。上传页加注册商家账号获客 CTA(页底常驻+上传成功后)。测试 19/19+14/14 |
| 代理任务的品牌方权限 | ✅ | 2026-07-17：tasks.brand_party_id；绑定=品牌凭数据上传链接自助(当日修订:邀请链接机制拆除,先到先得+代理可解绑兜底,确认制否决:太麻烦)。品牌方=完整商家账号，对绑定任务只看进展(数量/状态)不见结算金额(csv响应裁剪totalPaid/单价)、可直接上传数据、不可审核/改判。顺手修3处：公开任务详情泄露upload_token/brand_invite_token(改optionalAuth+创建者才回token)、referrals/stats无归属校验任何商家可查、codes/export与my/stats仍查已删referrals死表致500。测试14/14 |
| 注册邮箱验证码 | ✅ | 2026-07-17：verification_codes 表+POST /auth/send-code（6位码/30分钟/60秒限频/小时5次/5次尝试锁死/一次性消费），邮箱注册强制验证所有权。三处前端接入：Taro landing（三语+60s倒计时）、shared/auth.js 注册表单（herix.html 自动获得）、herix.html 落地弹窗。发信走 noreply@huaxuex.com（SendGrid 域名认证）。行为测试 9/9。验证码免密登录/二步验证待需求 |
| 品牌方多账号绑定 + 任务关闭30天缓冲期 | ✅ | 2026-07-17：task_brand_parties 表(一任务多品牌账号,同账号幂等,代理逐个解绑,存量单列迁移)。任务 COMPLETED 后 30 天缓冲期：上传/查看仍开放,到期惰性失效(无定时任务);/csv 补生命周期闸门(修复:已关闭任务凭 token 仍能结算的口子);关闭时全部持码赫使收 TASK_CLOSING 通知(三语+邮件,带缓冲截止日)催邀请用户转化。测试 22/22 |
| 商户信任-好友进度查询 | ❌ | 待做：赫使输入自己认识的邮箱→本地哈希→匹配自己名下记录→显示已注册/已转化，明文不上传；商家用ID模式时不可用(催单责任回商家CRM)——2026-07-17 讨论定案，见会话记录 |

---

## 当前最高优先级 TODO

按影响力排序：

1. **❌ 定向任务 §24**（P0）
   - 加 `tasks.visibility` 字段
   - 建 `task_invitations` 表
   - 实现 3 个 API（创建邀请 / 查询 / 响应）
   - merchant.html 任务创建加「定向」开关 + 赫使搜索
   - 赫使端小程序（herald-dashboard）加「专属邀请」区块（preview.html 已删除）

2. **❌ 品牌方案分层 §22.1**（P1）
   - `brand_profiles` 加 `plan` + `credit_limit` 字段
   - 入驻向导第一步改为方案选择（Launch/Scale/Alliance）
   - Scale/Alliance 入驻路径跳转到联系销售页面

3. **❌ 作品集自动沉淀 §17.5**（P2）
   - 提交审核通过时写入 herald_profiles

4. **❌ 存续核查 §8**（P1）
   - task_submissions 加 `check_due_date` 字段
   - 定时任务：到期前3天通知 + 逾期扣款

5. **❌ 请求书PDF §22.2**（P1，规模化前需完成）
