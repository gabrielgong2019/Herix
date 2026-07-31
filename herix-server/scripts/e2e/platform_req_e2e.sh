#!/bin/zsh
# 平台要求 e2e：商家设置 platformRequirements → 赫使报名资格校验（ALL + ANY_N 两种模式）
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

BID=lcbrand00001; H_NONE=lcherald0001; H_LOW=lcherald0002; H_OK=lcherald0003
psql $DB >/dev/null <<SQL
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$BID','__LC__brand@t.local','x','LC商家','BRAND','["BRAND"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$H_NONE','__LC__h1@t.local','x','无平台赫使','HERALD','["HERALD"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$H_LOW','__LC__h2@t.local','x','粉丝不足赫使','HERALD','["HERALD"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$H_OK','__LC__h3@t.local','x','达标赫使','HERALD','["HERALD"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lcbp00001','$BID','LC测试社','LC','1') ON CONFLICT DO NOTHING;
INSERT INTO herald_profiles (id,user_id,display_name,social_platforms) VALUES
  ('lchp0001','$H_NONE','无平台', '[]'),
  ('lchp0002','$H_LOW','粉丝不足', '[{"platformId":"instagram","followers":1000}]'),
  ('lchp0003','$H_OK','达标', '[{"platformId":"instagram","followers":8000},{"platformId":"xiaohongshu","followers":300}]')
ON CONFLICT (user_id) DO UPDATE SET social_platforms=EXCLUDED.social_platforms;
INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance)
VALUES ('lcwal00001','$BID','brand','JPY',500000) ON CONFLICT (id) DO NOTHING;
UPDATE wallets SET available_balance=500000 WHERE id='lcwal00001';
SQL
TB=$(mktoken $BID BRAND); TN=$(mktoken $H_NONE HERALD); TL=$(mktoken $H_LOW HERALD); TO=$(mktoken $H_OK HERALD)
TA=$(mktoken $(psql $DB -tAc "SELECT id FROM users WHERE email='admin@herix.com' LIMIT 1") ADMIN)

echo "— ALL 模式：Instagram ≥5000 粉丝 必须 —"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/uploads/tasks/e2e-cover.webp","title":"平台要求e2e-ALL","description":"验证ALL模式平台粉丝要求端到端测试","mode":"STANDARD",
  "payoutPerHerald":3000,"maxHeralds":5,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC",
  "platformRequirements":[{"platformId":"instagram","minFollowers":5000,"required":true}],
  "reqMode":"ALL"}' | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$TID" != ERR:* ]] && ok "任务创建 $TID" || { bad "任务创建" "$TID"; exit 1 }
curl -s -X PATCH $API/tasks/$TID/publish -H "Authorization: Bearer $TB" >/dev/null
curl -s -X POST $API/admin/task-reviews/$TID/approve -H "Authorization: Bearer $TA" >/dev/null
PR=$(psql $DB -tAc "SELECT platform_requirements||'|'||req_mode FROM tasks WHERE id='$TID'")
assert_eq "DB 落库正确" "$PR" '[{"platformId":"instagram","minFollowers":5000,"required":true}]|ALL'

R=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TN" -H 'Content-Type: application/json' -d '{}')
assert_eq "无平台账号报名 → 拒绝" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "REQUIREMENTS_NOT_MET"
assert_eq "  failure type=MISSING" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('failures',[{}])[0].get('type',''))")" "MISSING"

R=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TL" -H 'Content-Type: application/json' -d '{}')
assert_eq "粉丝不足(1000<5000) → 拒绝" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "REQUIREMENTS_NOT_MET"
assert_eq "  failure type=INSUFFICIENT" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('failures',[{}])[0].get('type',''))")" "INSUFFICIENT"

