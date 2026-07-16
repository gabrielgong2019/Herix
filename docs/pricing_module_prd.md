# 收费定价模块 PRD

**版本**：v1.1  
**日期**：2026-07-09  
**状态**：待实现

---

## 一、背景与目标

当前平台抽佣比例硬编码为 15%（`submissions.ts:79`），无法动态调整，无法对特定商家设置协议费率，商家发布任务前也看不到费用明细。定价模块目标：

1. 将费率从代码中提取为运营可配置的后台设置
2. 支持对特定账户设置谈判协议费率
3. 商家发布任务前提前展示费用结构
4. 提现手续费：每笔收固定费用，每月限制次数
5. 充值处理费：信用卡由商家承担（pass-through），银行转账免费
6. 所有费率参数均通过 `platform_settings` 后台可配置，无需改代码

---

## 二、费率体系

### 2.1 平台抽佣比例（commission_rate）

适用场景：赫使完成任务、品牌审核通过后的结算环节。

```
品牌支付：commission（发布时锁定）
平台抽取：commission × commission_rate
赫使到手：commission × (1 - commission_rate)
```

| 层级 | 说明 | 优先级 |
|---|---|---|
| 全局默认值 | 运营在后台设置，对所有账户生效 | 最低 |
| 账户协议费率（`commission_rate_override`）| 运营对特定账户手动设置 | 最高 |

**当前值**：15%  
**建议范围**：5% ~ 30%，超出此范围需两名管理员确认（Phase 2）

#### 结算时快照规则

任务结算时，费率取当时的**有效费率**并快照到 `task_transactions.platform_fee_rate`，历史记录与后续费率变更无关，保证可审计性。

---

### 2.2 提现手续费与打款周期（withdrawal_fee）

赫使申请提现时收取，**每笔固定金额**。打款分两个阶段：

#### 阶段一：固定打款日（当前，无支付 API）

平台每月仅在**月中（15日）**和**月末（最后一个自然日）**集中打款，不支持即时到账。

- 赫使随时提交提现申请（余额冻结），申请进入待处理队列
- 系统标注"预计打款日"为最近的下一个打款日
- 管理员在打款日批量审核并手动完成转账，随后后台标记为已完成
- 每月最多 2 次打款日，对应赫使的提现申请自然不超过 2 次有效处理

**默认手续费**：每笔 ¥500（运营后台可调整）

```
赫使申请提现：¥10,000
扣除手续费：   ¥500
实际到账：     ¥9,500
预计打款日：   2026-07-15（若今日 7/9）
```

#### 阶段二：接入支付 API 后

- 赫使申请后实时转账（或次工作日），不再受打款日限制
- 月次数限制由 `withdrawal_monthly_limit` 控制（届时启用）
- 切换配置项：`withdrawal_schedule_mode` 从 `'FIXED_DATES'` 改为 `'ON_DEMAND'`

#### 手续费扣除方式

提现打款完成（`debitWithdrawal`）时：

1. 从冻结余额扣除申请金额（`WITHDRAWAL_DEBIT`）
2. 写平台钱包 `creditPlatformFee`，金额 = 手续费，`note` = "提现手续费"
3. 实际转账金额 = 申请金额 - 手续费（记录在 `withdrawals.net_amount`）

**结构类型**（`withdrawal_fee_type`）：当前使用 `FLAT`，架构保留扩展能力，不实现其他类型。

---

### 2.3 充值处理费（topup_processing_fee）

品牌充值时按支付通道收取，**由商家承担**（到账金额 = 充值金额 - 通道手续费）。

| 支付通道 | 手续费率 | 说明 |
|---|---|---|
| 信用卡（Credit Card） | 可配置，参考值 3% | Pass-through，实际率以接入通道合同为准 |
| 银行转账（Wire Transfer / 振込） | **0%** | 免收 |

**展示规则**：充值流程中，选择信用卡时实时显示预计到账金额：

```
充值金额     ¥10,000
信用卡手续费  ¥300    (3%)
实际到账     ¥9,700
```

选择银行转账时不显示手续费行（免费）。

**到账逻辑**：实际到账金额写入 `TOPUP` 分录（`amount = topup - fee`），手续费单独写 `PLATFORM_FEE` 分录，`note` 标注"充值手续费"。

**当前状态**：未接入真实支付通道，Phase 1 充值手动审核，手续费暂不收取，入账全额。`topup_cc_rate` 字段提前写入 settings（值为 0.03），待支付通道接入后前端开始展示。

---

### 2.4 消费税（JPY/日本消費税）

平台服务费是否含消费税（10%），需法务确认后在 PRD v1.1 中更新。当前 `tax_withheld` 字段已在 `wallet_entries` 中存在，可记录代扣税额。

---

## 三、数据结构

### 3.1 `platform_settings` 表（全局键值）

