# 任务全生命周期本地测试方案（内容创作 + 邀请码激励）

> 2026-07-25 制定。目标：在本地环境验证两种任务类型从创建到完成的完整链路
> （含 P0 数据终态 + P1 提取器/提交闸机）。**执行者请严格照单执行,逐步记录
> 实际结果 vs 预期**。
>
> ## 执行者守则
> 1. **只测试、不修复**：任何断言失败,原样记录（步骤号、命令、完整响应）,继续
>    能继续的步骤,最后汇总报告。不要自行改架构/改业务代码。
> 2. 唯一允许的修复：你自己敲错的命令。
> 3. 不要 push、不要部署、不要动 `ui samples/` 目录和别的会话的在途文件。
> 4. 测试数据一律用 `__LC__` 前缀,结束后按第 9 节清理。

## 0. 环境与工具

- 本地服务：`http://localhost:4005`（launchd 常驻;若不通,`launchctl kickstart -k gui/$(id -u)/com.herix.server` 后等 6 秒）
- DB：`psql postgres://localhost:5432/herix`
- 造 token（在 `herix-server/` 目录下运行,后续所有步骤复用此模式）：

```bash
cd /Users/gabrielg/Herix/herix-server && node -e "
require('dotenv').config();
const jwt=require('jsonwebtoken');
console.log(jwt.sign({userId:process.argv[1],role:process.argv[2],roles:[process.argv[2]]},process.env.JWT_SECRET,{expiresIn:'2h'}));
" <用户ID> <角色>
```

## 1. 准备测试账号（SQL 直造,幂等）

```sql
-- 商家（干净:无任务、无体验额度记录、钱包 0）
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('lcbrand00001','__LC__brand@t.local','x','LC商家','BRAND','["BRAND"]',now()::text,now()::text)
ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lcbp00001','lcbrand00001','LC测试社','LC','1') ON CONFLICT DO NOTHING;
-- 赫使
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('lcherald0001','__LC__herald@t.local','x','LC赫使','HERALD','["HERALD"]',now()::text,now()::text)
ON CONFLICT (id) DO NOTHING;
INSERT INTO herald_profiles (id,user_id,display_name)
VALUES ('lchp00001','lcherald0001','LC赫使') ON CONFLICT DO NOTHING;
```

- admin 用现成的：`SELECT id FROM users WHERE email='admin@herix.com';`
- 造 3 个 token：BRAND(lcbrand00001)、HERALD(lcherald0001)、ADMIN。

## 2. 终态数据层前置断言（一次性）

```sql
-- 预期:空(8个旧列已从主表 DROP)
SELECT column_name FROM information_schema.columns WHERE table_name='tasks'
AND column_name IN ('content_type','min_images','min_video_seconds','max_revisions',
                    'require_proposal','submit_deadline','code_mode','data_mode');
```

---

## 3. 流程 A：内容创作（STANDARD）

