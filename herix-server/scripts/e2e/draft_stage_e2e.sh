#!/bin/zsh
# 草稿前置流程 e2e：/applications/my 字段 + 各 stage 下 /submissions/my 数据形状
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

BID=lcbrand00001; HID=lcherald0009
psql $DB >/dev/null <<SQL
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$BID','__LC__brand@t.local','x','LC商家','BRAND','["BRAND"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$HID','__LC__h9@t.local','x','草稿测试赫使','HERALD','["HERALD"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lcbp00001','$BID','LC测试社','LC','1') ON CONFLICT DO NOTHING;
INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance)
VALUES ('lcwal00001','$BID','brand','JPY',500000) ON CONFLICT (id) DO NOTHING;
UPDATE wallets SET available_balance=500000 WHERE id='lcwal00001';
SQL
TB=$(mktoken $BID BRAND); TH=$(mktoken $HID HERALD)
TA=$(mktoken $(psql $DB -tAc "SELECT id FROM users WHERE email='admin@herix.com' LIMIT 1") ADMIN)

echo "— 建草稿前置任务 + 审核报名 —"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "title":"草稿e2e任务","description":"验证草稿前置流程端到端测试任务描述","mode":"STANDARD",
  "payoutPerHerald":2500,"maxHeralds":3,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC","requireDraftReview":true}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
curl -s -X PATCH $API/tasks/$TID/publish -H "Authorization: Bearer $TB" >/dev/null
curl -s -X POST $API/admin/task-reviews/$TID/approve -H "Authorization: Bearer $TA" >/dev/null
APPID=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
curl -s -X PATCH $API/applications/$APPID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' >/dev/null

echo "— /applications/my 字段（payout + require_draft_review）—"
MY=$(curl -s $API/applications/my -H "Authorization: Bearer $TH")
assert_eq "payout_per_herald 正确返回" "$(echo $MY | python3 -c "import json,sys;d=json.load(sys.stdin);r=[x for x in d if x['task_id']=='$TID'][0];print(int(r.get('payout_per_herald')))")" "2500"
assert_eq "require_draft_review 正确返回" "$(echo $MY | python3 -c "import json,sys;d=json.load(sys.stdin);r=[x for x in d if x['task_id']=='$TID'][0];print(r.get('require_draft_review'))")" "1"

echo "— 阶段1：提交草稿 —"
curl -s -X POST $API/submissions/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"description":"草稿脚本文字内容","screenshotUrls":["https://x/1.jpg"]}' >/dev/null
ROW=$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE task_id='$TID' AND herald_id='$HID'")
assert_eq "首次提交落 DRAFT+PENDING_REVIEW" "$ROW" "DRAFT|PENDING_REVIEW"
STAGE=$(curl -s $API/submissions/my -H "Authorization: Bearer $TH" | python3 -c "import json,sys;d=json.load(sys.stdin);r=[x for x in d if x['task_id']=='$TID'][0];print(r['stage']+'|'+r['status']+'|'+str(r['require_draft_review']))")
assert_eq "/submissions/my 回显 DRAFT|PENDING_REVIEW|1" "$STAGE" "DRAFT|PENDING_REVIEW|1"

echo "— 草稿通过 → 仍是 DRAFT（不算完成）—"
SUBID=$(psql $DB -tAc "SELECT id FROM task_submissions WHERE task_id='$TID' AND herald_id='$HID'")
curl -s -X PATCH $API/submissions/$SUBID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' >/dev/null
assert_eq "草稿通过后 DRAFT+APPROVED" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "DRAFT|APPROVED"

echo "— 阶段2：终稿 flip 同一行 —"
curl -s -X POST $API/submissions/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"contentUrls":["https://xhs/final-post"]}' >/dev/null
assert_eq "终稿提交后 FINAL+PENDING_REVIEW" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "FINAL|PENDING_REVIEW"
assert_eq "全程只有1行" "$(psql $DB -tAc "SELECT count(*) FROM task_submissions WHERE task_id='$TID' AND herald_id='$HID'")" "1"

echo "— 终稿通过 → 真正完成 —"
curl -s -X PATCH $API/submissions/$SUBID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' >/dev/null
assert_eq "终稿通过 FINAL+APPROVED" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "FINAL|APPROVED"

echo ""
echo "== 结果: $PASS 通过 / $FAIL 失败 =="

# 终稿通过触发结算：herald 钱包/账本/task_transactions 都要清；共享 brand fixture 不删
psql $DB >/dev/null <<SQL
DELETE FROM submission_revisions WHERE task_id='$TID';
DELETE FROM notifications WHERE user_id IN ('$BID','$HID');
DELETE FROM wallet_entries WHERE reference_id IN (SELECT id FROM task_transactions WHERE task_id='$TID');
DELETE FROM task_transactions WHERE task_id='$TID';
DELETE FROM task_submissions WHERE task_id='$TID';
DELETE FROM task_applications WHERE task_id='$TID';
DELETE FROM task_content_specs WHERE task_id='$TID';
DELETE FROM tasks WHERE id='$TID';
DELETE FROM wallet_entries WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id='$HID');
DELETE FROM wallets WHERE user_id='$HID';
DELETE FROM herald_profiles WHERE user_id='$HID';
DELETE FROM users WHERE id='$HID';
UPDATE wallets SET available_balance=0 WHERE id='lcwal00001';
SQL
echo "测试数据已清理"
exit $FAIL
