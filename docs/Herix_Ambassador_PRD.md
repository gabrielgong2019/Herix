# Herix 赫使 — 大使任务系统 PRD
**版本：** v1.4 · 2026-07-16  
**状态：** Draft  
**用途：** AI工程师开发参考文档

---

## 目录
1. [背景与目标](#1-背景与目标)
2. [任务类型定义](#2-任务类型定义)
3. [类型A：推广码任务流程](#3-类型a推广码任务流程)
4. [类型A：数据回传方案](#4-类型a数据回传方案)
5. [类型A：大使进度看板](#5-类型a大使进度看板)
6. [类型B：体验分享任务流程](#6-类型b体验分享任务流程)
7. [类型B：内容规范结构](#7-类型b内容规范结构)
16. [2026-05-31 变更记录](#16-2026-05-31-变更记录)

8. [类型B：审核流程](#8-类型b审核流程)
9. [大使居住地与税务逻辑](#9-大使居住地与税务逻辑)
10. [身份核验与银行账户收集](#10-身份核验与银行账户收集)
11. [结算与款项](#11-结算与款项)
12. [数据模型](#12-数据模型)
13. [状态机](#13-状态机)
14. [开发优先级清单](#14-开发优先级清单)
15. [社交平台体系与国际化架构](#15-社交平台体系与国际化架构)
16. [系统实现记录（2026-05-30）](#16-系统实现记录2026-05-30)
17. [赫使成长体系（2026-06-09）](#17-赫使成长体系2026-06-09-新增)
18. [定价矩阵（2026-06-09）](#18-定价矩阵2026-06-09-新增)
19. [产品路线图（2026-06-09）](#19-产品路线图2026-06-09-新增)
22. [品牌定价方案与结算分层（2026-06-17）](#22-品牌结算分层与素材体系2026-06-14-新增)
23. [广告代理定位（2026-07-06）](#23-广告代理agency定位2026-07-06-简化2026-07-18-术语架构均更新)
24. [定向任务（2026-07-06）](#24-定向任务private-task2026-07-06-新增)

---

## 1. 背景与目标

赫使平台（Herix）连接品牌方与海外侨民KOL/KOC（赫使），通过任务系统实现营销变现。

**三方角色：**
- **品牌方**：发布营销任务，设定奖励规则
- **赫使（大使）**：旅居海外的KOL/KOC，接任务、执行、获得报酬
- **平台运营**：负责匹配、托管资金、核验结果、保障信任

**首个接入方案（Remitly Japan）**：提供两种任务类型作为参考实现。设计需支持通用方案扩展。

---

## 2. 任务类型定义

| 维度 | 类型A：推广码任务 | 类型B：体验分享任务 |
|------|----------------|------------------|
| 典型示例 | Remitly 大使计划 | 体验汇款并发到小红书 |
| 领码方式 | 申请后系统自动生成唯一推广码 | 直接领取，无推广码 |
| 执行对象 | 推广给他人（第三方用户） | 大使本人完成指定行为 |
| 效果验证 | 系统自动（商家CSV数据回传） | 人工审核（大使提交证据） |
| 奖励触发 | 商家数据确认后计入 | 平台审核通过后触发 |
| 结算周期 | 按月 | 审核通过后计入当月 |

---

## 3. 类型A：推广码任务流程

### 3.1 申请与推广码获取

```
1. 大使浏览任务列表，点击任务卡片
   显示：大使奖励额度、被推荐用户优惠、成功条件、任务容量

2. 资质声明（首次申请任务时触发，一次性，永久记录）
   → 见第9节居住地与税务逻辑

3. 点击"接受任务"
   → 系统自动生成唯一推广码，格式：HERIX-[6位随机字母数字]
   → 检查任务容量，已满则不允许申请

4. 任务状态变为"运行中"
   → 大使进入任务详情页，可复制推广码和分享链接
```

### 3.2 效果认定条件（以Remitly为例）

成功介绍（qualifying referral）需同时满足以下全部条件：
- 被推荐用户使用推广码完成注册
- 完成KYC身份认证
- 完成首次汇款，金额 ≥ ¥10,000
- 推广码仅对新用户有效，每人仅限一次
- 推广码有效大使本人不可作为被推荐人

### 3.3 结算规则（以Remitly为例）

| 参数 | 值 | 说明 |
|------|-----|------|
| 单次奖励 | ¥3,000 / 件 | 每笔成功介绍 |
| 首次结算门槛 | 累计 5 件 | 未达门槛当月结转 |
| 结算周期 | 每月 | 月末结算，次月初打款 |
| 用户优惠 | 首次汇款 ¥1,500 减免 | 使用推广码注册后自动触发 |

---

## 4. 类型A：数据回传方案

> ⚠️ 推广码任务的核心依赖是商家将转化数据回传赫使平台。初期用CSV方案，中长期升级Webhook。

### 初期方案（CSV定时上传）✅ 已实现（累计计数格式）

**商家上传CSV字段定义（实际实现，与最初设想的事件流格式不同——按累计口径）：**

```csv
code,注册数,使用数
HERIX-A3K9Z2,10,5
```

- `注册数` / `使用数` 填**累计值**（非增量）；系统按 `使用数 − 已结算次数` 计算新增转化
- 入口：商家后台「数据上传」页（Bearer 鉴权）或任务详情的品牌专属上传链接 `upload.html?task=&token=`（upload_token 鉴权，任务发布时生成）

**上传处理流程（`POST /api/tasks/:id/csv`，2026-07-16 定稿）：**
```
解析 records，推广码归一化（去空白+转大写）后匹配 ambassador_tasks.unique_code
  → 码在该任务下不存在 → 跳过，响应 skippedCodes 如实列出（商家端红色警示，不再伪装成功）
  → 更新 registered_count / used_count（无论有无新增转化）
  → delta = 使用数 − paid_conversions > 0 时：
      · 商家余额不足 → 拦截 + 通知商家 SETTLEMENT_BLOCKED（充值后重新上传）
      · 余额充足 → task_transactions 记账 + 三方钱包结算（商家扣款/赫使入账/平台15%手续费）
      · 通知赫使 CONVERSION_SETTLED（站内信+邮件，metadata 带 code/次数/金额，三语渲染）
  → delta ≤ 0 但计数有变化 → 通知赫使 CONVERSION_UPDATED（数据已更新）
  → 重复上传同样数据幂等：不重复打款、不重复通知
```

> 平台手续费钱包挂在内部用户 `HERIX_PLATFORM`（role=PLATFORM，不可登录）下，由 db.ts 迁移自动种子。

### 明细模式（2026-07-17 上线，任务级二选一，发布后锁定）

`tasks.data_mode = 'AGGREGATE'（默认，上述累计计数） | 'DETAIL'`，创建任务时选择，两种模式**不可混用**。明细模式：

```csv
code,用户邮箱或ID,是否完成交易
HERIX-A3K9Z2,alice@gmail.com,1
```

- **数据模型**：`referral_records` 一行=一个「用户×码」，幂等键 `UNIQUE(task_id, code, user_hash)`——同码内同用户只算一次（商家手滑重复上传免疫）；行级 `settled_txn_id` 防重复打款
- **状态单向**：未出现→已注册→已转化；1 改回 0 不降级，已结算不回收
- **一人多码分别计费**（2026-07-17 定稿，取代当日早先的"冲突拦截+改判"设计）：同一用户使用多个推广码 → 各码分别入库计费。理由：赫使推广真实发生就该有回报（"我邀请了人码也用了为什么不算"无法解释）；一人可用多码是品牌系统的选择与成本，平台无法也不应跨码仲裁。上传结果 `multiCodeUsers` 透明提示；条款（数据上传条款 v2 §三）写明"如不希望重复付费请在系统侧限制一人一码"
- **隐私三底线**（不可选）：原文不落库不落日志（内存里哈希+脱敏后即丢）；去重键=SHA-256(归一化标识+全局盐 `REFERRAL_HASH_SALT`)；展示只到脱敏程度（`a**@gmail.com`）。商家侧提供本平台按"委托处理"承接数据，商家隐私政策需覆盖向平台的提供
- **投影**：`ambassador_tasks` 的注册/使用/已结算计数从明细行 COUNT 派生（明细表是唯一事实来源），赫使端计数展示零改动
- **展示**：商家端任务详情「跟踪明细」tab（逐行：脱敏用户/码/赫使/注册/转化/结算，改判标记含理由）；赫使端任务详情「邀请进度」列表（三语：已注册/已转化/已入账）
- **结算/通知**：复用汇总模式同一套管道（task_transactions + 三方钱包 + CONVERSION_SETTLED/UPDATED）
- **上传条款同意门**（2026-07-17）：品牌方（非平台用户）经 token 链接进入 upload.html 须先点击同意「数据上传条款」（授权声明/处理方式/结算规则），`upload_consents` 记录时间/IP/UA 作为电子证据；服务端对 token 通道强制校验（无记录 403），商家 Bearer 通道豁免（入驻时已签服务协议 2026-07-17-v2，第五条含委托处理条款）。上传页同时承担获客：注册商家账号 CTA
- **待做**：赫使"好友进度查询"（本地哈希匹配，明文不上传）——解决"不知道谁还没下单没法催"与隐私的矛盾；商家选用户ID模式时此路不通，催单责任在商家侧 CRM

### 中期方案（Webhook，升级后取代CSV）

商家每次事件发生时主动POST到赫使平台：

```
POST /api/webhooks/referral-event
{
  "promo_code": "HERIX-A3K9Z2",
  "event": "kyc_completed" | "first_transfer_completed",
  "transfer_amount": 15000,
  "timestamp": "2026-06-03T09:11:00Z"
}
```

---

## 5. 类型A：大使进度看板

### 任务详情页显示内容

```
任务名称：Remitly Japan 大使计划     [运行中]
推广码：HERIX-A3K9Z2               [复制] [分享链接]

今日新增          本月累计
注册  +3          注册      47 人
首转  +1          成功介绍  12 件

当前奖励额度
¥36,000
（¥21,000 已结算 + ¥15,000 待结算）
下次打款日：6月30日
```

### 推介明细列表（英文显示）

| 用户Token | 注册时间 | KYC | 首转 | 计入 |
|----------|---------|-----|------|------|
| U-7F3A | 6/1 | ✓ | ✓ ¥15,000 | ✓ 成功 |
| U-2B8C | 6/3 | ✓ | 待完成 | — |
| U-9E1D | 6/5 | 待完成 | — | — |

> ⚠️ 隐私保护：明细列表不显示被推荐人的姓名或联系方式，仅显示英文Token和状态。符合日本个人信息保护法（APPI）要求。

---

## 6. 类型B：体验分享任务流程

```
1. 大使点击"接受任务"
   → 无推广码，直接进入运行中状态
   → 检查任务容量是否已满

2. 大使自行完成指定行为
   例：使用Remitly完成一笔汇款，并在小红书发布体验帖

3. 回到平台提交证据
   → 选项1：粘贴链接（小红书 / Instagram URL）
   → 选项2：上传截图（微信公众号等无法获取链接的平台）

4. 任务状态变为"审核中"
   → 运营人员按内容规范checklist逐项审核

5. 审核结果
   → 通过：奖励计入待结算余额，通知大使
   → 拒绝：说明原因，允许修改后重新提交（最多3次）
```

---

## 7. 类型B：内容规范结构

商家发布任务时可配置以下字段：

```typescript
ContentRequirements {
  // 关键词要求
  required_keywords: string[]       // ["可靠","便宜","快速","サービスが良い"]
  keyword_match_type: "any" | "all" // 至少含其中一个 or 全部包含
  keyword_note: string              // 给大使看的说明文字

  // 图片要求
  min_images: number                // 最少图片数，如 2
  max_images?: number               // 最多图片数（可选）

  // 存续时间
  min_duration_days: number         // 帖子最少保留天数，如 30
  duration_check_method: "screenshot" | "auto"

  // 平台要求
  required_platforms: string[]      // ["xiaohongshu","instagram","wechat"]
  platform_match: "any" | "all"     // 至少一个 or 全部发布

  // 自定义规则
  custom_rules: string[]            // ["需含#PR标签","须为本人账号"]
}
```

### 大使侧显示（任务详情页）

```
📋 コンテンツ要件 / Content Requirements

◦ キーワード
  以下のうち最低1つを含めてください：
  「可靠」「便宜」「快速」「サービスが良い」

◦ 写真
  実際の体験写真を2枚以上添付してください

◦ 投稿の存続
  投稿後30日間以上を公開状態で維持してください

◦ その他
  ・ご自身のアカウントからの投稿
  ・#PR タグを含めること
```

---

## 8. 类型B：审核流程

### 审核Checklist（根据ContentRequirements自动生成）

| 审核项 | 验证方式 | 初期实现 |
|--------|---------|---------|
| 平台符合要求 | 链接域名 / 截图平台标识 | 人工 |
| 图片数量 ≥ min_images | 提交文件数量统计 | 系统自动 |
| 关键词覆盖 | 查看帖子文字内容 | 人工 |
| 重复提交检测 | URL去重 + 图片MD5 hash | 系统自动 |
| 存续承诺 | 大使声明 + 30天后二次截图 | 声明+人工复查 |

### 存续时间核查机制

```
审核通过时记录 check_due_date = 提交日 + min_duration_days
  → 到期前3天系统通知大使："请提交帖子仍在线的截图"
  → 大使提交存续截图
  → 通过：existence_check.status = passed，无操作
  → 逾期未提交：existence_check.status = failed，扣回对应奖励
```

> ⚠️ 平台注意：小红书、Instagram对外严格，微信公众号无法外部访问。自动URL检测初期不可行，统一用截图方案。

---

## 9. 大使居住地与税务逻辑

**居住地是整个奖励和打款流程的第一个分叉点，注册时必须收集。**

```
ambassador.residence
│
├── "japan"        // 在日本居住
│     ├── 触发在职资格确认流程（见下）
│     ├── 打款方式：日本银行振込
│     └── 税单：支持调查申告书（年收 > ¥50,000）
│
└── "overseas"     // 人在海外
      ├── 跳过在职资格确认，不适用日本就管税约束
      ├── 打款方式：海外银行SWIFT/IBAN 或 Wise 或 PayPal
      └── 税单：由大使在居住国自行申报
```

### 在日大使（资格声明）任务申请前触发，一次性永久记录

大使须选择以下其中一项：
- 永住者 / 定住者 / 日本人配偶 → 无限制
- 就劳・人文知识・国际业务等 → 已获得资格外活动许可
- 留学生 → 已获得资格外活动许可（每周工作时间不超限）
- 其他（请说明）

大使签署声明（日期）：
> 「本人は上記の在職資格を保持しており、副業活動を得ることが法的に認められています。虚偽申告の場合、報酬は没収されます。」

系统记录：`declaration_content` + `declared_at`（时间戳）+ `ambassador_id`

> ⚠️ 关键设计原则：资格确认必须在任务开始前完成。即卡即关系一旦有的，事后修改不能消除平台法律风险（且可能引发卡单纠纷）。

---

## 10. 身份核验与银行账户收集

**收集时机：首次申请打款时强制触发，同步完成，不影响任务执行。**

```
Step 1：基本信息
  → 氏名（フリガナ含む）· 生年月日 · 住所

Step 2：在职资格（在日大使）/ 居住国选择（海外大使）

Step 3：本人确认证明文件
  → 在日：在留カード / パスポート / マイナンバーカード
  → 海外：パスポート

Step 4：打款账户信息
  → 在日：日本银行口座（银行名·支店コード·口座番号·名义カナ）
  → 海外：海外银行SWIFT/IBAN 或 Wise账号 或 PayPal

Step 5：マイナンバー（任意，仅在日大使）
  → 年间报酬超过¥50,000时用于支払调书申告

审核
  → 初期：人工审核
  → 通过：解锁打款功能
  → 拒绝：说明原因，可重新提交
```

**数据安全要求：**
- 银行账户、マイナンバー、证件图片全部加密存储
- 访问权限仅限财务/合规人员，一般运营人员不可见
- 保存期限7年（法定要求）

---

## 11. 结算与款项

### 打款流程

```
月末系统统计各大使当月成功件数
  → 未达门槛（< payout_threshold）：累计件数滚入下月
  → 达到门槛：生成打款指令
      → 在日大使：日本银行振込
      → 海外大使：Wise批量打款 / 国际电汇
  → 打款完成：Payout.status = "paid"，推送通知给大使
```

### 提现金额规格（2026-07-16 定稿）

| 项 | 值 | 事实源 |
|---|---|---|
| 最低提现金额 | **¥1,000（JPY）** | `platform_settings.withdrawal_min_amount`（唯一事实源） |
| 前端展示/校验 | 动态 | `GET /wallet/balance` 下发 `withdrawalMin`，提示文案与校验均用该值，不写死 |
| 服务端拦截 | `calcWithdrawalFee` | 低于最低额返回 `code: MIN_AMOUNT` |

> 改额度只需改 platform_settings 配置，三语提示/客户端校验/服务端拦截全部自动跟随，无需发版。

### 防重复与防刷单规则

| 规则 | 实现方式 |
|------|---------|
| 同一大使对同一任务只能提交一次（类型B） | `ambassador_id + task_id` 唯一约束 |
| 同一链接不能被不同大使提交 | URL标准化后唯一索引 |
| 截图去重 | 图片MD5 hash唯一索引 |
| 推广码不可自用 | 推广码所有人不可作为被推荐人 |
| 多账号注册检测 | 由商家侧（Remitly）负责，赫使平台信任商家数据 |

---

## 12. 数据模型

```typescript
// ─── 任务 ───
Task {
  task_id:               uuid
  merchant_id:           uuid
  title:                 string
  type:                  "referral" | "experience"
  status:                "open" | "full" | "closed"
  max_ambassadors:       number          // 任务容量上限
  current_count:         number          // 当前接受人数
  ambassador_reward:     Money           // { amount, currency }
  user_benefit:          string          // 显示给大使看的用户优惠描述
  payout_threshold:      number          // 首次结算最低件数
  payout_cycle:          "monthly"
  qualify_conditions:    QualifyConditions
  content_requirements:  ContentRequirements | null  // 仅类型B
}

// ─── 成功条件（类型A）───
QualifyConditions {
  kyc_required:          boolean
  first_transfer_min:    number | null   // 最低首次汇款金额
  custom_conditions:     string[]        // 其他自定义条件描述
}

// ─── 内容规范（类型B）───
ContentRequirements {
  required_keywords:     string[]
  keyword_match_type:    "any" | "all"
  keyword_note:          string
  min_images:            number
  max_images:            number | null
  min_duration_days:     number
  duration_check_method: "screenshot" | "auto"
  required_platforms:    string[]
  platform_match:        "any" | "all"
  custom_rules:          string[]
}

// ─── 大使接受记录 ───
AmbassadorTask {
  id:                    uuid
  ambassador_id:         uuid
  task_id:               uuid
  promo_code:            string | null   // 仅类型A，系统自动生成
  status:                "active" | "completed" | "suspended"
  applied_at:            timestamp
  declaration:           Declaration     // 资格声明记录
}

// ─── 资格声明 ───
Declaration {
  visa_type:             string          // 选择的在职资格类型
  declaration_text:      string          // 声明全文
  declared_at:           timestamp
  ambassador_id:         uuid
}

// ─── 推介记录（类型A专用）───
Referral {
  id:                    uuid
  ambassador_task_id:    uuid
  referred_user_token:   string          // 英文token，不存真实用户ID
  registered_at:         timestamp
  kyc_completed_at:      timestamp | null
  first_transfer_at:     timestamp | null
  first_transfer_amount: number | null
  qualified:             boolean         // 是否计入成功件数
}

// ─── 提交记录（类型B专用）───
TaskSubmission {
  id:                    uuid
  ambassador_task_id:    uuid
  submitted_at:          timestamp
  evidence:              Evidence[]
  checklist_results:     ChecklistItem[]
  status:                "pending" | "approved" | "rejected"
  reviewed_at:           timestamp | null
  reviewer_id:           uuid | null
  reject_reason:         string | null
  resubmit_count:        number          // 最多3次
  existence_check:       ExistenceCheck
}

// ─── 证据文件 ───
Evidence {
  type:                  "link" | "screenshot"
  content:               string          // URL 或 文件存储路径
  platform:              string          // "xiaohongshu" | "instagram" | "wechat" | ...
  submitted_at:          timestamp
  file_hash:             string | null   // 截图去重用MD5 hash
}

// ─── 存续核查 ───
ExistenceCheck {
  check_due_date:        date
  status:                "pending" | "passed" | "failed"
  checked_at:            timestamp | null
  screenshot_path:       string | null
}

// ─── 结算记录 ───
Payout {
  id:                    uuid
  ambassador_id:         uuid
  period:                string          // "2026-06"
  qualified_count:       number
  amount:                Money
  status:                "pending" | "paid"
  paid_at:               timestamp | null
  payment_method:        "jp_bank" | "wise" | "swift" | "paypal"
}

// ─── 大使身份 ───
Ambassador {
  id:                    uuid
  residence:             "japan" | "overseas"
  residence_country:     string          // ISO 3166-1 alpha-2
  kyc_status:            "pending" | "approved" | "rejected"
  bank_account:          BankAccount | null
  visa_type:             string | null   // 在日大使在职资格
  declaration:           Declaration | null
  created_at:            timestamp
}

// ─── 银行账户 ───
BankAccount {
  type:                  "jp_bank" | "overseas_swift" | "wise" | "paypal"
  // 日本银行
  bank_name:             string | null
  branch_code:           string | null
  account_number:        string | null
  account_name_kana:     string | null
  // 海外
  swift_code:            string | null
  iban:                  string | null
  wise_email:            string | null
  paypal_email:          string | null
}
```

---

## 13. 状态机

### AmbassadorTask.status
```
active ──→ completed    月末结算后任务到期
active ──→ suspended    违规 / 在职资格核验失败
```

### TaskSubmission.status（类型B）
```
pending ──→ approved    审核通过
pending ──→ rejected    审核拒绝（resubmit_count < 3 可重新提交）
rejected ──→ pending    大使修改后重新提交
```

### ExistenceCheck.status
```
pending ──→ passed      大使提交存续截图，审核通过
pending ──→ failed      逾期未提交 或 帖子已删除
failed  ──→ freeze      扣回对应奖励（纳入Payout处理逻辑）
```

### Payout.status
```
pending ──→ paid        打款完成
```

---

## 14. 开发优先级清单

### P0 — 上线前必须完成

| 模块 | 说明 |
|------|------|
| 居住地收集与分支逻辑 | 注册时必填，决定后续税务和打款流程 |
| 在职资格声明（在日大使） | 任务申请前触发，记录时间戳，生成存档 |
| CSV数据回传解析 | 类型A任务的唯一数据来源，含字段校验和错误日志 |
| 打款和KYC流程 | 身份核验 + 银行账户收集，同步表单 |
| 防重复提交逻辑 | URL去重 + 图片hash + ambassador/task唯一约束 |
| 任务容量控制 | max_ambassadors 达到后自动关闭接受 |

### P1 — 上线后尽快

| 模块 | 说明 |
|------|------|
| 存续时间二次截图机制 | 30天到期提醒 + 逾期扣回奖励 |
| 打款通知推送 | 结算事件 + 成功介绍事件实时通知 |
| 审核Checklist界面 | 运营人员逐项勾选，减少人工误差 |
| 大使进度看板 | 今日/本月统计 + 英文明细列表 |

### P2 — 规模后扩展

| 模块 | 说明 |
|------|------|
| Webhook自动对接 | 取代CSV，实现实时数据回传 |
| AI辅助内容审核 | OCR关键词识别 + 图片数量自动检测 |
| URL存活自动检测 | 定期抓取提交链接，检测帖子是否被删 |
| 支払调书自动生成 | 年末自动生成符合税单要求的报表 |

---

---

## 15. 社交平台体系与国际化架构

### 15.0 设计原则

不对任何单一平台（如微信）做硬编码特殊处理。所有平台通过**注册表配置**驱动行为，UI 和验证逻辑根据平台属性自动适配。扩展新平台只需在注册表增加一条记录。

---

### 15.0.1 平台注册表

```typescript
Platform {
  id:                 string      // "wechat" | "instagram" | "line" | "zalo" | "whatsapp" | ...
  name:               string      // 显示名称
  type:               "messaging" | "social" | "video" | "short_video"
  verification:       "url" | "screenshot" | "oauth"
  // url        → 输入主页链接，可抓取粉丝数
  // screenshot → 上传截图（微信/Zalo/WhatsApp 等封闭平台）
  // oauth      → 授权接入（Instagram/TikTok 未来支持）
  has_public_profile: boolean     // 是否有可公开查询的主页
  diaspora_groups:    string[]    // 推荐展示给哪些族裔群体
}
```

**初期注册表（可持续扩展）：**

| id | name | type | verification | 备注 |
|----|------|------|-------------|------|
| `wechat` | 微信 | messaging | screenshot | 封闭生态，截图验证 |
| `instagram` | Instagram | social | url | 公开主页，未来可 OAuth |
| `xiaohongshu` | 小红书 | social | url | |
| `tiktok` | TikTok | short_video | url | 未来可 OAuth |
| `line` | LINE | messaging | screenshot | 日本/东南亚常用 |
| `zalo` | Zalo | messaging | screenshot | 越南裔常用 |
| `whatsapp` | WhatsApp | messaging | screenshot | 印度裔/东南亚常用 |
| `facebook` | Facebook | social | url | |
| `youtube` | YouTube | video | url | |
| `twitter` | Twitter/X | social | url | |

---

### 15.0.2 族裔群体配置

```typescript
DiasporaGroup {
  id:            string      // "chinese" | "vietnamese" | "indian" | "korean" | ...
  label:         string      // 显示名称
  language:      string      // 默认语言（UI 已全量三语，见 15.9 多语言体系）
  currency:      string      // 主要结算货币
  tax_regime:    string      // 税务规则分支
  platforms:     string[]    // 推荐平台列表（按优先级排序）
}
```

**族裔 × 平台推荐矩阵：**

| 族裔 | 推荐平台（按优先级） |
|------|------------------|
| 华人 | wechat → xiaohongshu → instagram → tiktok |
| 越南裔 | zalo → facebook → tiktok |
| 印度裔 | whatsapp → instagram → youtube → facebook |
| 日韩 | line → instagram → twitter |

赫使选择 `diaspora_group` 后，平台填写界面优先展示推荐平台，但不限制选择其他平台。

---

### 15.0.3 赫使社交账号数据结构

存储于 `herald_profiles.social_platforms`（JSON 数组）：

```typescript
HeraldSocialAccount {
  platform:       string      // Platform.id
  handle:         string | null   // 用户名 / ID
  url:            string | null   // 主页链接（url 验证方式）
  followers:      number | null   // 粉丝数（自填或抓取）
  screenshot_url: string | null   // 截图路径（screenshot 验证方式）
  verified:       boolean         // 运营人工标记是否已核验
  added_at:       timestamp
}
```

---

### 15.0.4 任务平台要求配置

存储于 `tasks.platform_requirements`（JSON 数组）：

```typescript
TaskPlatformRequirement {
  platform:      string      // Platform.id
  required:      boolean     // true = 硬性门槛，false = 加分项
  min_followers: number | null
}
```

**任务发布时**，商家在「平台要求」区块添加平台并标注必须/可选：

```
平台要求：
● 微信（必须）— 最低粉丝：不限
○ Instagram（可选）— 最低粉丝：1000
○ 小红书（可选）— 最低粉丝：不限
```

**满足模式**（2026-07-17，`tasks.req_mode` + `req_min_count`，≥2 项时创建表单显示选择）：
- `ALL`（默认，即上述现行为）：required=true 的项全部必须满足，required=false 仅作加分展示
- `ANY_N`：列出的**所有**项都算候选，满足其中任意 `req_min_count` 项即可报名；此模式下忽略单项"必须"标志（创建 UI 隐藏该勾选框）。服务端校验 403 响应带 `reqMode/needCount/satisfiedCount`，赫使端预检面板显示"满足任意 N 项即可报名（当前满足 C 项）"

---

### 15.0.5 报名时的验证逻辑

```
赫使点击「报名」
  → 检查 required 平台
    ├── 档案里已有 → 直接带入，一键报名
    └── 档案里没有 → 提示补填 → 填完自动存档 → 再报名

  → 可选平台
    → 展示「补充以下平台可提升被选中概率」

  → 粉丝数门槛
    → 低于 min_followers → 提示不满足要求（软警告，不硬性拦截，1.0）
```

**1.0 阶段**：粉丝数自填不验证，运营人工核查。平台账号填一次后存入档案，后续报名同类任务自动复用。

---

### 15.0.6 收集时机

| 信息 | 入驻时 | 报名时 |
|------|--------|--------|
| 微信 ID | 必填 | — |
| 主要平台账号（1个） | 选填 | — |
| 任务要求的平台账号 | — | 按需补填，自动存档 |
| 截图（messaging 类平台） | — | 按需提交 |

**渐进式档案**：赫使档案随报名任务逐步完善，不在入驻阶段前置收集所有信息。

---

### 15.9 多语言体系（2026-07-16 已上线）

赫使端全量支持 **中文 / 日本語 / English** 三语：

- **词条体系**：416 词条 × 3 语存 `i18n_entries(key, locale, value, context)`，key 与语义背景（context）由代码 seed 管理，
  运营在 admin「🌐 本地化」矩阵只改译文，不建 key；运营改动永不被 seed 覆盖（`updated_by` 保护）
- **前端 runtime**：四级兜底（远端词条→打包当前语言→打包中文→key），版本化缓存 + ETag/304；
  语言自动检测（系统语言）+ profile 页手动切换；tabBar 文字运行时更新
- **后端错误**：19 处赫使可见错误带 `code`，前端 `error.<code>` 词条按用户语言渲染，无词条退回后端中文
- **通知**：审核通知 metadata 带 `taskTitle/note`，前端按 `notif.<type>.*` 词条 + 参数渲染三语；
  落库中文 title/body 仅作旧客户端兜底
- **内容策略**：任务标题/描述等 UGC 保持原文不机翻；分类 label 多语言列为后续项
- **待办**：ja/en 译文为机翻初稿需人工审（尤其日语敬语与法律声明）；流水标签（ENTRY_TYPE_LABELS）仍为后端中文，待前端化

## 16. 系统实现记录（2026-05-30）

> 本节记录实际开发过程中的架构决策与实现细节，供后续开发参考。

---

### 15.1 多端架构

| 文件/目录 | 角色 | 说明 |
|------|------|------|
| `herix-miniapp/` | 赫使端（C端） | **Taro(React) 一套代码双端编译**：微信小程序(weapp) + 网页(H5)。底部4tab（探索/任务/消息/我的），11个页面，桌面浏览器有响应式布局（≥768px 两列/侧栏） |
| `merchant.html` | 品牌商家端（B端） | PC 优先，侧边栏导航，任务管理/审核/数据（纯 HTML 无构建） |
| `admin.html` | 平台运营端 | PC，侧边栏导航，审核/结算/用户管理/**本地化词条矩阵**（纯 HTML 无构建） |
| `herix-server/` | 后端 API | Express + **PostgreSQL**，三端共用同一套 REST API |

> 2026-07 变更：赫使端旧载体 `preview.html`（已删除）与 `herix.html`（保留待退役）已由 `herix-miniapp` 全量取代；
> 文中历史章节提及 preview.html 处均指现赫使端小程序对应页面。品牌端/管理端仍为纯 HTML。

---

### 15.2 多角色账号体系

**设计原则（参考 Airbnb/Fiverr 模式）：**
- 一个邮箱一个账号，账号可拥有多个角色
- `users.role` = 主角色（向后兼容）
- `users.roles` = JSON 数组，如 `["HERALD","BRAND"]`
- JWT token 同时携带 `role` 和 `roles`，API 层用 `roles` 做权限判断

**开通第二角色：**
- `POST /api/users/add-role` — 返回新 token，前端更新 `state.token`
- preview.html「我的」页面可开通第二角色
- merchant.html 登录时若只有 HERALD 角色，直接引导两步开通流程

**自我交易防护：**
- `POST /api/applications/:taskId` 报名时检查 `task.creator_id !== herald.id`，同一用户不能报名自己发布的任务

---

### 15.3 推广码（邀请码）系统

**核心设计原则：**
> 推广码必须在任务创建时就全部生成，不能等赫使报名后再生成。原因：Remitly 等第三方系统需要提前录入推广码才能识别。

**正确业务流程（类型A任务）：**
```
商家创建任务（N份名额）
  → 系统立即生成 N 个推广码存入 task_promo_codes 表
  → 商家下载 CSV（含全部推广码）
  → 商家将推广码上传到 Remitly 等第三方系统
  → 商家发布任务

赫使报名 → 商家审核通过
  → 系统从 task_promo_codes 码池取一个空闲码
  → 创建 ambassador_tasks 记录，赫使立即看到推广码
  → 无需赫使手动"领取"
```

**两种码来源模式：**

| 模式 | `code_mode` | 说明 |
|------|-------------|------|
| 平台自动生成 | `auto` | 创建任务时生成 `HERIX-XXXXXX` 格式推广码 |
| 商家自定义上传 | `custom` | 商家通过草稿页上传自有码（如 Remitly 系统码） |

自定义上传模式下，码未上传完成前发布按钮禁用。

**关键数据表：**
- `task_promo_codes`：码池（含已分配/未分配状态，`herald_id IS NULL` = 可用）
- `ambassador_tasks`：赫使与推广码的绑定关系

**CSV 导出：**`GET /api/tasks/:id/codes/export`
- 任务创建后即可下载（含未分配的码）
- 字段：`promo_code, status, herald_name, herald_email, country, residence, assigned_at, total_referrals, qualified_count`

---

### 15.4 入驻流程

**赫使入驻（3步向导）：**
1. 居住地选择（japan / overseas）
2. 在日本：在留资格声明 + 同意书面确认；海外：打款方式选择
3. 完成

**品牌商家入驻（3步向导）：**
1. **方案选择**：展示 Launch / Scale / Alliance 三档定价对比（见 22.1）
   - 选择 **Launch** → 继续自助向导（步骤2→3）
   - 选择 **Scale / Alliance** → 显示销售联系引导页（留下联系方式，由销售团队跟进线下签约）；向导终止，账号进入「待激活」状态，由运营后台人工开通
2. 品牌信息（公司名、行业、官网）
3. 联系方式（联系人、电话、简介）

入驻状态存储：
- `herald_profiles.is_onboarded` / `brand_profiles.is_onboarded`
- 登录响应携带 `is_onboarded`，未完成入驻时前端自动触发向导

---

### 15.5 邮件通知

使用 nodemailer，配置 `SMTP_USER` / `SMTP_PASS` 环境变量启用；未配置时打印到控制台。

触发节点：
- 赫使报名被通过/拒绝
- 内容提交审核通过/拒绝
- 在留声明审核通过/拒绝
- 打款完成

---

### 15.6 关键 API 设计注意事项

**路由顺序问题（已踩坑）：**
> Express 路由按注册顺序匹配。`GET /tasks/my/stats` 必须注册在 `GET /tasks/:id` 之前，否则 `my` 会被当成任务 ID 匹配到 `/:id` 路由。

所有精确路径（`/my/stats`、`/my/codes` 等）必须在通配路由（`/:id`）之前注册。

**optionalAuth 中间件：**
`GET /api/tasks`（任务列表）使用 `optionalAuth`：
- 已登录：返回所有状态的任务（含 DRAFT）
- 未登录：只返回 OPEN 状态的任务

**requireRole 多角色支持：**
```typescript
// 检查 req.user.roles 数组，任一角色匹配即通过
const userRoles = req.user.roles || [req.user.role];
if (!roles.some(r => userRoles.includes(r))) return 403;
```

---

### 15.7 结算管理

- 运营后台可生成月度账单：`POST /api/admin/payouts/generate`
- 按赫使汇总已审核通过的提交记录，计算应付金额
- 支持标记已付款：`POST /api/admin/payouts/:id/mark-paid`，同时触发邮件通知

---

### 15.8 测试账号

| 角色 | 邮箱 | 密码 | 说明 |
|------|------|------|------|
| 平台运营 | admin@herix.com | 123456 | 访问 admin.html |
| 品牌商家 | brand@demo.com | 123456 | 访问 merchant.html，11个示例任务 |
| 赫使 | herald@demo.com | 123456 | 访问 preview.html |

启动命令：`bash /Users/gabrielg/Herix/start.sh`
- 后端：`http://localhost:3004`
- 前端预览：`http://localhost:3002`

---

---

### 15.9 前端常见陷阱（已踩坑）

**1. `<tr onclick>` 不可靠**
表格行绑定 onclick 属性在某些浏览器/场景下不触发。统一改用两种方式并存：
- 每行末尾加显式「查看」按钮（`<button onclick="openTask(id)">`）
- `bindPage()` 里对表格容器用事件代理（`closest('tr[data-task-id]')`）

**2. 异步 XHR 与 render 竞态**
- 不要在 nav 切换页面时清空 `state.tasks = []`，会导致 XHR 回来之前一直显示空
- `loadMyTasks` 的 XHR 回调应检查 `d && d.tasks` 再更新，不能直接 `state.tasks = d.tasks || []`（d 为 {} 时会清空）
- 后台 XHR 正在运行时，用户点击其他操作会产生竞态，`render()` 应基于当前 `state.page` 渲染，不应在 XHR 回调里假设页面状态

**3. Express 路由顺序**
所有精确路径（`/my/stats`、`/my/codes`）必须注册在通配路径（`/:id`）之前，否则精确路径的字段会被当作 ID 参数解析，返回 404。

当前正确顺序：
```
GET /            → 任务列表（optionalAuth）
GET /my/stats    → 我的任务统计（requireAuth）
GET /:id         → 任务详情（公开）
GET /:id/codes   → 推广码池（requireAuth + BRAND）
```

**4. `state.user.roles` 与 token 同步**
- 开通第二角色后 `add-role` 接口返回新 token，前端必须立即用 `state.token = d.token` 更新
- 旧 token（仅含 `role` 字段）在 `requireAuth` 中间件会自动补 `roles = [role]`，保证向后兼容
- `requireRole` 中间件检查 `req.user.roles` 数组，而非单一 `req.user.role`

---

*文档结束 · Herix Ambassador PRD v1.2 + 实现记录 2026-05-31*


---

## 16. 2026-05-31 变更记录

### 16.1 数据库迁移：SQLite → PostgreSQL

项目从 SQLite（`better-sqlite3`）完全迁移到 PostgreSQL（`pg`）。

**改动范围：**
- `src/db.ts` — 删除模块级 `initDatabase()` 自动调用，避免与 `index.ts` 中的调用冲突导致（时为 Render）部署时报 `duplicate key violates unique constraint "pg_class_relname_nsp_index"`
- 所有 SQL 通过 `src/utils/db.ts` 中的 `toPgSql()` 将 `?` 占位符自动转换为 `$N` 格式
- `initDatabase()` 仅在 `index.ts` 中通过 `await` 调用一次

**本地环境：**
- PostgreSQL 16 via Homebrew，数据库 `herix`
- 配置文件 `.env` 改为 `DATABASE_URL=postgres://localhost:5432/herix`
- 本地 launchd 服务（`com.herix.server`）管理进程，崩溃自动重启

### 16.2 PostgreSQL 兼容性修复

**COUNT(*) 类型问题：**
- PostgreSQL 中 `COUNT(*)` 返回 `bigint`，`pg` 驱动返回字符串
- 在 JavaScript 的 `reduce()` 中字符串相加导致 `merchant.html` 品牌统计面板显示 "02111001" 等乱码
- 修复：所有 `COUNT(*)` 改为 `COUNT(*)::int`，强制返回整数

**date() 函数问题：**
- `src/routes/wallet.ts` 中的 `date('now', 'start of month')` 是 SQLite 专有函数
- 修复：改为 `TO_CHAR(DATE_TRUNC('month', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS')`

### 16.3 自动种子数据

**启动时自动检测：**
- `src/seed.ts` — `seedIfEmpty()` 函数检测 `users` 表是否为空
- 空库时自动创建 4 个用户、11 个任务、7 条申请记录、2 条推广码、4 条资金记录
- ~~Render 首次部署时完全自动化~~（Render 已于 2026-07-16 弃用；seedIfEmpty 亦已删除）

**手动重灌脚本：**
- `seed-db.ts` — 独立种子脚本，先清空所有表再重新填充
- ~~Render Shell 执行~~（Render 已弃用；该脚本亦已随旧 schema 作废）
- 不需要删除 PostgreSQL 实例

### 16.4 成果报酬任务流程修正

**问题：** `preview.html` 中对 PERFORMANCE 任务（成果报酬）显示了 "领取推广码" 按钮，允许赫使直接跳过报名和审核流程领取推广码。

**修正为统一流程：**
- 所有任务类型（STANDARD / PERFORMANCE）都显示 "立即报名" 按钮
- 商家审核通过后，PERFORMANCE 任务由系统从码池自动分配推广码
- Alice 的 "已完成" vs "已通过" 状态区分：APPROVED + 已有通过提交 = 显示 "已完成"

### 16.5 种子数据补全

**新增字段：**
- 所有 11 个任务补全 `cover_image`（Unsplash 图片链接）
- 所有任务补全 `category`（beauty / baby / food / experience / lifestyle / referral）
- 所有任务补全 `content_type`（photo / referral）
- 所有任务补全 `difficulty`（easy / medium / hard）

**新增测试数据：**
- Gabriel（HERALD+BRAND）发布 4 个品牌任务
- Alice 新增 APPROVED 申请：Remitly 品牌大使 + 母婴产品体验
- Alice 新增 PENDING 申请：熊猫外卖拉新大使
- Gabriel 新增使用：口红新品测评 APPROVED、Remitly APPROVED（含推广码）
- 双方均有 Remitly 推广码（`ambassador_tasks`）

### 16.6 前端修复

**preview.html：**
- 删除 "领取推广码" 按钮（第 348 行），统一为 "立即报名"
- "已完成" 筛选逻辑修正：仅包含 APPROVED + 已有提交记录的任务
- 报名历史中 "已通过" 与 "已完成" 状态根据提交记录自动区分

**merchant.html：**
- 品牌统计面板数字显示正常（`COUNT(*)::int` 修复后）

**小程序 H5 构建：**
- `config/index.js` 中 `publicPath` 和 API 代理端口更新为 4005（2026-07-17 由 3005 迁移，避开 MT5 Agent 端口段）
- `src/utils/api.ts` 中 `BASE_URL` 改为相对路径 `/api`（适配任意同源部署）
- 首页从占位符重写为带"我的待办"标签页的任务列表

### 16.7 部署（2026-07-16 更新：Render 已弃用）

原 Render 方案（render.yaml、onrender.com 域名、render-* npm scripts）已全部删除。

当前状态：
- **开发**：Mac 本地 herix-server（:4005）+ ECS PostgreSQL（SSH 隧道）
- **生产**：部署方案待定，定稿后更新本节

任何新环境部署 checklist：设置 `DATABASE_URL` → 启动即自动建表/迁移（幂等）→ 跑 `scripts/seed-i18n.ts` 灌三语词条 → 验证 `/api/i18n/zh` 有数据。


### 16.8 测试账号（更新）

| 账号 | 密码 | 角色 | 数据内容 |
|------|------|------|----------|
| `admin@herix.com` | 123456 | 管理员 | 访问管理后台 |
| `brand@d.com` | 123456 | 品牌商家 | 周大福珠宝，7个任务（含2个 PERFOMANCE） |
| `alice@d.com` | 123456 | 赫使 | 已报名4个任务（2个APPROVED，1个已完成，1个PENDING） |
| `gabrielgong2019@outlook.com` | 123456 | 赫使+品牌 | 双角色，3个赫使申请 + 4个品牌任务 |

**测试地址：** ~~onrender.com 各端地址~~（Render 已弃用；本地开发统一 `http://localhost:3005`，生产地址待部署方案定稿）

---

## 17. 赫使成长体系（2026-06-09 新增）

### 17.1 战略方向

**以赫使为中心，赫使成长是平台的北极星指标。**

平台定位从"任务撮合平台"升级为"海外华人创作者成长基础设施"。赫使在平台上成长，平台就有了真正的护城河。

```
赫使加入
  ↓ 完成任务 → 积累评级
  ↓ 成长工具 → 提升粉丝
  ↓ 升级段位 → 接更高价任务
  ↓ 更多收入 → 付费使用工具
  ↓ 深度依赖 → 不会离开
```

---

### 17.2 段位体系（Tier）

**定义**：基于粉丝数量，衡量赫使的影响力规模。按平台分别计算，不合并统计（合并仅用于档案展示参考）。

| 段位 | 粉丝数 | 说明 |
|------|-------|------|
| **Nano** | < 1,000 | 入门级，垂直社群影响力 |
| **Micro** | 1,000 - 10,000 | 主流段位，性价比最高 |
| **Mid** | 10,000 - 100,000 | 有一定影响力 |
| **Macro** | 100,000+ | 头部，议价空间大 |

**规则：**
- 段位按赫使填写的各平台粉丝数自动计算
- 同一赫使在不同平台可能属于不同段位
- 报名任务时，系统自动校验该平台的段位是否符合任务要求
- 粉丝数更新后段位实时变化

---

### 17.3 评级体系（Rating）

**定义**：基于任务执行质量，衡量赫使的可靠性和专业度。全平台统一一个评级，与粉丝数无关。

| 评级 | 标签 | 解锁条件 |
|------|------|---------|
| 未评级 | — | 完成任务 < 3 单 |
| ⭐ Bronze | 新手 | 完成 3 单，好评率 ≥ 60% |
| ⭐⭐ Silver | 稳定 | 完成 10 单，好评率 ≥ 75% |
| ⭐⭐⭐ Gold | 优质 | 完成 25 单，好评率 ≥ 85% |
| ⭐⭐⭐⭐ Platinum | 顶级 | 完成 50 单，好评率 ≥ 95% |

**评分来源：**
- 品牌方对每次任务评 1-5 星（审核通过后触发）
- 好评率 = 4星及以上 / 总评价数
- 超时未提交、被拒次数过多会拉低好评率

---

### 17.4 档案展示

**报名时品牌可查看完整档案：**

```
赫使档案
┌──────────────────────────────────┐
│ 昵称 · 居住地 · 族裔背景          │
│                                   │
│ 评级：⭐⭐⭐ Gold  完成 28 单       │
│ 好评率：91%                       │
│                                   │
│ 社交账号                           │
│  📕 小红书  Micro  · 6,800 粉     │
│  🎵 TikTok  Nano   · 450 粉      │
│  🌐 全网参考：约 7,250 粉          │
│                                   │
│ 代表作品（最近3条，系统自动沉淀）   │
│  · [小红书] Remitly 推广笔记 ✓    │
│  · [小红书] 珠宝体验测评 ✓        │
│  · [TikTok] 美食探店视频 ✓        │
└──────────────────────────────────┘
```

---

### 17.5 作品集自动沉淀

任务内容审核通过后 → **自动添加到赫使档案的代表作品**，无需赫使手动维护。

- 最多保留最近 10 条
- 显示：平台、任务标题、完成时间
- 品牌方报名审核时可点击查看原链接
- 赫使可手动设置是否公开某条作品

---

### 17.6 成长路径可视化

在赫使 Dashboard 显示当前段位和下一级别的距离：

```
你目前：Micro 段位（小红书 6,800 粉）
距离 Mid：还差 3,200 粉

任务评级：⭐⭐⭐ Gold（28 单完成）
距离 Platinum：还差 22 单，好评率需保持 95%+
```

---

### 17.7 品牌复购机制

品牌方对某位赫使满意后，可直接发出"再次合作邀请"：

- 入口：任务审核通过页面 / 赫使档案页
- 流程：品牌选定任务 → 直接发邀约 → 赫使接受 → 跳过公开报名
- 对赫使：高评级赫使可获得稳定的直接邀约收入
- 对品牌：省去重新筛选的时间成本

---

## 18. 定价矩阵（2026-06-09 新增）

### 18.1 定价维度

任务报酬由**两个维度**决定：
1. **平台**：不同平台内容制作成本和受众价值不同
2. **段位**：赫使粉丝规模决定基础报价范围

### 18.2 参考定价表（人民币/篇，含平台服务费）

| | Nano <1K | Micro 1K-1万 | Mid 1万-10万 | Macro 10万+ |
|--|---------|------------|------------|-----------|
| **YouTube / B站** | ¥200-400 | ¥400-1,000 | ¥1,000-5,000 | 议价 |
| **小红书** | ¥80-150 | ¥150-500 | ¥500-2,000 | 议价 |
| **Instagram** | ¥100-200 | ¥200-600 | ¥600-2,500 | 议价 |
| **TikTok** | ¥80-150 | ¥150-400 | ¥400-1,500 | 议价 |
| **微信** | ¥50-100 | ¥100-300 | ¥300-800 | 议价 |

### 18.3 产品实现

- 商家创建任务时选择目标平台 → 系统显示该平台的建议报酬范围
- 商家在范围内设定具体金额（可高于建议值，不可低于最低值）
- 赫使报名时系统校验：平台段位是否达标

### 18.4 平台服务费模型（透明抽佣）

```
品牌支付总额 = 赫使报酬 + 平台服务费（约 15-20%）
赫使看到：自己的报酬（透明）
品牌看到：含服务费的总价（透明）
```

平台不赚信息差，靠效率和规模赚服务费，是与 PR 公司的核心竞争差异。

---

## 19. 产品路线图（2026-06-09 新增）

### 一期（当前 → MVP 完整）

| 功能 | 说明 | 优先级 |
|------|------|-------|
| **定向任务** | 私密发给指定赫使，广告代理核心用途（见第24节）| P0 |
| 资金链（充值+托管+打款）| 商家充值、发布锁定、审核通过记账、赫使提现 | P0 |
| 全流程 UI 验证 | 充值/任务/提交/结算前端跑通 | P0 |
| KYC / 在留资格审核 | 运营后台完整审核流程 | P1 |
| 品牌入驻方案选择 | Launch/Scale/Alliance 向导第一步 | P1 |
| 报名档案展示 | 品牌审核时可查看赫使完整档案 | P1 |
| 评级 + 段位体系 | 按本文档 17.2/17.3 实现 | P1 |
| 作品集自动沉淀 | 审核通过自动入档 | P2 |
| 成长路径可视化 | Dashboard 显示段位进度 | P2 |
| 品牌复购机制 | 直接邀约已合作赫使（可用定向任务代替）| P3 |
| 定价矩阵引导 | 创建任务时显示建议报酬范围 | P3 |

### 二期（工具化）

| 功能 | 说明 |
|------|------|
| AI 内容辅助 | 输入任务简报 → 生成各平台适配文案（接 Claude API）|
| 培训内容库 | 小红书种草文、TikTok 脚本、IG 图文制作教程 |
| 税务计算器 | 日本副业收入申报指引 |
| 品牌评价库 | 哪些品牌好合作（付费用户可见）|

### 三期（创作者成长平台）

| 功能 | 说明 |
|------|------|
| 赫使付费订阅 | Pro 版解锁全部工具（¥99-299/月）|
| 个人媒体资料包 | 一键生成专业赫使简介（发给品牌用）|
| 品牌主动发现模式 | 品牌浏览赫使库，按社群/平台/段位筛选，主动发邀约 |
| 汇款服务（MSO 牌照后）| 赫使跨境收款一站式解决 |

---

## 20. 数据库架构（2026-06-11）

### 20.1 设计原则

遵循以下 7 条原则（db-design-review 标准）：

| 原则 | 要求 |
|------|------|
| 业务发生源写入 | 每个业务事件立即写 DB，禁止延迟写入 |
| 软删除 | 业务记录不物理删除，用 status/closed_at 标记 |
| 唯一 Key 关联 | 跨表关联只用 PK/FK，禁止字符串匹配 |
| 适当冗余 | 历史记录允许冗余字段，避免 join 失去历史语义 |
| 避免结构重复 | 80%+ 字段相同的表合并，加 status 区分 |
| 全链路可追踪 | 每笔资金的完整生命周期可从 DB 重建 |
| 历史独立查询 | 历史记录表不依赖 join 可独立返回完整信息 |

---

### 20.2 表结构总览（16张表）

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `users` | 用户主表，多角色 | roles TEXT（JSON 数组）|
| `brand_profiles` | 品牌档案 | user_id FK |
| `herald_profiles` | 赫使档案 | tier_snapshot, social_platforms_updated_at |
| `tasks` | 任务主表 | status, escrow_amount, is_escrowed |
| `task_applications` | 报名记录 | status: PENDING/APPROVED/REJECTED/WITHDRAWN |
| `task_submissions` | 提交内容 | status, commission_amount（金额快照）|
| `task_ratings` | 品牌评分 | score 1-5 |
| `task_promo_codes` | 推广码池 | task_id, herald_id |
| `ambassador_tasks` | 推广码任务参与记录 | unique_code |
| `referrals` | 推荐转化记录 | qualified |
| `transactions` | 资金流水总账 | type, status, reference_type, reference_id |
| `topup_requests` | 品牌充值申请 | brand_id, status: pending/confirmed/rejected |
| `withdrawal_requests` | 赫使提现申请 | herald_id, status: pending/processing/paid/failed |
| `withdrawal_methods` | 赫使收款方式 | type: BANK/ALIPAY/WECHAT/WISE |
| `payouts` | 推广码绩效结算 | period, qualified_count |
| `declarations` | 在留资格声明（日本）| visa_type, status |

---

### 20.3 资金全链路事件追踪

所有资金事件均写入 `transactions` 表，完整生命周期可重建：

```
① 品牌充值申请（topup_requests: pending）
    ↓ 管理员确认
② 充值到账（transactions: ESCROW_DEPOSIT COMPLETED）
    ↓ 品牌发布任务
③ 资金锁定（transactions: ESCROW_DEPOSIT PENDING，reference_type='task_publish'）
    ↓ 赫使提交 → 品牌审核通过
④ 报酬发放（transactions: ESCROW_RELEASE COMPLETED）
⑤ 平台服务费（transactions: PLATFORM_FEE COMPLETED）
    ↓ 任务关闭
⑥ 未使用退款（transactions: ESCROW_REFUND COMPLETED，reference_type='task_complete'）
    ↓ 赫使申请提现
⑦ 提现预占（transactions: WITHDRAWAL PENDING）
    ↓ 管理员确认打款
⑧ 提现完成（transactions: WITHDRAWAL COMPLETED）
```

---

### 20.4 transactions 类型定义

| type | 含义 | user_id | from_user_id |
|------|------|---------|-------------|
| ESCROW_DEPOSIT | 充值到账 / 发布锁定 | 品牌 | NULL |
| ESCROW_RELEASE | 报酬发放给赫使 | 赫使 | 品牌 |
| ESCROW_REFUND | 任务结束退还锁定余额 | 品牌 | NULL |
| PLATFORM_FEE | 平台服务费（15%）| 品牌 | 品牌 |
| WITHDRAWAL | 赫使提现 | 赫使 | NULL |

---

### 20.5 已知设计权衡

| 问题 | 决策 | 原因 |
|------|------|------|
| `payouts` 与 `transactions` 功能重叠 | 保留两表 | payouts 服务推广码绩效结算（按期），transactions 服务内容任务结算（按单），语义不同 |
| 无统一 `deleted_at` 软删除 | 用 status 字段代替 | 业务实体（任务/赫使）通过状态流转管理，无需物理删除 |
| `herald_profiles.tier_snapshot` 非实时 | 更新档案时重算 | 段位以社交账号数据为准，实时计算成本低 |

---

### 20.6 关键索引清单

```sql
-- 核心查询索引
idx_transactions_user        (user_id)         -- 赫使余额计算
idx_transactions_from_user   (from_user_id)    -- 品牌余额计算
idx_transactions_type        (type)            -- 按类型筛选流水
idx_task_ratings_herald      (herald_id)       -- 评级聚合查询
idx_topup_requests_brand     (brand_id)        -- 品牌充值记录
idx_topup_requests_status    (status)          -- 管理员待确认列表
idx_withdrawal_requests_herald (herald_id)     -- 赫使提现记录
idx_withdrawal_requests_status (status)        -- 管理员待打款列表
idx_submissions_status       (status)          -- 待审核提交列表
idx_declarations_user        (user_id)         -- 声明查询
idx_wallet_entries_wallet    (wallet_id)       -- 钱包流水查询
idx_wallet_entries_type      (type)            -- 按类型筛流水
idx_wallet_entries_ref       (reference_type, reference_id) -- 关联查询
idx_wallets_user             (user_id, wallet_type)         -- 余额查询
idx_task_txn_task            (task_id)         -- 任务业务事件
idx_task_txn_from            (from_user_id)    -- 品牌侧业务查询
idx_task_txn_to              (to_user_id)      -- 赫使侧业务查询
```

---

## 21. 钱包架构（2026-06-12）

### 21.1 核心设计决策

钱包与业务事件**完全分离**，参考支付宝/微信支付/PayPal 设计经验：

| 原则 | 实现 |
|------|------|
| **幂等性**（PayPal 教训）| `idempotency_key UNIQUE`，重复调用返回相同结果，防止重复扣款 |
| **原子性**（支付宝做法）| `BEGIN/COMMIT`，余额更新与流水写入在同一 DB transaction |
| **不可变**（账本原则）| `wallet_entries` 只追加，永不修改，撤销用对冲记录 |
| **余额快照**（微信做法）| 每条流水存 `available_after / frozen_after`，O(1) 查询无需重算历史 |
| **显式货币**（早期微信坑）| 所有操作必须传 `currency`，默认 JPY，为多币种预留 |
| **冻结/可用分离**（支付宝做法）| `available_balance + frozen_balance`，任务锁定走冻结，不影响可用 |

### 21.2 双账本架构

```
task_transactions（任务业务事件）   wallet_entries（钱包流水）
───────────────────────────────     ──────────────────────────
记录"发生了什么业务"                记录"每个账户的资金变动"
必须有 task_id                      user_id + wallet_type 区分

TASK_LOCK    任务发布锁定            TOPUP              品牌充值入账
TASK_RELEASE 报酬发放               TASK_FREEZE        发布：可用→冻结
PLATFORM_FEE 平台服务费             TASK_UNFREEZE      退款：冻结→可用
TASK_REFUND  任务退款               TASK_SETTLE        结算：冻结清零
                                    TASK_CREDIT        赫使收入
                                    PLATFORM_FEE       平台服务费
                                    WITHDRAWAL_FREEZE  提现：可用→冻结
                                    WITHDRAWAL_DEBIT   提现完成：冻结清零
                                    WITHDRAWAL_UNFREEZE 提现取消：冻结→可用
                                    ADJUSTMENT         人工调整
```

### 21.3 一笔任务完成的完整分录

品牌任务 ¥10,000，赫使实得 ¥8,500，平台费 ¥1,500（15%）：

```
task_transactions:
  TASK_RELEASE | task_id=T1 | task_amount=10,000 | amount=8,500 | platform_fee=1,500

wallet_entries（三笔，幂等 key 各不同）：
  brand   | TASK_SETTLE  | amount=+10,000→frozen-10,000 | idempotency=SETTLE:{txn_id}
  herald  | TASK_CREDIT  | amount=+8,500                | idempotency=CREDIT:{txn_id}
  platform| PLATFORM_FEE | amount=+1,500                | idempotency=FEE:{txn_id}

借贷验证：10,000 = 8,500 + 1,500 ✓
```

### 21.4 钱包类型扩展性

```
wallet_type 当前值：'brand' | 'herald' | 'platform'

将来无需改表结构即可扩展：
  'partner'   合作伙伴账户
  'bonus'     赫使奖励积分账户
  'referral'  推荐奖励账户
```

### 21.5 推广码任务统一资金链（2026-06-12）

PERFORMANCE（推广码）任务与 STANDARD（内容）任务现在走完全相同的账本逻辑：

```
每次 CSV 上传，新增转化 delta 笔：
  → 写 task_transactions(TASK_RELEASE)
  → settleTask()    品牌冻结 -= delta × commission
  → creditHerald()  赫使可用 += delta × payout
  → creditPlatformFee() 平台 += delta × fee

paid_conversions 字段防止重复计费（每次上传只付增量）
```

`payouts` 表已完全废弃并删除。

### 21.6 充值 UI（4步向导，2026-06-12）

merchant.html 充值页重构为类支付宝/微信的 4 步流程：

```
Step 1 选择金额 → 快选按钮（¥1K/3K/5K/10K/30K/50K）+ 自定义
Step 2 支付方式 → 銀行振込（可用）/ 微信支付（预留）
Step 3 付款详情 → 收款账户 + 参考编号（高亮可复制）+ 信任标志
Step 4 完成确认 → 参考编号卡片 + 预计到账时间
```

参考编号格式：`HERIX-YYYYMMDD-XXXX`，用于对账识别。

---

## 22. 品牌结算分层与素材体系（2026-06-14 新增）

### 22.1 定价方案（Pricing Plans）

品牌方在入驻时选择以下三档方案，方案决定抽成比例与结算模式：

| | **Launch** | **Scale** | **Alliance** |
|---|---|---|---|
| **定位** | 按次快速启动，适合试用期或低频投放 | 规模化持续运营，适合高频投放品牌 | 深度战略合作，定制服务 |
| **平台抽成** | 任务预算的 **25%** | 任务预算的 **8%** | 合同约定 |
| **月额固定費** | 无 | **¥300,000 / 月** | 合同约定 |
| **入驻路径** | 自助 onboarding 向导 | 销售线下签约，运营后台人工开通 | 销售线下签约，运营后台人工开通 |
| **充值方式** | 银行转账预充值钱包 | 授信额度，月末批量结算（NET30） | 授信额度，月末批量结算（NET30） |
| **钱包余额** | 必须 ≥ 0 | 在授信额度内可为负 | 在授信额度内可为负 |
| **财务单据** | 請求書（充值申请）+ 領収書（到账确认） | 月结請求書（消費汇总） | 月结請求書（消費汇总） |
| **品牌素材** | 选填 | 签约时由销售收集（见 22.4） | 签约时由销售收集（见 22.4） |

> **方案切换参考**：月任务预算超过约 ¥176万（= ¥300,000 ÷ 17%）时，Scale 的经济性显著优于 Launch，是自然的升级触发点。
>
> **信用卡**：日本信用卡收单费率约3-4%，相对平台服务费比例过高，暂不实现。Launch 档统一走银行转账预充值。

---

### 22.2 Launch 档：充值单据自动化

充值流程对应日本企业会计的"前受金"处理：

```
品牌提交充值申请（topup_requests: pending）
  → 系统自动生成請求書 PDF（チャージ依頼，载明金额+收款账户+参考编号）
  → 品牌完成银行转账
  → 管理员确认到账（topup_requests: confirmed）
  → 系统自动生成領収書 PDF（证明该笔前受金已到账）
  → wallet_entries: TOPUP 入账
```

**当前阶段说明**：Herix 为免税事业者，本流程产出的請求書/領収書无需载入インボイス制度要求的「登録番号」。待营收规模触发课税事业者登记后，需在「任务消费产生平台服务费」的环节（而非充值环节）补充適格請求書，对应真实的役务提供时点。

---

### 22.3 Scale / Alliance 档：信用额度 + 月结

```
销售线下签约 → 运营后台「人工创建品牌账号」
  → 设置 credit_limit（授信额度）
  → wallets.available_balance 允许在 [-credit_limit, +∞) 区间

任务消费 → 正常走 TASK_FREEZE / TASK_SETTLE，余额可为负
月末批处理 → 汇总当月消费 → 生成月结請求書（按 NET30 等条款）
管理员确认收款 → 生成領収書，余额恢复至 0/授信额度内
```

---

### 22.4 品牌素材：LOGO + 宣传图

签约/入驻时收集，用于任务列表/详情页展示品牌视觉：

| 素材 | 规格建议 | 用途 |
|------|---------|------|
| LOGO | 方形头像/App图标版，≥400×400px，PNG优先 | 任务卡片品牌头像 |
| 宣传图 | 16:9横版，≥1200×675px | 任务详情页banner |

**系统统一适配（sharp）**：
- 宣传图非16:9 → 自动 center-crop 到16:9
- LOGO非方形（如横版文字Logo）→ 展示位用 `object-fit: contain` + 背景填充，不裁切
- 未提供素材时使用默认占位图

---

### 22.5 受影响流程与开发清单

| 模块 | 改动内容 |
|------|---------|
| `brand_profiles` | 新增 `logo_url`、`promo_image_url`；新增 `plan`（launch/scale/alliance）、Scale/Alliance 档相关字段 |
| `wallets` | 新增 `credit_limit`（默认0，仅 Scale/Alliance 档使用），余额校验逻辑允许负值在额度内 |
| 文件上传 | 新增 LOGO/宣传图上传接口 + sharp 裁切/压缩处理 |
| `topup_requests` 流程 | 申请时生成請求書PDF，确认到账时生成領収書PDF |
| 月结批处理 | 新增月末批量生成請求書任务（Scale / Alliance 档） |
| admin.html | 新增「人工创建品牌账号」入口（Scale / Alliance 档入驻）；品牌LOGO/宣传图/授信额度/方案编辑 |
| preview.html / merchant.html | 任务卡片/详情页展示品牌LOGO与宣传图 |

---

### 22.6 业务流程变化

```
┌─ Launch 档入驻向导（自助）────────────────────┐
│ 步骤1：方案选择 → 选 Launch                   │
│ 步骤2：品牌信息（公司名、行业、官网）            │
│ 步骤3：联系方式（联系人、电话、简介）            │
│ + 品牌形象（选填）：上传 LOGO + 宣传图          │
└──────────────────────────────────────────────┘

┌─ Scale / Alliance 档入驻（admin 人工创建账号）─┐
│ 销售签约时收集 LOGO + 宣传图（必填）            │
│ → admin 后台创建品牌账号时一并上传              │
└──────────────────────────────────────────────┘

merchant.html 新增「品牌资料」页面
  → 品牌可自助更新 LOGO/宣传图（固定文件名覆盖式更新，无需清理旧文件）
```

**展示层级关系**（理清 `tasks.cover_image` 与品牌素材的关系）：

```
任务详情页 banner：
  tasks.cover_image（任务级，商家发任务时可选填）
    └─ 未设置 → fallback → brand_profiles.promo_image_url（品牌默认宣传图）
         └─ 未设置 → fallback → 系统默认占位图

品牌身份标识（任务卡片角标 / 详情页品牌信息区）：
  brand_profiles.logo_url（独立维度，不参与上面的 fallback 链）
    └─ 未设置 → 系统默认占位 LOGO
```

---

### 22.7 服务器目录结构与静态资源服务

```
herix-server/
├── uploads/                       # 新增目录，运行时生成内容，加入 .gitignore
│   └── brands/
│       └── {brand_id}/
│           ├── logo.{ext}         # 固定文件名，更新即覆盖，避免孤儿文件
│           └── promo.{ext}
├── src/
│   ├── index.ts                   # 新增 express.static('/uploads', uploadsDir)
│   ├── routes/
│   │   └── uploads.ts             # POST /api/uploads/brand/logo、/api/uploads/brand/promo
│   ├── middleware/
│   │   └── upload.ts              # multer：限制 image/*、≤5MB
│   └── utils/
│       └── image.ts               # sharp：裁切适配（16:9 / 方形 contain）+ 压缩转 webp
```

**URL 规则**：数据库存相对路径 `/uploads/brands/{brand_id}/logo.png`，由 Express 静态中间件直出，前端直接拼到 `<img src>`。

**部署注意（Render 标准 Web 服务文件系统为 ephemeral）**：

| 阶段 | 方案 | 说明 |
|------|------|------|
| MVP / 当前 | 本地磁盘 + Render 临时文件系统 | redeploy 会清空 `uploads/`，需重新上传；素材更新频率低，初期可接受 |
| 规模化前 | Render Persistent Disk | 付费挂载 volume 到 `uploads/`，目录结构不变，解决 ephemeral 问题 |
| 长期 | 对象存储（Cloudflare R2 / S3） | 数据库仍只存完整 URL，原生支持 CDN；迁移时只需替换 `utils/image.ts` 的存储后端，路由/数据模型不变 |

> 设计原则：存储后端可替换，数据库字段始终是「可直接使用的 URL」，业务代码不感知底层是本地磁盘还是对象存储。

---

## 23. 广告代理（Agency）定位（2026-07-06 简化；2026-07-18 术语+架构均更新）

> ⚠️ **术语变更（2026-07-18）**："赫府"是旧称，已废弃，统一改称**广告代理**（对齐 PRD §27 全站术语定稿：中文"广告代理"、日文"広告代理店"、英文"Agency"）。
> **架构变更（2026-07-18）**：本节原结论"不需要 is_agency 标记"已被推翻——见 §28 入驻向导。技术上复用了**已存在**的 `brand_profiles.is_agency` 字段（此前只有 admin 后台手动开通一条路径，见 admin.ts `/admin/brands/:userId/agency`），入驻向导新增用户**自助选择**这条路径写同一个字段，没有新增列。因为未来功能与文案需要按身份分支（如入驻引导语气、任务发布后的品牌方分享提示）。以下 23.1-23.2 原文保留作历史参考，实际以 §28 为准。

### 23.1 广告代理在生态中的角色（历史原文，is_agency 自助选择之前）

广告代理是代理公司或个人经纪人，手上已有一批赫使资源，同时代表品牌客户发布任务。

**平台对广告代理的定位：普通商家账号，无需特殊角色或架构。**（⚠️已改，见上方架构变更说明）

广告代理在 Herix 上的操作与品牌完全相同：注册商家账号 → 充值 → 发任务 → 审核报名 → 结算。广告代理管理赫使的方式是**定向任务**（见第 24 节）：将任务私密发送给指定赫使，不走公开招募，平台不需要感知"谁是谁的赫使"。

| 角色 | 平台身份 | 核心用途 |
|------|---------|---------|
| 品牌 | BRAND 账号，is_agency=false | 公开任务为主 |
| 广告代理 | BRAND 账号，is_agency=true | 定向任务为主，管理自己的赫使网络；代客户执行 |
| 赫使 | HERALD 账号 | 接公开或定向邀请任务 |

> ~~不需要 `is_agency` 标记~~ 2026-07-18 起需要，见 §28。

---

## 24. 定向任务（Private Task）（2026-07-06 新增）

### 24.1 功能定义

定向任务是**仅对指定赫使可见**的任务，不出现在公开任务列表中。品牌或广告代理用它将任务直接分配给特定赫使，跳过公开招募环节。

典型场景：
- 广告代理将任务定向发给自己管理的赫使
- 品牌对历史合作赫使发出复购邀请
- 测试型任务，只邀请少数信任的赫使

---

### 24.2 数据模型

**tasks 表新增字段：**

```sql
visibility   TEXT DEFAULT 'public'   -- 'public' | 'private'
```

**新增表 task_invitations：**

```sql
task_invitations
  id            UUID PRIMARY KEY
  task_id       → tasks.id
  herald_id     → users.id
  status        TEXT  -- 'pending' | 'accepted' | 'declined'
  created_at    TIMESTAMPTZ DEFAULT NOW()
```

- 一个私域任务可邀请多名赫使
- 赫使接受邀请后，在 `task_applications` 中创建一条 APPROVED 记录（跳过 PENDING 审核）
- 赫使拒绝或忽略，不影响任务状态

---

### 24.3 任务创建流程（merchant.html）

```
商家创建任务 → 选择可见性
  ├─ 公开（默认）→ 正常发布，所有赫使可报名
  └─ 定向 → 搜索并添加赫使（按邮箱或昵称）→ 发布
              → 系统为每位被邀请赫使写入 task_invitations
              → 赫使端"专属邀请" tab 展示该任务
```

---

### 24.4 赫使端（preview.html）

任务列表新增"专属邀请"入口，显示：
- 所有 `status='pending'` 的 task_invitations（待响应）
- 任务信息 + 发起方品牌/广告代理名称
- 操作：接受 / 婉拒

接受后直接进入执行流程（等同于申请已通过），无需再走报名审核。

---

### 24.5 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tasks/:id/invitations` | 邀请赫使（BRAND 权限，私域任务专用） |
| GET | `/api/tasks/invitations/my` | 我收到的邀请列表（HERALD 权限） |
| POST | `/api/tasks/invitations/:id/respond` | 接受或拒绝邀请（HERALD 权限） |

**任务列表接口变更**：`GET /api/tasks`
- `visibility='private'` 的任务不出现在公开列表
- 私域任务仅对创建者和被邀请赫使可见

---

### 24.6 开发优先级

| 优先级 | 内容 |
|--------|------|
| P0 | `tasks.visibility` 字段 + `task_invitations` 表迁移 |
| P0 | 邀请 API（创建/查询/响应）|
| P0 | merchant.html：任务创建时选择定向 + 赫使搜索 |
| P0 | preview.html：专属邀请 tab + 接受/拒绝操作 |
| P1 | 邀请通知（邮件/站内消息）|

---

## 26. 2026-07-16 变更记录

> 本节由架构评审后补记，对应代码已全部入库（commit 4cefe43 ～ 80b249c）。

1. **赫使端全量迁移 Taro**：11 页面 + 4 共享组件，一套代码编译 weapp + H5；旧 preview.html 删除、herix.html 待退役。
   桌面响应式（≥768px：列表两列 / 详情页侧栏 / 表单限宽）。
2. **三语体系上线**：见 §15.9。admin.html 新增「本地化」词条矩阵入口（key×zh/ja/en×语境）。
3. **钱包并发安全**：`wallets` 行锁（FOR UPDATE）修复并发丢更新；提现申请三步（查重→落库→冻结）合并为单事务，
   消除并发双冻结与僵尸 pending。
4. **最低提现金额定稿 ¥1,000**，单一事实源 platform_settings，见 §11。
5. **错误 code 化**：赫使侧 19 处错误带 code（BAD_CREDENTIALS / INSUFFICIENT_BALANCE / ALREADY_APPLIED 等）。
6. **死代码清理**：seedIfEmpty（写不存在的旧表，空库会崩）、前端 calcTier 副本、8 个未引用 API wrapper；
   fmt/微信校验重复实现收敛为单份。
7. **已知遗留**（按优先级）：金额字段 DOUBLE PRECISION 浮点（待定取整口径）；流水标签后端中文；
   `.card/.btn-primary` 跨页类名重名（H5 全局样式）；`withdrawal_methods` 物理删除改软删；
   `wallet_entries(wallet_id, created_at)` 索引待补。

## 28. 商家后台前端架构策略（2026-07-18 定）

**现状**：merchant.html 为单文件 vanilla JS（~4000行，14个页面级函数），业务逻辑全在服务端，
词条已三语化（i18n_entries），API 稳定。已知税率：无组件复用、字符串拼 HTML 的转义/变量遮蔽类 bug
（2026-07-18 一天修了 10+ 处 t 遮蔽）、i18n 靠人工逐处接入。

**决策：现在不整体迁移，画"增量分界线"**
1. 存量 14 页冻结在 vanilla：只修 bug 和小调整，不再承接大功能
2. 下一个交互密集的新功能（预计是数据分析看板）直接作为第一个 React 页面，
   独立路由与旧页共存（绞杀者模式），顺带建好构建链/路由共存/词条消费基建
3. 存量页面按重访率搬：哪页因新需求大改就趁机迁，不设迁移专项
4. 全量收尾触发条件（二居一）：上线后产品形态稳定；出现第二个前端协作者

**成本基准**（防止决策被恐惧驱动）：单页迁移 0.5~1 天（AI 辅助、照现有 API 画界面），
全量 ≈1.5~2 周，可停在半路。成本随存量页面数线性增长——增量已引走，不会恶化。

**配套纪律**（保迁移门票，见工作准则）：新业务逻辑一律进服务端（服务端是唯一裁判）；
API 错误码化排期（后端中文错误文案是迁移路上的已知债）；merchant.html 不再长大。

---

## 27. 全站术语定稿（2026-07-17 用户拍板）

三语角色与核心概念的统一叫法，全部对外文案（主页/商家后台/小程序/邮件/通知）遵循本表：

| 概念 | 中文 | 日文 | 英文 |
|------|------|------|------|
| 推广者 | 赫使（品牌自创词） | アンバサダー（赫使） | Ambassador（弃用 Herald 复数直译） |
| 品牌 | 品牌方；面向代理的语境称"你的客户/广告主" | ブランド；面向代理时 広告主/クライアント | Brand；面向代理时 your client |
| 代理 | **广告代理**（弃"代理商"；不叫 MCN） | **広告代理店**（不加 事務所/プロダクション——我们的代理是受品牌委托的需求侧，不是达人经纪） | Agency |
| 一单合作 | 任务 | **案件**（营销文案层；小程序界面词条现用タスク，是否跟进另议） | Campaign（营销文案层；界面沿用 task） |
| 推广码 | 推广码 | **紹介コード**（弃プロモコード，体现引荐概念，与 Referral 对应） | Referral code |
| 转化 | 转化 | **コンバージョン**（弃中式日语"転換"） | Conversion |
| 结算 | 结算 | **精算**（"結算"是中文错字，日文不存在） | Settlement |
| 平台定位 | **海外生活社群**（弃"海外华人"——客群是所有海外生活群体） | **海外ルーツコミュニティ**（弃"移住者"；「海外にルーツを持つ」为日本媒体标准体面用语） | Diaspora communities（现状已准确，不动） |
| 商家端产品名 | **商家后台**（2026-07-18 定稿；弃"品牌商家管理后台/商户后台"——身份含品牌方+广告代理，"品牌商家"排除了代理且旧文案两处不一致） | ビジネス管理画面 | Business Console（Meta Business Suite/LINE for Business 同款命名惯例） |
| 站点 | **站点**（Herix 日本站；2026-07-18 定稿，弃"业务市场"——易与营销语境的"目标市场"混淆） | マーケットプレイス | Marketplace（Amazon 站点模型：站点 = 签约实体+结算币种+费率表+协议版本+赫使供给 的完整运营单元；站点 id 用国家码如 `JP`；多站点化时 brand_markets 关系表每行须含 contracting_entity+agreement_version） |
| 商家注册地 | **公司注册地**（弃"公司归属国家"；相对站点而言：与站点同国=境内合同，不同国=跨境合同——影响税务处理(消費税/reverse charge)、票据形式(適格請求書 vs 增值税发票)、充值通道、KYB材料，不影响功能使用） | 会社の登録国 | Company Registration Country |

**决策背景**：
- 客户构成 = 自己找赫使的 Brand + 受 Brand 委托找赫使的 Agency，代理是需求侧执行方，
  故日文取「広告代理店」经典定义；代理板块价值主张从"你手上有赫使资源"（MCN 叙事）
  改写为"受品牌委托，在平台找赫使、管执行、给品牌客户透明可见"（受托执行叙事，
  品牌方绑定功能即卖点）。
- 平台受众从"华人"放宽为"所有海外生活群体"，中日文定位词随之泛化，避免
  移民/侨民等生硬或带官方腔的词。
- 小程序内日文词条（i18n 矩阵）经查已在用 紹介コード/コンバージョン/精算，无需改；
  本次落地范围 = 主页 index.html 三语文案。
