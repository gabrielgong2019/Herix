#!/bin/zsh
# PENDING_REVIEW 真状态 + 报名契约 全流程 e2e
# 覆盖：发布→PENDING_REVIEW→赫使不可见/不可报名→admin approve→OPEN+published_at刷新
#      →报名→商家通知→GET /tasks/:id/applications→PATCH /applications/:id/review→审核拒绝退回草稿
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

BID=lcbrand00001; HID=lcherald0001
psql $DB >/dev/null <<SQL
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$BID','__LC__brand@t.local','x','LC商家','BRAND','["BRAND"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$HID','__LC__herald@t.local','x','LC赫使','HERALD','["HERALD"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lcbp00001','$BID','LC测试社','LC','1') ON CONFLICT DO NOTHING;
INSERT INTO herald_profiles (id,user_id,display_name)
VALUES ('lchp00001','$HID','LC赫使') ON CONFLICT DO NOTHING;
INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance)
VALUES ('lcwal00001','$BID','brand','JPY',500000) ON CONFLICT (id) DO NOTHING;
UPDATE wallets SET available_balance=500000 WHERE id='lcwal00001';
SQL
TB=$(mktoken $BID BRAND); TH=$(mktoken $HID HERALD)
TA=$(mktoken $(psql $DB -tAc "SELECT id FROM users WHERE email='admin@herix.com' LIMIT 1") ADMIN)

echo "— 阶段1：发布 → PENDING_REVIEW —"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/uploads/tasks/e2e-cover.webp","title":"契约e2e任务","description":"这是一个契约修复端到端测试任务描述","mode":"STANDARD",
  "payoutPerHerald":3000,"maxHeralds":2,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC"}' | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$TID" != ERR:* ]] && ok "任务创建 $TID" || { bad "任务创建" "$TID"; exit 1 }
PUB=$(curl -s -X PATCH $API/tasks/$TID/publish -H "Authorization: Bearer $TB")
[[ "$PUB" == *'"error"'* ]] && bad "发布" "$PUB" || ok "发布成功"
ST=$(psql $DB -tAc "SELECT status FROM tasks WHERE id='$TID'")
assert_eq "未KYB商家发布后 status=PENDING_REVIEW" "$ST" "PENDING_REVIEW"
PUB_AT1=$(psql $DB -tAc "SELECT published_at FROM tasks WHERE id='$TID'")

echo "— 阶段2：审核期不可见/不可报名 —"
CODE=$(curl -s -o /dev/null -w "%{http_code}" $API/tasks/$TID -H "Authorization: Bearer $TH")
assert_eq "赫使看详情 404" "$CODE" "404"
CODE=$(curl -s -o /dev/null -w "%{http_code}" $API/tasks/$TID)
assert_eq "匿名看详情 404" "$CODE" "404"
INLIST=$(curl -s "$API/tasks" -H "Authorization: Bearer $TH" | python3 -c "import json,sys;d=json.load(sys.stdin);print(any(t['id']=='$TID' for t in d['tasks']))")
assert_eq "公开列表不含待审任务" "$INLIST" "False"
APPLY=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"message":"想参加"}' -o /dev/null -w "%{http_code}")
assert_eq "审核期报名被拒 400" "$APPLY" "400"
OWNER=$(curl -s $API/tasks/$TID -H "Authorization: Bearer $TB" | python3 -c "import json,sys;print(json.load(sys.stdin).get('status',''))")
assert_eq "创建者自己可见" "$OWNER" "PENDING_REVIEW"
QN=$(curl -s $API/admin/task-reviews -H "Authorization: Bearer $TA" | python3 -c "import json,sys;print(any(r['id']=='$TID' for r in json.load(sys.stdin)))")
assert_eq "admin 审核队列含该任务" "$QN" "True"
SLOT=$(curl -s $API/wallet/brand-balance -H "Authorization: Bearer $TB" | python3 -c "import json,sys;d=json.load(sys.stdin)['publishLimit'];print(d.get('current','?'))")
assert_eq "待审任务占用发布名额" "$SLOT" "1"

