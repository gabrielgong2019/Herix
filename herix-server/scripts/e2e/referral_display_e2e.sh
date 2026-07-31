#!/bin/zsh
# 邀请任务展示结构 e2e：conversion_criteria(JSONB) + invitee_benefit + referral_script 往返/PATCH
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
SQL
TB=$(mktoken $BID BRAND)

echo "— ① 建邀请任务(带转化条件/激励/话术) —"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/x.webp","title":"邀请展示e2e","description":"","mode":"PERFORMANCE",
  "payoutPerHerald":3000,"maxHeralds":10,"category":"experience","codeMode":"auto","dataMode":"AGGREGATE","visibility":"PUBLIC",
  "conversionCriteria":{"register":{"label":"新用户（此前未注册过）","required":true},"convert":["首次汇款输入邀请码","汇款 ≥ ¥10,000 且成功到账"]},
  "inviteeBenefit":"首次汇款立减 ¥1,500，可叠加首单优惠",
  "referralScript":"用我的邀请码首汇立减1500日元"
}' | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or 'ERR:'+str(d))")
[[ "$TID" != ERR:* ]] && ok "任务创建 $TID" || { bad "任务创建" "$TID"; exit 1 }

echo "— ② JSONB 落库(原生 JSON，非 TEXT 字符串) —"
COL=$(psql $DB -tAc "SELECT data_type FROM information_schema.columns WHERE table_name='task_referral_specs' AND column_name='conversion_criteria'")
assert_eq "conversion_criteria 列类型 jsonb" "$COL" "jsonb"
REG=$(psql $DB -tAc "SELECT conversion_criteria->'register'->>'label' FROM task_referral_specs WHERE task_id='$TID'")
assert_eq "register.label 落库" "$REG" "新用户（此前未注册过）"
NCONV=$(psql $DB -tAc "SELECT jsonb_array_length(conversion_criteria->'convert') FROM task_referral_specs WHERE task_id='$TID'")
assert_eq "convert 两条" "$NCONV" "2"

echo "— ③ 详情 API 返回结构(供赫使 4 块渲染) —"
D=$(curl -s $API/tasks/$TID -H "Authorization: Bearer $TB")
assert_eq "返回 register.label" "$(echo $D | python3 -c "import json,sys;print(json.load(sys.stdin)['conversion_criteria']['register']['label'])")" "新用户（此前未注册过）"
assert_eq "返回 convert[1]" "$(echo $D | python3 -c "import json,sys;print(json.load(sys.stdin)['conversion_criteria']['convert'][1])")" "汇款 ≥ ¥10,000 且成功到账"
assert_eq "返回 invitee_benefit" "$(echo $D | python3 -c "import json,sys;print(json.load(sys.stdin)['invitee_benefit'])")" "首次汇款立减 ¥1,500，可叠加首单优惠"
assert_eq "返回 referral_script" "$(echo $D | python3 -c "import json,sys;print(json.load(sys.stdin)['referral_script'])")" "用我的邀请码首汇立减1500日元"

echo "— ④ PATCH 改转化条件(草稿期) —"
curl -s -X PUT $API/tasks/$TID -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "conversionCriteria":{"register":{"label":"新用户","required":true},"convert":["仅需完成注册"]}}' >/dev/null
assert_eq "PATCH 后 convert 变 1 条" "$(psql $DB -tAc "SELECT jsonb_array_length(conversion_criteria->'convert') FROM task_referral_specs WHERE task_id='$TID'")" "1"

echo "— ⑤ 空 convert = 注册即转化 —"
TID2=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "coverImage":"/x.webp","title":"邀请展示e2e-纯拉新","description":"","mode":"PERFORMANCE",
  "payoutPerHerald":500,"maxHeralds":10,"category":"experience","codeMode":"auto","dataMode":"AGGREGATE","visibility":"PUBLIC",
  "conversionCriteria":{"register":{"label":"新用户","required":true},"convert":[]}}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
assert_eq "空 convert 落库为 0 条" "$(psql $DB -tAc "SELECT jsonb_array_length(conversion_criteria->'convert') FROM task_referral_specs WHERE task_id='$TID2'")" "0"

echo ""
echo "== 结果: $PASS 通过 / $FAIL 失败 =="

psql $DB >/dev/null <<SQL
DELETE FROM task_referral_specs WHERE task_id IN ('$TID','$TID2');
DELETE FROM task_content_specs WHERE task_id IN ('$TID','$TID2');
DELETE FROM tasks WHERE id IN ('$TID','$TID2');
SQL
echo "测试数据已清理"
exit $FAIL