| # | 操作 | 命令要点 | 预期 |
|---|------|---------|------|
| A1 | 创建草稿 | `POST /api/tasks`（BRAND token）body: `{"title":"LC内容任务","description":"全流程测试简报正文十个字以上","category":"其他","mode":"STANDARD","payoutPerHerald":1000,"maxHeralds":1,"minImages":2,"maxRevisions":1,"contentType":"photo"}` | 201;响应含 `content_type:"photo"`、`min_images:2`;记下 `id` → **TASK_A** |
| A2 | spec 落表 | `SELECT * FROM task_content_specs WHERE task_id='<TASK_A>';` | 1 行,min_images=2 |
| A3 | 发布(体验额度) | `PATCH /api/tasks/<TASK_A>/publish` body `{}` | 200;`reviewPending:true`(商家未KYB);DB `tasks.trial_credit_amount>0`、`brand_profiles.trial_task_id='<TASK_A>'` |
| A4 | 负例:第二单被拦 | 再建一个同 body 草稿并 publish | publish 返回 **402 INSUFFICIENT_CREDIT**(体验额度只给首单);该草稿留着,第 9 节清理 |
| A5 | 平台任务审核 | `GET /api/admin/task-reviews`(ADMIN)找到 TASK_A → `POST /api/admin/task-reviews/<TASK_A>/approve` | 200;`tasks.platform_review='approved'` |
| A6 | 赫使报名 | `POST /api/applications/<TASK_A>`(HERALD)body `{}` | 201;记下报名 `id` → **APP_A** |
| A7 | 商家批准报名 | `PATCH /api/applications/<APP_A>/review`(BRAND)body `{"status":"APPROVED"}` | 200(容量走体验额度);maxHeralds=1 满员 → `tasks.status` 变 `COMPLETED`(自动关闭招募,属预期) |
| A8 | 负例:提交闸机 | `POST /api/submissions/<TASK_A>`(HERALD)body `{"contentUrl":"https://example.com/p/1","screenshotUrls":["a.jpg"]}` | **400 MIN_IMAGES_NOT_MET**,`required:2, got:1` |
| A9 | 正例提交 | 同上但 `"screenshotUrls":["a.jpg","b.jpg"]` | 201;记下提交 `id` → **SUB_A** |
| A10 | 负例:余额不足审核 | `PATCH /api/submissions/<SUB_A>/review`(BRAND)body `{"status":"APPROVED"}` | 报错含「余额不足,需 ¥1250」(1000报酬+25%费?以实际数为准记录);herald 钱包不变;**体验额度不垫结算,此为设计行为** |
| A11 | 注资 | `INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance) VALUES ('lcwal00001','lcbrand00001','brand','JPY',50000) ON CONFLICT DO NOTHING; UPDATE wallets SET available_balance=50000 WHERE id='lcwal00001';` | — |
| A12 | 审核通过→结算 | 重发 A10 命令 | 200;断言:①herald 钱包 `available_balance=1000` ②`task_transactions` 有 `TASK_RELEASE` 行 ③商家钱包扣了 cost(记录具体数) |
| A13 | 评分收尾 | `POST /api/submissions/<SUB_A>/rate`(BRAND)body `{"score":5,"comment":"LC测试好评"}` | 200/201;重复再发一次 → 409 已评分 |

## 4. 流程 B：邀请码激励（PERFORMANCE）

| # | 操作 | 命令要点 | 预期 |
|---|------|---------|------|
| B1 | 创建 | `POST /api/tasks`(BRAND)body: `{"title":"LC邀请码任务","description":"全流程测试简报正文十个字以上","category":"其他","mode":"PERFORMANCE","payoutPerHerald":200,"maxHeralds":2,"dataMode":"AGGREGATE"}` | 201;响应 `code_mode:"auto"`、`data_mode:"AGGREGATE"` → **TASK_B** |
| B2 | spec+码池 | `SELECT * FROM task_referral_specs WHERE task_id='<TASK_B>'; SELECT count(*) FROM task_promo_codes WHERE task_id='<TASK_B>';` | spec 1 行;码池 **2** 个(=maxHeralds,auto 模式建刻生成) |
| B3 | 发布 | publish + admin 审核(同 A3/A5;注意:PERFORMANCE **不占额度**,即使 A 已用掉体验额度也应 200) | 200 |
| B4 | 报名+批准 | 同 A6/A7 | 批准后 `ambassador_tasks` 有 1 行,`unique_code` 来自码池;`task_promo_codes` 对应行 `herald_id` 已填 |
| B5 | 发布时的成本快照 | `SELECT payout_per_herald, cost_per_herald FROM tasks WHERE id='<TASK_B>';` | cost_per_herald ≥ payout(含服务费),记录实际值 → 单次转化结算额 |
| B6 | CSV 汇总上传 | `POST /api/tasks/<TASK_B>/csv`(BRAND)body: `{"records":[{"code":"<B4的unique_code>","registered_count":5,"used_count":3}]}` | 200;断言:①`ambassador_tasks` 该行 registered=5/used=3 ②herald 钱包 **+3×200=600**(在 A12 的 1000 之上,共 1600) ③`referral_records`/流水有结算痕迹 |
| B7 | **幂等关键断言** | 一字不改重发 B6 | 200;herald 钱包**不变**(增量结算,重传不重付);记录响应里的计数字段 |
| B8 | 增量上传 | 同 B6 但 `used_count:4` | herald 钱包 **+200**(只结增量 1 次) |
| B9 | 关闭任务 | `PATCH /api/tasks/<TASK_B>/complete`(BRAND) | 200;`status='COMPLETED'`;herald 收到 TASK_CLOSING 通知(`notifications` 表) |
| B10 | 缓冲期收数 | 关闭后立刻重发 B6(used_count:5) | 200(30 天缓冲期内仍收数),钱包 +200 |

