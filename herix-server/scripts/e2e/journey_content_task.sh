#!/bin/zsh
# 旅程A：内容任务全生命周期（商家↔赫使 两端立场交替）
# 商家建任务(草稿前置+平台要求)→发布过审→赫使资格校验→报名→商家审报名
# →赫使交草稿→商家拒→重提→过→交终稿→商家过→结算三方对账→通知链
# 全部只打本机。用例文档见同目录 TEST_CASES.md 旅程A。
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
jget(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)" 2>/dev/null }

BID=lcbrand00001; HID=lcherald0010
psql $DB >/dev/null <<SQL
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$BID','__LC__brand@t.local','x','LC商家','BRAND','["BRAND"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$HID','__LC__h10@t.local','x','旅程赫使','HERALD','["HERALD"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lcbp00001','$BID','LC测试社','LC','1') ON CONFLICT DO NOTHING;
INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance)
VALUES ('lcwal00001','$BID','brand','JPY',500000) ON CONFLICT (id) DO NOTHING;
UPDATE wallets SET available_balance=500000, frozen_balance=0 WHERE id='lcwal00001';
SQL
TB=$(mktoken $BID BRAND); TH=$(mktoken $HID HERALD)
TA=$(mktoken $(psql $DB -tAc "SELECT id FROM users WHERE email='admin@herix.com' LIMIT 1") ADMIN)
P0=$(psql $DB -tAc "SELECT COALESCE(available_balance,0) FROM wallets WHERE user_id='HERIX_PLATFORM' AND wallet_type='platform'")

echo "═══ A1 [商家] 创建任务（草稿前置 + Instagram≥5000）→ 发布 → 待平台审核 ═══"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "title":"旅程A内容任务","description":"内容任务全生命周期旅程测试任务描述","mode":"STANDARD",
  "payoutPerHerald":3000,"maxHeralds":2,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC","requireDraftReview":true,
  "platformRequirements":[{"platformId":"instagram","minFollowers":5000,"required":true}],"reqMode":"ALL"
  }' | jget "['id']")
[ -n "$TID" ] && ok "A1.1 任务创建" || { bad "A1.1 任务创建" "empty"; exit 1 }
curl -s -X PATCH $API/tasks/$TID/publish -H "Authorization: Bearer $TB" >/dev/null
assert_eq "A1.2 发布后进平台审核(PENDING_REVIEW)" "$(psql $DB -tAc "SELECT status FROM tasks WHERE id='$TID'")" "PENDING_REVIEW"

echo "═══ A2 [赫使] 审核期不可见 ═══"
assert_eq "A2.1 探索列表不含该任务" "$(curl -s "$API/tasks" -H "Authorization: Bearer $TH" | python3 -c "import json,sys;d=json.load(sys.stdin);print(any(t['id']=='$TID' for t in d['tasks']))")" "False"
assert_eq "A2.2 直链 404" "$(curl -s -o /dev/null -w "%{http_code}" $API/tasks/$TID -H "Authorization: Bearer $TH")" "404"

echo "═══ A3 [平台] admin 审核通过 → 公开 ═══"
curl -s -X POST $API/admin/task-reviews/$TID/approve -H "Authorization: Bearer $TA" >/dev/null
assert_eq "A3.1 过审后 OPEN" "$(psql $DB -tAc "SELECT status FROM tasks WHERE id='$TID'")" "OPEN"
assert_eq "A3.2 赫使可见 200" "$(curl -s -o /dev/null -w "%{http_code}" $API/tasks/$TID -H "Authorization: Bearer $TH")" "200"

echo "═══ A4 [赫使] 无平台账号报名被资格闸拦下 ═══"
R=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"message":"我想参加"}')
assert_eq "A4.1 无档案报名 REQUIREMENTS_NOT_MET" "$(echo $R | jget "['code']")" "REQUIREMENTS_NOT_MET"

echo "═══ A5 [赫使] 完善档案（IG 8000粉）→ 报名成功 ═══"
curl -s -X PATCH $API/ambassador/profile -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{
  "displayName":"旅程赫使","socialPlatforms":[{"platformId":"instagram","url":"https://instagram.com/journey","followers":8000}]}' >/dev/null
APPID=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"message":"我有IG八千粉，想参加"}' | jget "['id']")
[ -n "$APPID" ] && ok "A5.1 达标后报名成功" || bad "A5.1 报名" "empty"

echo "═══ A6 [商家] 收到通知 → 审核队列见报名 → 通过 ═══"
assert_eq "A6.1 商家收到 NEW_APPLICATION" "$(psql $DB -tAc "SELECT count(*) FROM notifications WHERE user_id='$BID' AND type='NEW_APPLICATION' AND metadata LIKE '%$TID%'")" "1"
assert_eq "A6.2 报名待审汇总可见" "$(curl -s $API/applications/pending -H "Authorization: Bearer $TB" | python3 -c "import json,sys;print(any(a['id']=='$APPID' for a in json.load(sys.stdin)))")" "True"
assert_eq "A6.3 通过报名(过额度闸)" "$(curl -s -X PATCH $API/applications/$APPID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' | jget "['status']")" "APPROVED"