echo "— 阶段3：admin 审核通过 → OPEN —"
sleep 1
AP=$(curl -s -X POST $API/admin/task-reviews/$TID/approve -H "Authorization: Bearer $TA" -o /dev/null -w "%{http_code}")
assert_eq "approve 200" "$AP" "200"
ST=$(psql $DB -tAc "SELECT status||'|'||platform_review FROM tasks WHERE id='$TID'")
assert_eq "过审后 OPEN+approved" "$ST" "OPEN|approved"
PUB_AT2=$(psql $DB -tAc "SELECT published_at FROM tasks WHERE id='$TID'")
[ "$PUB_AT2" != "$PUB_AT1" ] && ok "published_at 刷新为进入公开时间" || bad "published_at 刷新" "unchanged"
CODE=$(curl -s -o /dev/null -w "%{http_code}" $API/tasks/$TID -H "Authorization: Bearer $TH")
assert_eq "过审后赫使可见 200" "$CODE" "200"

echo "— 阶段4：报名 → 商家通知 + 报名列表/审核契约 —"
APPLY=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"message":"想参加"}')
APPID=$(echo $APPLY | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$APPID" != ERR:* ]] && ok "报名成功" || bad "报名" "$APPID"
NOTIF=$(psql $DB -tAc "SELECT count(*) FROM notifications WHERE user_id='$BID' AND type='NEW_APPLICATION' AND metadata LIKE '%$TID%'")
assert_eq "商家收到 NEW_APPLICATION 通知" "$NOTIF" "1"
LIST=$(curl -s $API/tasks/$TID/applications -H "Authorization: Bearer $TB" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'ERR:'+str(d))")
assert_eq "GET /tasks/:id/applications 返回1条" "$LIST" "1"
CODE=$(curl -s -o /dev/null -w "%{http_code}" $API/tasks/$TID/applications -H "Authorization: Bearer $TH")
assert_eq "非创建者拉报名列表 403" "$CODE" "403"
RV=$(curl -s -X PATCH $API/applications/$APPID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('status',''))")
assert_eq "商家审核通过报名" "$RV" "APPROVED"

echo "— 阶段5：审核拒绝路径 —"
TID2=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/uploads/tasks/e2e-cover.webp","title":"契约e2e拒绝任务","description":"这是审核拒绝路径的端到端测试任务","mode":"STANDARD",
  "payoutPerHerald":3000,"maxHeralds":1,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
curl -s -X PATCH $API/tasks/$TID2/publish -H "Authorization: Bearer $TB" >/dev/null
RJ=$(curl -s -X POST $API/admin/task-reviews/$TID2/reject -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{"reason":"测试拒绝"}' -o /dev/null -w "%{http_code}")
assert_eq "reject 200" "$RJ" "200"
ST=$(psql $DB -tAc "SELECT status||'|'||platform_review FROM tasks WHERE id='$TID2'")
assert_eq "被拒退回 DRAFT+rejected" "$ST" "DRAFT|rejected"

echo ""
echo "== 结果: $PASS 通过 / $FAIL 失败 =="

# lcbrand00001/lcherald0001 是共享 fixture 且可能被历史任务引用，不删 users/profiles/wallets
psql $DB >/dev/null <<SQL
DELETE FROM notifications WHERE user_id IN ('$BID','$HID');
DELETE FROM task_applications WHERE task_id IN ('$TID','$TID2');
DELETE FROM task_content_specs WHERE task_id IN ('$TID','$TID2');
DELETE FROM task_referral_specs WHERE task_id IN ('$TID','$TID2');
DELETE FROM tasks WHERE id IN ('$TID','$TID2');
UPDATE wallets SET available_balance=0 WHERE id='lcwal00001';
SQL
echo "测试数据已清理"
exit $FAIL