```sql
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  note        TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

关键 key：

| key | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `commission_rate` | REAL | 0.15 | 全局抽佣比例 |
| `withdrawal_fee_type` | TEXT | 'FLAT' | 'FLAT' / 'NONE'（架构保留，当前只用 FLAT） |
| `withdrawal_fee_flat` | INTEGER | 500 | 每笔固定提现手续费（JPY） |
| `withdrawal_schedule_mode` | TEXT | 'FIXED_DATES' | 'FIXED_DATES'（月中/月末）/ 'ON_DEMAND'（接入 API 后改） |
| `withdrawal_monthly_limit` | INTEGER | 2 | 每月最多次数（仅 ON_DEMAND 模式生效；FIXED_DATES 模式由打款日自然限制） |
| `withdrawal_min_amount` | INTEGER | 1000 | 最低提现申请金额（JPY，手续费前） |
| `topup_cc_rate` | REAL | 0.03 | 信用卡充值手续费率（pass-through，商家承担） |

### 3.2 `brand_profiles` 新增字段

```sql
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override REAL;
  -- NULL = 使用全局默认值；非 NULL 覆盖全局，优先级最高
  -- 例：设为 0.10 表示该账户享受 10% 协议费率

ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_note TEXT;
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_by TEXT;
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS commission_rate_override_at TEXT;
```

### 3.3 `task_transactions` 新增字段

```sql
ALTER TABLE task_transactions ADD COLUMN IF NOT EXISTS platform_fee_rate REAL;
  -- 结算时快照：实际使用的费率，无论后续费率如何变更，历史记录不受影响
```

---

## 四、有效费率计算

```typescript
async function getEffectiveCommissionRate(brandUserId: string): Promise<number> {
  // 1. 账户协议费率（最高优先级）
  const profile = await findOne('SELECT commission_rate_override FROM brand_profiles WHERE user_id = ?', [brandUserId]);
  if (profile?.commission_rate_override !== null && profile?.commission_rate_override !== undefined) {
    return profile.commission_rate_override;
  }
  // 2. 全局默认
  const setting = await findOne('SELECT value FROM platform_settings WHERE key = ?', ['commission_rate']);
  return setting ? Number(setting.value) : 0.15;
}
```

提现申请前信息计算：

```typescript
function nextPayoutDate(): Date {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const mid     = new Date(y, m, 15);
  const lastDay = new Date(y, m + 1, 0);  // 当月最后一天
  if (now < mid)     return mid;
  if (now < lastDay) return lastDay;
  return new Date(y, m + 1, 15);          // 下月月中
}

async function calcWithdrawalInfo(requestAmount: number): Promise<{
  fee: number;
  netAmount: number;
  nextPayoutDate: string;
  scheduleMode: string;
}> {
  const feeFlat = Number(await getSetting('withdrawal_fee_flat') ?? 500);
  const type    = await getSetting('withdrawal_fee_type') ?? 'FLAT';
  const mode    = await getSetting('withdrawal_schedule_mode') ?? 'FIXED_DATES';
  const fee     = type === 'NONE' ? 0 : feeFlat;
  if (requestAmount <= fee) throw new Error('提现金额须高于手续费');
  return {
    fee,
    netAmount: requestAmount - fee,
    nextPayoutDate: nextPayoutDate().toISOString().split('T')[0],
    scheduleMode: mode,
  };
}
```

充值到账金额（信用卡，仅供前端展示用，实际到账以支付通道回调为准）：

```typescript
async function calcTopupNetAmount(grossAmount: number, method: 'cc' | 'wire'): Promise<number> {
  if (method === 'wire') return grossAmount;
  const rate = Number(await getSetting('topup_cc_rate') ?? 0.03);
  return Math.floor(grossAmount * (1 - rate));
}
```

---

## 五、API 变更

### 5.1 `GET /api/admin/pricing` — 读取当前定价配置

权限：ADMIN only

**Response:**
```json
{
  "commissionRate": 0.15,
  "withdrawalFeeType": "FLAT",
  "withdrawalFeeFlat": 500,
  "withdrawalMonthlyLimit": 2,
  "withdrawalMinAmount": 1000,
  "topupCcRate": 0.03
}
```

### 5.2 `PATCH /api/admin/pricing` — 更新全局定价

权限：ADMIN only。每个字段独立可更新，支持部分更新。

**Request:**
```json
{
  "commissionRate": 0.12,
  "withdrawalFeeFlat": 300,
  "withdrawalMonthlyLimit": 3,
  "note": "2026 Q3 调整：降低提现手续费，增加次数限制"
}
```

`note` 写入每条被修改的 `platform_settings.note`，同时记录 `updated_by` 和 `updated_at`。

### 5.3 `PATCH /api/admin/brands/:userId/pricing` — 账户协议费率

权限：ADMIN only

**Request:**
```json
{
  "commissionRateOverride": 0.10,
  "note": "战略合作伙伴，协议10%"
}
```

`commissionRateOverride: null` → 清除协议费率，恢复全局默认。

### 5.4 `GET /api/pricing/preview` — 发布前费用预览

权限：BRAND（仅自己账户）

**Request params**: `?commission=5000`

**Response:**
```json
{
  "commission": 5000,
  "commissionRate": 0.10,
  "platformFee": 500,
  "heraldPayout": 4500,
  "isOverride": true,
  "overrideNote": "战略合作伙伴，协议10%"
}
```

前端在任务发布确认弹窗中调用此接口，展示费用明细。

### 5.5 `GET /api/pricing/withdrawal-info` — 提现前信息

权限：HERALD（已登录）

**Request params**: `?amount=10000`

**Response（FIXED_DATES 模式）：**
```json
{
  "requestAmount": 10000,
  "fee": 500,
  "netAmount": 9500,
  "scheduleMode": "FIXED_DATES",
  "nextPayoutDate": "2026-07-15",
  "note": "平台每月15日和月末集中打款"
}
```

**Response（ON_DEMAND 模式，接入 API 后）：**
```json
{
  "requestAmount": 10000,
  "fee": 500,
  "netAmount": 9500,
  "scheduleMode": "ON_DEMAND",
  "monthlyUsed": 1,
  "monthlyLimit": 2,
  "monthlyRemaining": 1,
  "canWithdraw": true
}
```

提现申请页面在输入金额后调用，实时展示手续费和预计打款日（或次数）。

### 5.6 `submissions.ts` 修改点

```typescript
// 原来（硬编码）
const platformFee = Math.round(commission * 0.15 * 100) / 100;