R=$(curl -s -X POST $API/applications/$TID -H "Authorization: Bearer $TO" -H 'Content-Type: application/json' -d '{}')
APPID=$(echo $R | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$APPID" != ERR:* ]] && ok "达标赫使(8000≥5000)报名成功" || bad "达标赫使报名" "$R"

echo "— 编辑回显 —"
GOT=$(curl -s $API/tasks/$TID -H "Authorization: Bearer $TB" | python3 -c "
import json,sys
d=json.load(sys.stdin)
pr=d['platform_requirements']
pr=json.loads(pr) if isinstance(pr,str) else pr
print(pr[0]['minFollowers'])")
assert_eq "GET 详情正确回显 minFollowers" "$GOT" "5000"

echo "— ANY_N 模式：3选2 —"
TID2=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/uploads/tasks/e2e-cover.webp","title":"平台要求e2e-ANYN","description":"验证ANY_N模式任意N项满足端到端测试","mode":"STANDARD",
  "payoutPerHerald":3000,"maxHeralds":5,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC",
  "platformRequirements":[{"platformId":"instagram","required":true},{"platformId":"xiaohongshu","required":true},{"platformId":"tiktok","required":true}],
  "reqMode":"ANY_N","reqMinCount":2}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
curl -s -X PATCH $API/tasks/$TID2/publish -H "Authorization: Bearer $TB" >/dev/null
curl -s -X POST $API/admin/task-reviews/$TID2/approve -H "Authorization: Bearer $TA" >/dev/null
R=$(curl -s -X POST $API/applications/$TID2 -H "Authorization: Bearer $TO" -H 'Content-Type: application/json' -d '{}')
APPID2=$(echo $R | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$APPID2" != ERR:* ]] && ok "满足2/3项报名成功" || bad "ANY_N达标报名" "$R"
R=$(curl -s -X POST $API/applications/$TID2 -H "Authorization: Bearer $TL" -H 'Content-Type: application/json' -d '{}')
assert_eq "只满足1/3项 → 拒绝" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "REQUIREMENTS_NOT_MET"

echo "— 联系类平台（微信好友数门槛）：MISSING→不足→达标，且好友数不算 KOL 段位 —"
TID3=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/uploads/tasks/e2e-cover.webp","title":"平台要求e2e-微信好友","description":"验证联系类平台好友数门槛端到端测试","mode":"STANDARD",
  "payoutPerHerald":3000,"maxHeralds":5,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC",
  "platformRequirements":[{"platformId":"wechat","minFollowers":500,"required":true}],
  "reqMode":"ALL"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
curl -s -X PATCH $API/tasks/$TID3/publish -H "Authorization: Bearer $TB" >/dev/null
curl -s -X POST $API/admin/task-reviews/$TID3/approve -H "Authorization: Bearer $TA" >/dev/null
# 完全没绑 → MISSING（可当场补）
R=$(curl -s -X POST $API/applications/$TID3 -H "Authorization: Bearer $TN" -H 'Content-Type: application/json' -d '{}')
assert_eq "没绑微信 → MISSING 拦截" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('failures',[{}])[0].get('type',''))")" "MISSING"
# 绑了但好友数不足(300<500) → INSUFFICIENT（关键：不改赫使端存好友数的话这里会永久卡，本用例证明不卡）
psql $DB -c "UPDATE herald_profiles SET social_platforms='[{\"platformId\":\"wechat\",\"accountId\":\"wx_test_001\",\"followers\":300}]' WHERE user_id='$H_NONE'" >/dev/null
R=$(curl -s -X POST $API/applications/$TID3 -H "Authorization: Bearer $TN" -H 'Content-Type: application/json' -d '{}')
assert_eq "好友数不足(300<500) → INSUFFICIENT" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('failures',[{}])[0].get('type',''))")" "INSUFFICIENT"
# 好友数达标(800) → 通过
psql $DB -c "UPDATE herald_profiles SET social_platforms='[{\"platformId\":\"wechat\",\"accountId\":\"wx_test_001\",\"followers\":800}]' WHERE user_id='$H_NONE'" >/dev/null
R=$(curl -s -X POST $API/applications/$TID3 -H "Authorization: Bearer $TN" -H 'Content-Type: application/json' -d '{}')
APPID3=$(echo $R | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$APPID3" != ERR:* ]] && ok "好友数达标(800≥500)报名通过（好友数存得进、校验读得到，不卡）" || bad "达标报名" "$R"
# 好友数不进 KOL 段位（tier_snapshot 不含 wechat）
TIER=$(curl -s -X PATCH $API/ambassador/profile -H "Authorization: Bearer $TN" -H 'Content-Type: application/json' -d '{"socialPlatforms":[{"platformId":"wechat","accountId":"wx_test_001","followers":800}]}' | python3 -c "import json,sys;d=json.load(sys.stdin);import json as j;print('wechat' in j.loads(d.get('tier_snapshot') or '{}'))" 2>/dev/null)
assert_eq "微信好友数不算 KOL 段位(tier_snapshot 不含 wechat)" "$TIER" "False"

echo ""
echo "== 结果: $PASS 通过 / $FAIL 失败 =="

# 共享 fixture（lcbrand00001/lcherald0001）不删 users/profiles/wallets；临时赫使 2/3 号可能被历史引用同样保守处理
psql $DB >/dev/null <<SQL
DELETE FROM notifications WHERE user_id IN ('$BID','$H_NONE','$H_LOW','$H_OK');
DELETE FROM task_applications WHERE task_id IN ('$TID','$TID2','$TID3');
DELETE FROM task_content_specs WHERE task_id IN ('$TID','$TID2','$TID3');
DELETE FROM task_referral_specs WHERE task_id IN ('$TID','$TID2','$TID3');
DELETE FROM tasks WHERE id IN ('$TID','$TID2','$TID3');
UPDATE wallets SET available_balance=0 WHERE id='lcwal00001';
UPDATE herald_profiles SET social_platforms='[]' WHERE user_id IN ('$H_NONE','$H_LOW','$H_OK');
SQL
echo "测试数据已清理"
exit $FAIL
