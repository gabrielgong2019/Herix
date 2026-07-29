# e2e 测试套件

**全部只打本机**（`localhost:4005` + 本机 PG `localhost:5432/herix`），不碰生产。
运行前置：本地 herix-server 在跑（launchd，端口 4005）。

```bash
zsh herix-server/scripts/e2e/review_state_e2e.sh   # 审核状态机+报名契约 21 断言
zsh herix-server/scripts/e2e/platform_req_e2e.sh   # 平台粉丝要求 ALL/ANY_N 10 断言
zsh herix-server/scripts/e2e/draft_stage_e2e.sh    # 草稿前置流程 8 断言
zsh herix-server/scripts/e2e/numeric_e2e.sh        # 金额 NUMERIC 迁移回归 8 断言
```

约定：
- 测试账号统一 `lcbrand00001` / `lcherald000x` 前缀，脚本自种自清
- `lcbrand00001` 是跨脚本共享 fixture 且有历史任务引用，清理段**不删 users/brand_profiles**
- 断言失败脚本 exit 非 0，可串进 CI
- 環境变量可覆盖：`API=... DB=... zsh xxx.sh`

历史欠账（脚本曾存 scratchpad 被会话轮换清掉，内容已不可恢复，碰到对应模块时重建）：
- subs_e2e（订阅全生命周期 39 断言）
- pub_limit_e2e（发布并发闸四级阶梯 19 断言）
- p1_e2e（两阶段交付+双向计时器+仲裁 32 断言）
