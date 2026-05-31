# Herix 赫使 — 大使任务系统 PRD
**版本：** v1.2 · 2026-05-31  
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
15. [系统实现记录（2026-05-30）](#15-系统实现记录2026-05-30)

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

### 初期方案（CSV定时上传）

**商家上传CSV字段定义：**

```csv
promo_code,event_type,event_at,transfer_amount
```

**event_type 枚举值：**
- `registered` → 用户注册
- `kyc_completed` → KYC完成
- `first_transfer` → 首次汇款完成

**示例：**
```csv
HERIX-A3K9Z2,registered,2026-06-01T10:23:00Z,
HERIX-A3K9Z2,kyc_completed,2026-06-02T14:05:00Z,
HERIX-A3K9Z2,first_transfer,2026-06-03T09:11:00Z,15000
```

**上传流程：**
```
商家在赫使平台后台上传CSV（建议每天一次，上传昨日数据）
  → 系统解析CSV，以promo_code匹配AmbassadorTask
  → 推广码不存在或格式错误 → 跳过，记录错误日志
  → 三个事件均满足 → Referral.qualified = true，计入大使成功件数
  → 推送通知给大使
```

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

## 15. 系统实现记录（2026-05-30）

> 本节记录实际开发过程中的架构决策与实现细节，供后续开发参考。

---

### 15.1 多端架构

| 文件 | 角色 | 说明 |
|------|------|------|
| `preview.html` | 赫使端（C端） | 移动端优先，底部 tab 导航，任务浏览/报名/提交 |
| `merchant.html` | 品牌商家端（B端） | PC 优先，侧边栏导航，任务管理/审核/数据 |
| `admin.html` | 平台运营端 | PC，侧边栏导航，审核/结算/用户管理 |
| `herix-server/` | 后端 API | Express + SQLite，三端共用同一套 REST API |

所有前端均为纯 HTML/CSS/JS，无构建依赖，可直接用任意静态服务器托管。

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

**品牌商家入驻（2步向导）：**
1. 品牌信息（公司名、行业、官网）
2. 联系方式（联系人、电话、简介）

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
- `src/db.ts` — 删除模块级 `initDatabase()` 自动调用，避免与 `index.ts` 中的调用冲突导致 Render 部署时报 `duplicate key violates unique constraint "pg_class_relname_nsp_index"`
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
- Render 首次部署时完全自动化，无需手动操作

**手动重灌脚本：**
- `seed-db.ts` — 独立种子脚本，先清空所有表再重新填充
- Render Shell 执行：`cd herix-server && npx tsx seed-db.ts`
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
- `config/index.js` 中 `publicPath` 和 API 代理端口更新为 3005
- `src/utils/api.ts` 中 `BASE_URL` 改为相对路径 `/api`（适配 Render 部署）
- 首页从占位符重写为带"我的待办"标签页的任务列表

### 16.7 Render 部署配置

**render.yaml 更新：**
```yaml
buildCommand: cd herix-server && npm install && npx tsc && cd ../herix-miniapp && npm install && npx taro build --type h5
startCommand: cd herix-server && node dist/index.js
```

**部署后自动种子：**
- `index.ts` 中 `await initDatabase()` 然后 `await seedIfEmpty()`
- 首次部署时数据库为空，自动灌入完整测试数据

### 16.8 测试账号（更新）

| 账号 | 密码 | 角色 | 数据内容 |
|------|------|------|----------|
| `admin@herix.com` | 123456 | 管理员 | 访问管理后台 |
| `brand@d.com` | 123456 | 品牌商家 | 周大福珠宝，7个任务（含2个 PERFOMANCE） |
| `alice@d.com` | 123456 | 赫使 | 已报名4个任务（2个APPROVED，1个已完成，1个PENDING） |
| `gabrielgong2019@outlook.com` | 123456 | 赫使+品牌 | 双角色，3个赫使申请 + 4个品牌任务 |

**测试地址：**
| 端 | URL |
|------|-----|
| 赫使用户端 | `https://herix.onrender.com/preview.html` |
| 品牌商家端 | `https://herix.onrender.com/merchant.html` |
| 管理后台 | `https://herix.onrender.com/admin.html` |
| 小程序 H5 | `https://herix.onrender.com/` |