echo "═══ A7 [赫使] 收到报名通过 → 提交草稿 ═══"
assert_eq "A7.1 赫使收到 APP_APPROVED" "$(psql $DB -tAc "SELECT count(*) FROM notifications WHERE user_id='$HID' AND type='APP_APPROVED'")" "1"
assert_eq "A7.2 /applications/my 带草稿前置标记" "$(curl -s $API/applications/my -H "Authorization: Bearer $TH" | python3 -c "import json,sys;d=json.load(sys.stdin);print([x for x in d if x['task_id']=='$TID'][0]['require_draft_review'])")" "1"
curl -s -X POST $API/submissions/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"description":"草稿：开箱视频脚本第一版","screenshotUrls":["https://x/draft1.jpg"]}' >/dev/null
SUBID=$(psql $DB -tAc "SELECT id FROM task_submissions WHERE task_id='$TID' AND herald_id='$HID'")
assert_eq "A7.3 首提落 DRAFT+PENDING_REVIEW" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "DRAFT|PENDING_REVIEW"

echo "═══ A8 [商家] 拒绝草稿（给原因）═══"
curl -s -X PATCH $API/submissions/$SUBID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"REJECTED","reviewNote":"图片模糊，请重拍"}' >/dev/null
assert_eq "A8.1 草稿被拒 DRAFT+REJECTED" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "DRAFT|REJECTED"
assert_eq "A8.2 拒绝原因可回读" "$(psql $DB -tAc "SELECT review_note FROM task_submissions WHERE id='$SUBID'")" "图片模糊，请重拍"

echo "═══ A9 [赫使] 修改后重提草稿（同一单据）═══"
curl -s -X POST $API/submissions/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"description":"草稿：重拍高清版","screenshotUrls":["https://x/draft2.jpg"]}' >/dev/null
assert_eq "A9.1 重提回到 DRAFT+PENDING_REVIEW" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "DRAFT|PENDING_REVIEW"
assert_eq "A9.2 全程单据只有1行" "$(psql $DB -tAc "SELECT count(*) FROM task_submissions WHERE task_id='$TID' AND herald_id='$HID'")" "1"

echo "═══ A10 [商家] 通过草稿（≠任务完成）═══"
curl -s -X PATCH $API/submissions/$SUBID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' >/dev/null
assert_eq "A10.1 草稿过 DRAFT+APPROVED（不是FINAL）" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "DRAFT|APPROVED"

echo "═══ A11 [赫使] 发布内容 → 提交终稿链接 ═══"
curl -s -X POST $API/submissions/$TID -H "Authorization: Bearer $TH" -H 'Content-Type: application/json' -d '{"contentUrls":["https://instagram.com/p/journey-final"],"screenshotUrls":["https://x/final.jpg"]}' >/dev/null
assert_eq "A11.1 终稿同行 flip 到 FINAL+PENDING_REVIEW" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "FINAL|PENDING_REVIEW"

echo "═══ A12 [商家] 通过终稿 → 结算三方对账 ═══"
COST=$(psql $DB -tAc "SELECT cost_per_herald FROM tasks WHERE id='$TID'")
curl -s -X PATCH $API/submissions/$SUBID/review -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}' >/dev/null
assert_eq "A12.1 终稿 FINAL+APPROVED" "$(psql $DB -tAc "SELECT stage||'|'||status FROM task_submissions WHERE id='$SUBID'")" "FINAL|APPROVED"
assert_eq "A12.2 商家扣款 = cost_per_herald" "$(psql $DB -tAc "SELECT available_balance FROM wallets WHERE id='lcwal00001'")" "$(psql $DB -tAc "SELECT 500000 - $COST")"
assert_eq "A12.3 赫使入账 = payout(3000)" "$(psql $DB -tAc "SELECT available_balance FROM wallets WHERE user_id='$HID' AND wallet_type='herald'")" "3000.00"
FEE=$(psql $DB -tAc "SELECT $COST - 3000")
P1=$(psql $DB -tAc "SELECT available_balance FROM wallets WHERE user_id='HERIX_PLATFORM' AND wallet_type='platform'")
assert_eq "A12.4 平台佣金入账 = cost - payout" "$(psql $DB -tAc "SELECT $P1 - $P0")" "$FEE"
assert_eq "A12.5 task_transactions 落 TASK_RELEASE 事件" "$(psql $DB -tAc "SELECT count(*) FROM task_transactions WHERE task_id='$TID' AND type='TASK_RELEASE' AND status='completed'")" "1"
assert_eq "A12.6 三方账本幂等键齐备(SETTLE/CREDIT/FEE)" "$(psql $DB -tAc "SELECT count(*) FROM wallet_entries WHERE idempotency_key LIKE 'SETTLE:%' AND note LIKE '%旅程A%' OR idempotency_key LIKE 'CREDIT:%' AND note LIKE '%旅程A%' OR idempotency_key LIKE 'FEE:%' AND note LIKE '%服务费%' AND reference_id IN (SELECT id FROM task_transactions WHERE task_id='$TID')")" "3"

echo "═══ A13 [赫使] 收到结算通知 ═══"
assert_eq "A13.1 赫使收到 SUB_APPROVED" "$(psql $DB -tAc "SELECT count(*) FROM notifications WHERE user_id='$HID' AND type='SUB_APPROVED'")" "1"

echo ""
echo "== 旅程A 结果: $PASS 通过 / $FAIL 失败 =="

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
UPDATE wallets SET available_balance = available_balance - ($P1 - $P0) WHERE user_id='HERIX_PLATFORM' AND wallet_type='platform';
UPDATE wallets SET available_balance=0 WHERE id='lcwal00001';
SQL
echo "测试数据已清理（含平台佣金回冲）"
exit $FAIL
