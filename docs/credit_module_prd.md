# 品牌信用授信模块 PRD

**版本**：v2.0  
**日期**：2026-07-11  
**状态**：已实现（与代码同步维护）

---

## 一、背景与目标

新商户注册后往往不愿立即充值——不确定平台质量，不想先付钱。信用授信模块给每个商户预设一个固定的**发任务信用额度**，让商户在未充值状态下也能体验完整的发布流程，待任务完成后再引导充值结算。

**核心原则：**
- 信用是"发任务的通行证"，不是平台垫付给赫使的钱
- 结算（打款给赫使）始终要求商户有真实余额
- 平台不承担垫资风险

---

## 二、核心概念

### 2.1 两种发布模式

| 模式 | 触发条件 | 资金处理 | 任务标记 |
|------|---------|---------|--------|
| **实款模式** | 发布时可用余额 ≥ 任务成本 | 即时冻结 escrow | `credit_funded=false` |
| **信用模式** | 发布时余额不足，但信用额度足够 | 不冻结，标记信用占用 | `credit_funded=true` |

### 2.2 额度公式

```
可发任务额度 = max(0, 可用余额 + 剩余信用)
剩余信用     = 信用额度上限 - 信用占用
信用占用     = SUM(escrow_amount) WHERE credit_funded=true AND status IN ('OPEN','IN_PROGRESS')
```

**关键特性：**
- 信用额度上限永久有效，不因充值而清零
- 充值后可用余额增加，发任务额度同步增加
- 信用随已结算任务"释放"——任务结算时从余额扣款，该任务退出信用占用统计，信用自动恢复

### 2.3 极速打款（fast_payout）

**触发条件**：发布任务时，商户可用余额 ≥ `fast_payout_threshold`（可配置，默认 ¥100,000）

- 与信用系统解耦——不是"充值就有极速"，而是"余额充足才有极速"
- 标签存储在 `tasks.fast_payout`（任务维度的快照）
- 充值确认后：若新余额 ≥ 门槛，自动为进行中任务补打标签

---

## 三、完整用户流程

```
[注册] → 信用额度初始化（默认 ¥5,000，可运营覆盖）

[发任务]
  ├─ 余额充足 → 冻结实款 → fast_payout=true（若余额≥门槛）
  └─ 余额不足 → 检查信用额度
        ├─ 信用足够 → 信用模式发布，余额不动
        │     └─ 首次发布 → 推送充值引导提醒
        └─ 信用不足 → 402 拒绝，提示具体缺口

[任务进行中] → 赫使报名 → 商户审核 → 赫使提交内容 → 商户审核

[结算]
  ├─ 实款任务（credit_funded=false）→ 从冻结余额结算，无需检查
  └─ 信用任务（credit_funded=true）
        ├─ 余额 ≥ 佣金 → 直接从可用余额扣款结算
        └─ 余额 < 佣金 → 402，提示商户充值后结算
              → 商户充值 → 重新触发结算 → 成功

[信用恢复] → 任务结算后，该任务不再计入信用占用 → 剩余信用自动恢复
```

---

## 四、数据模型

### 4.1 platform_settings

| key | 默认值 | 说明 |
|-----|-------|------|
| `merchant_initial_credit` | `5000` | 商户信用额度默认值（JPY） |
| `fast_payout_threshold` | `100000` | 极速打款余额门槛（JPY） |

### 4.2 brand_profiles 相关字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `credit_limit_override` | `DOUBLE PRECISION` | 运营设置的个性化信用额度，NULL = 用全局默认 |
| `has_topped_up` | `BOOLEAN` | 是否曾完成充值（用于 UI 引导逻辑，不影响额度计算） |
| `first_publish_reminder_sent` | `BOOLEAN` | 是否已推送过首次充值引导 |

### 4.3 tasks 相关字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `credit_funded` | `BOOLEAN` | 是否为信用模式发布 |
| `fast_payout` | `BOOLEAN` | 发布时余额是否达到极速打款门槛 |
| `escrow_amount` | `NUMERIC` | 任务总成本（commission × max_heralds） |
| `is_escrowed` | `INTEGER` | 1=已冻结实款，0=信用模式未冻结 |

---

## 五、API 接口

### 5.1 `GET /api/wallet/brand-balance`

响应中 `credit` 字段：

```json
{
  "available": 5000,
  "frozen": 0,
  "credit": {
    "hasToppedUp": false,
    "initialCredit": 100000,
    "creditUsed": 3000,
    "creditRemaining": 97000,
    "totalCapacity": 102000,
    "fastPayoutEligible": false,
    "fastPayoutThreshold": 100000
  }
}
```

### 5.2 `PATCH /api/tasks/:id/publish`

**额度不足（402）：**
```json
{
  "error": "额度不足，需要 ¥3000，当前可用额度 ¥2000（余额 ¥0 + 信用 ¥2000）",
  "code": "INSUFFICIENT_CREDIT",
  "needed": 3000,
  "creditInfo": { ... }
}
```

**首次发布引导（200）：**
```json
{
  "id": "...",
  "topupReminder": "为提升任务可信度、鼓励赫使积极报名，并在任务完成后自动打款，请尽快完成充值。"
}
```

### 5.3 `PATCH /api/admin/brands/:userId/credit-limit`

运营设置个性化信用额度。

```json
// Request
{ "creditLimit": 100000 }  // null = 恢复全局默认

// Response
{ "userId": "...", "creditLimitOverride": 100000 }
```

### 5.4 信用任务结算（submissions.ts 内部）

```
信用任务结算前检查：
  if available < commission → 402 CREDIT_TASK_NEEDS_FUNDING
  else → settleCreditTask（deltaAvailable = -commission）
```

---

## 六、业务规则汇总

| 规则 | 说明 |
|------|------|
| 信用额度永不清零 | 充值操作增加余额，不影响信用额度上限 |
| 信用自动恢复 | 任务结算后，该任务退出信用占用，剩余信用恢复 |
| 余额不可为负 | wallet 层有守卫，负余额不允许出现 |
| 结算始终需真实余额 | 信用任务结算时若余额不足，阻塞并提示商户充值 |
| 极速打款=余额门槛 | 与信用系统无关，只看发布时余额是否达到阈值 |
| 充值后补打标签 | 若充值后余额达到门槛，自动为进行中任务补标 `fast_payout=true` |

---

## 七、运营管控

### 7.1 调整单账户信用额度

```bash
# 设置个性化额度（例：战略合作账户 ¥500,000）
PATCH /api/admin/brands/:userId/credit-limit
Body: { "creditLimit": 500000 }

# 恢复全局默认
Body: { "creditLimit": null }
```

### 7.2 调整全局参数

通过 `platform_settings` 表或管理员 UI 修改：
- `merchant_initial_credit`：调整所有未设置 override 账户的信用额度
- `fast_payout_threshold`：调整极速打款的余额门槛

---

## 八、待扩展方向

- [ ] **信用分级制**：基于历史完成付款金额自动上调额度（¥100万 → ¥10000，¥500万 → ¥50000）
- [ ] **逾期任务冻结**：信用任务超期未结算，暂停该账户信用发布权限
- [ ] **负余额模式**（需评估）：允许结算将余额推至负数（相当于平台垫付），以 credit_limit 为最大风险敞口——目前未实现，需评估平台承受能力
