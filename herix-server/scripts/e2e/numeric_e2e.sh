#!/bin/zsh
# NUMERIC 迁移回归：typeParser(JSON number) / DB 算术精确 / 额度闸 SUM / 订阅扣款
set -u
API=${API:-http://localhost:4005/api}
DB=${DB:-postgres://localhost:5432/herix}
SRV="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1" }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1 — ${2:0:200}" }
assert_eq() { [ "$2" = "$3" ] && ok "$1" || bad "$1" "expect [$3] got [$2]" }
mktoken(){ (cd $SRV && node -e "
require('dotenv').config({quiet:true});
const jwt=require('jsonwebtoken');
console.log(jwt.sign({userId:process.argv[1],role:process.argv[2],roles:[process.argv[2]]},process.env.JWT_SECRET,{expiresIn:'2h'}));
" "$1" "$2" | tail -1) }

BID=lcbrand00001
psql $DB >/dev/null <<SQL
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$BID','__LC__brand@t.local','x','LC商家','BRAND','["BRAND"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lcbp00001','$BID','LC测试社','LC','1') ON CONFLICT DO NOTHING;
INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance)
VALUES ('lcwal00001','$BID','brand','JPY',100000.55) ON CONFLICT (id) DO NOTHING;
UPDATE wallets SET available_balance=100000.55, frozen_balance=0 WHERE id='lcwal00001';
SQL
TB=$(mktoken $BID BRAND)
TA=$(mktoken $(psql $DB -tAc "SELECT id FROM users WHERE email='admin@herix.com' LIMIT 1") ADMIN)

echo "— ① typeParser：API 金额必须是 JSON number（NUMERIC 默认返回字符串是最大坑）—"
R=$(curl -s $API/wallet/brand-balance -H "Authorization: Bearer $TB")
TYPECHK=$(echo $R | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d.get('available')
print(type(v).__name__ + ':' + str(v))")
assert_eq "available 是 number 且值精确" "$TYPECHK" "float:100000.55"

echo "— ② 任务创建/发布：payout NUMERIC 读回 + 额度闸 SUM 路径 —"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/uploads/tasks/e2e-cover.webp","title":"NUMERIC回归任务","description":"金额类型迁移回归测试任务描述内容","mode":"STANDARD",
  "payoutPerHerald":2500,"maxHeralds":3,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
[ -n "$TID" ] && ok "任务创建" || bad "任务创建" "empty"
PUB=$(curl -s -X PATCH $API/tasks/$TID/publish -H "Authorization: Bearer $TB")
[[ "$PUB" == *'"error"'* ]] && bad "发布(额度闸 SUM 比较)" "$PUB" || ok "发布成功(额度闸 SUM 比较正常)"
PAYOUT=$(curl -s $API/tasks/$TID -H "Authorization: Bearer $TB" | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d.get('payout_per_herald')
print(type(v).__name__ + ':' + str(v))")
[[ "$PAYOUT" == "int:2500" || "$PAYOUT" == "float:2500.0" ]] && ok "payout_per_herald 是 number ($PAYOUT)" || bad "payout 类型" "$PAYOUT"

echo "— ③ 订阅扣款：DB 侧减法精确（100000.55 - 60000.25 = 40000.30）—"
SUB=$(curl -s -X POST $API/admin/subscriptions -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d "{\"brandUserId\":\"$BID\",\"planCode\":\"custom\",\"billingCycle\":\"MONTHLY\",\"price\":60000.25,\"advisorNote\":\"numeric回归\"}" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$SUB" != ERR:* ]] && ok "admin 代开订阅" || bad "代开订阅" "$SUB"
ACT=$(curl -s -X POST $API/admin/subscriptions/$SUB/activate -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{}')
[[ "$ACT" == *ACTIVE* ]] && ok "扣款激活" || bad "扣款激活" "$ACT"
BAL=$(psql $DB -tAc "SELECT available_balance FROM wallets WHERE id='lcwal00001'")
assert_eq "扣款后余额 DB 精确值" "$BAL" "40000.30"

echo "— ④ SUM 聚合路径（publish-limit 的 TOPUP 求和读 NUMERIC SUM）—"
psql $DB >/dev/null <<SQL
INSERT INTO wallet_entries (id,wallet_id,type,amount,currency,note,created_at,idempotency_key,available_after,frozen_after)
VALUES ('lcwe_num1','lcwal00001','TOPUP',150000.10,'JPY','numeric回归',now()::text,'NUMTEST:1',0,0),
       ('lcwe_num2','lcwal00001','TOPUP',150000.15,'JPY','numeric回归',now()::text,'NUMTEST:2',0,0)
ON CONFLICT DO NOTHING;
SQL
FUNDED=$(curl -s $API/wallet/brand-balance -H "Authorization: Bearer $TB" | python3 -c "
import json,sys
d=json.load(sys.stdin)
pl=d.get('publishLimit') or {}
print(pl.get('funded'))")
assert_eq "累计充值 300000.25≥30万 → funded 档生效(SUM 返回 number 判定正确)" "$FUNDED" "True"

echo ""
echo "== 结果: $PASS 通过 / $FAIL 失败 =="

psql $DB >/dev/null <<SQL
DELETE FROM subscription_invoices WHERE subscription_id IN (SELECT id FROM merchant_subscriptions WHERE brand_user_id='$BID');
DELETE FROM merchant_subscriptions WHERE brand_user_id='$BID';
DELETE FROM notifications WHERE user_id='$BID';
DELETE FROM task_content_specs WHERE task_id='$TID';
DELETE FROM tasks WHERE id='$TID';
WITH doomed AS (
  SELECT we.id, we.wallet_id, we.amount FROM wallet_entries we
  WHERE we.type='SUBSCRIPTION_INCOME' AND we.idempotency_key IN (
    SELECT 'SUBINC:'||si.id FROM subscription_invoices si)
) DELETE FROM wallet_entries WHERE id IN (SELECT id FROM doomed);
DELETE FROM wallet_entries WHERE wallet_id='lcwal00001' OR idempotency_key LIKE 'NUMTEST:%';
-- lcbrand00001 是共享测试账号且有历史 COMPLETED 任务引用，不删 users/brand_profiles/wallets（余额归零即可）
UPDATE wallets SET available_balance=0, frozen_balance=0 WHERE id='lcwal00001';
SQL
echo "测试数据已清理"
exit $FAIL
