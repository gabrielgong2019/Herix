# 业务旅程测试用例（两端立场）

> 按业务旅程组织，商家/赫使/平台三方立场交替。**全部只打本机**（localhost:4005 + 本机 PG），
> 按需手动跑，不强制每次改动都跑。已脚本化的用例标注脚本名；未脚本化的按文档手测或后补。

## 旅程 A：内容任务全生命周期 ✅ `journey_content_task.sh`（23 断言）

| # | 立场 | 用例 | 预期 |
|---|------|------|------|
| A1 | 商家 | 创建任务（草稿前置+平台要求 IG≥5000）→ 发布 | 进入平台审核 PENDING_REVIEW，商家端显示"待审核" |
| A2 | 赫使 | 审核期访问 | 探索列表不可见；直链 404 |
| A3 | 平台 | admin 审核通过 | 任务转 OPEN，赫使可见 |
| A4 | 赫使 | 无平台账号直接报名 | 被资格闸拦：REQUIREMENTS_NOT_MET(MISSING) |
| A5 | 赫使 | 完善档案（IG 8000粉）→ 报名+留言 | 报名成功 |
| A6 | 商家 | 通知铃 + 审核队列"报名待审" → 通过报名 | NEW_APPLICATION 通知；汇总可见；通过时过额度闸 |
| A7 | 赫使 | 收到通过通知 → 待办提示"步骤1/3 提交草稿" → 交草稿 | APP_APPROVED；单据 DRAFT+PENDING_REVIEW |
| A8 | 商家 | 拒绝草稿（附原因） | DRAFT+REJECTED，原因可回读 |
| A9 | 赫使 | 看到原因 → 重提草稿 | 同一单据回到 DRAFT+PENDING_REVIEW（不新增行） |
| A10 | 商家 | 通过草稿 | DRAFT+APPROVED（**不算任务完成**，赫使待办出现"提交终稿"） |
| A11 | 赫使 | 发布内容 → 提交终稿链接 | 同行 flip 到 FINAL+PENDING_REVIEW |
| A12 | 商家 | 通过终稿 → 自动结算 | 三方对账：商家 −cost、赫使 +payout、平台 +fee(=cost−payout)；task_transactions 落 TASK_RELEASE；账本幂等键 SETTLE/CREDIT/FEE 齐备 |
| A13 | 赫使 | 结算通知 + 余额到账 | SUB_APPROVED；余额=payout |

**未脚本化的 A 旅程补充用例（手测/后补）**：
- A14 赫使提现：余额 → 提现申请 → admin 打款确认 → 余额清零/流水可查
- A15 终稿被拒场景：拒绝次数额度（maxRevisions）用尽 → 商家只能通过或开仲裁
- A16 结算时商家余额不足 → SETTLEMENT_BLOCKED 通知商家充值，单据保持待审
- A17 超时自动化：商家7天未审自动通过；赫使被拒7天未重提释放名额（跑 timers）

## 旅程 B：邀请码任务（PERFORMANCE）📝 待脚本化

| # | 立场 | 用例 | 预期 |
|---|------|------|------|
| B1 | 商家 | 创建邀请码任务（自定义码模式）→ 上传码（≤2000/次） | 码入池；max_heralds=码池数量；超2000 → MAX_CODES_EXCEEDED |
| B2 | 商家 | 发布 → 过审 | 同 A1-A3 |
| B3 | 赫使 | 报名 → 商家通过 | 自动从码池分到专属码（task_promo_codes.herald_id 落值 + ambassador_tasks 同步，FK 保证一致） |
| B4 | 赫使 | 任务面板看到专属码/复制 | 码+统计（注册数/使用数/已赚） |
| B5 | 商家 | CSV 上传转化数据 | referral_records 落行；赫使统计更新 |
| B6 | 平台 | 转化结算 | 按 payout_per_herald×转化数结算；欠结算对赫使透明展示 |

## 旅程 C：商家成长线（额度/订阅）📝 待脚本化（原 pub_limit/subs 套件覆盖过，脚本已失传）

| # | 立场 | 用例 | 预期 |
|---|------|------|------|
| C1 | 商家 | 新注册（未KYB未充值）连发任务 | 第 BASE(3)+1 个被 402 OPEN_TASKS_LIMIT，提示升级路径 |
| C2 | 商家 | KYB 认证通过 | 上限升至 10；发布不再进平台审核 |
| C3 | 商家 | 累计充值 ≥30万 | funded 档，上限 20 |
| C4 | 商家 | 订阅营销顾问（下单→充值→扣款激活） | 发布不限；PAST_DUE 宽限期仍不限；EXPIRED 回落 |
| C5 | 商家 | 订阅续费/取消/到期 | 状态机 PENDING_PAYMENT→ACTIVE→PAST_DUE→EXPIRED；发票 HXS- 编号、VOID 替换 |
| C6 | 平台 | admin 特批单商家上限 | override 生效优先于档位 |

## 回归套件（技术专项，按需跑）

| 脚本 | 覆盖 | 断言数 |
|------|------|--------|
| `review_state_e2e.sh` | PENDING_REVIEW 状态机 + 报名审核契约 | 21 |
| `platform_req_e2e.sh` | 平台粉丝要求 ALL/ANY_N 资格闸 | 10 |
| `draft_stage_e2e.sh` | 草稿前置 stage 流转 + /applications/my 字段 + requirements 列退役 | 9 |
| `numeric_e2e.sh` | 金额 NUMERIC 迁移（typeParser/精确算术/SUM） | 8 |
| `kyb_e2e.sh` | KYB 流程：结构化提交/法人番号校验位/状态流转/过审免任务审核 | 12 |
| `referral_display_e2e.sh` | 邀请任务展示结构：conversion_criteria(JSONB)往返/PATCH/空convert | 10 |

## 共同约定

- 测试账号 `lcbrand00001`/`lcherald00xx` 前缀，脚本自种自清
- `lcbrand00001` 是共享 fixture 且有历史任务引用：清理段**不删** users/brand_profiles/wallets，只归零余额
- 断言失败 exit 非 0；`API=`/`DB=` 环境变量可覆盖目标
- 平台钱包有累计余额：涉平台入账的断言用**前后差值**，清理时回冲