## 5. 提取器功能点（纯前端逻辑,node 直测）

```bash
cd /Users/gabrielg/Herix/herix-server && npx tsx -e "
import { extractBrief } from '../herix-merchant/src/lib/extract';
const hits = extractBrief('找在日华人博主,粉丝1000+\n图片3张以上\n视频超过30秒\n8月10日之前交稿\n改稿3次以内','STANDARD');
console.log(hits.map(h=>h.field+':'+JSON.stringify(h.patch)).join('\n'));"
```
预期 6 项：targetCommunities(cn-in-jp) / minImages:3 / minVideoSeconds:30 / maxRevisions:3 / contentType / submitDeadline(8-10)。

## 6. UI 走查（可选,10 分钟）

vite 已在 5174(用户自己起的)。浏览器打开,用 `__BPTEST__o@t.local` / `Login-Test-2026` 登录:
1. 创建任务 → 应先见**整屏两张类型卡**(📝内容创作/🔗邀请码激励)
2. 选内容创作 → 表单顺序应为:简报→找谁→内容要求→时间线→报酬与质量(1-5 编号)
3. 简报里粘贴第 5 节那段文本 → 点「识别简报,自动填表」→ 面板列出识别项 → 一键应用 → 下方字段被填
4. 任务详情页 → 有「复制为新任务」按钮 → 点击后表单预填但日期为空

## 7. 已知设计行为（不是 bug,勿报）

- A7 批准满员后任务自动 COMPLETED — 名额满即关招募
- A10 余额不足时审核被拦 — 体验额度只管发布,结算必须真金白银
- 视频时长不校验 — 内容是外链,拿不到元数据
- PERFORMANCE 发布不占额度 — 按转化后结算
- `requirements` 列仍在(存量兼容),新任务只写 description

## 8. 汇总报告格式

按步骤号列表：`A1 ✅` / `A8 ❌ 预期400实际201,响应:<原文>`。附:发现的疑似 bug 单独一节,只描述现象与复现命令,不给修复。

## 9. 清理

```sql
DELETE FROM task_ratings WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM task_transactions WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM referral_records WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM ambassador_tasks WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM task_promo_codes WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM task_submissions WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM task_applications WHERE task_id IN (SELECT id FROM tasks WHERE creator_id='lcbrand00001');
DELETE FROM notifications WHERE user_id IN ('lcbrand00001','lcherald0001');
DELETE FROM wallet_entries WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id IN ('lcbrand00001','lcherald0001'));
DELETE FROM tasks WHERE creator_id='lcbrand00001';
DELETE FROM wallets WHERE user_id IN ('lcbrand00001','lcherald0001');
DELETE FROM brand_profiles WHERE user_id='lcbrand00001';
DELETE FROM herald_profiles WHERE user_id='lcherald0001';
DELETE FROM users WHERE id IN ('lcbrand00001','lcherald0001');
```