// 改为（动态读取）
const rate = await getEffectiveCommissionRate(task.creator_id);
const platformFee = Math.round(commission * rate * 100) / 100;

// 并快照到 task_transactions
await insert('task_transactions', {
  ...
  platform_fee_rate: rate,  // 新增字段
});
```

---

## 六、前端展示

### 6.1 merchant.html — 任务发布确认弹窗

发布前在弹窗中展示：

```
任务报酬      ¥5,000
平台服务费     ¥500     (10%)  ← 若有协议费率，显示"协议优惠费率"
赫使实际到手   ¥4,500
您共需冻结     ¥5,000   (任务取消时全额退还)
```

充值 → 选择信用卡时展示：

```
充值金额       ¥10,000
信用卡手续费    ¥300    (3%)
实际到账       ¥9,700
```

充值 → 选择银行转账时：手续费行不显示（免费）。

### 6.2 merchant.html — 交易明细

现有 `TASK_SETTLE` 流水已含 `amount`，需在展示时同时查询 `task_transactions.platform_fee` 字段，显示：

```
任务《XX》结算    -¥5,000   (含平台服务费 ¥500)
```

### 6.3 preview.html — 提现申请页

**FIXED_DATES 模式（当前）**：

```
可提现余额     ¥15,000
申请金额       ¥10,000
提现手续费      ¥500
实际到账       ¥9,500
─────────────────────────────────
预计打款日     2026-07-15
平台每月15日和月末集中打款
```

提交后状态显示"待打款（预计 7/15）"。

**待处理状态**（admin 打款前）：赫使钱包显示"提现申请中 ¥10,000（7/15 打款）"，余额冻结中。
**打款完成**：admin 确认后状态变为"已打款"，冻结余额清零。

### 6.4 admin.html — 定价管理页

- 全局费率表单（当前值 + 修改入口）：抽佣比例、提现手续费、月提现次数限制、信用卡充值费率
- 修改历史（显示 `updated_by` + `updated_at` + `note`）
- 品牌账户协议费率区（在品牌详情页，与信用管理并列）

---

## 七、兼容性说明

历史 `task_transactions` 记录中 `platform_fee_rate` 为 NULL，表示按当时硬编码的 15% 结算（可在前端对 NULL 值显示 "15%（历史默认）"）。新增字段不影响历史数据查询，迁移无需回填。

---

## 八、实施优先级

- [ ] **Phase 1**：
  - `platform_settings` 表建立 + 初始化 6 个默认值（含 `withdrawal_schedule_mode='FIXED_DATES'`）
  - `submissions.ts` 改为动态读取 `commission_rate`，快照到 `task_transactions.platform_fee_rate`
  - `task_transactions` 添加 `platform_fee_rate` 字段
  - `brand_profiles` 添加账户协议费率字段
  - `withdrawals` 表添加 `net_amount`、`fee`、`payout_date`（预计打款日）字段
  - `wallet.ts` 提现打款完成时写 `creditPlatformFee` 手续费分录
  - `GET /api/pricing/withdrawal-info` 提现前信息（手续费 + 预计打款日）
  - 管理后台 API：`GET/PATCH /api/admin/pricing`、`PATCH /api/admin/brands/:id/pricing`
  - admin.html 定价管理 UI + 提现队列显示预计打款日
  - preview.html 提现页显示手续费 + 预计打款日

- [ ] **Phase 2（接入支付 API 后）**：
  - `withdrawal_schedule_mode` 改为 `'ON_DEMAND'`，提现即时处理
  - 启用 `withdrawal_monthly_limit` 次数校验
  - `GET /api/pricing/preview` 发布前费用预览接口
  - merchant.html 发布确认弹窗费用明细
  - merchant.html 充值信用卡选项显示手续费预估

- [ ] **Phase 3**：
  - 分级抽佣（按累计任务量阶梯优惠）
  - 消费税处理（待法务确认）
