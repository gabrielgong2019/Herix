#!/bin/zsh
# KYB 流程 e2e：结构化提交 + 法人番号校验位 + 状态流转 + 过审后发任务免平台审核
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

# 生成一个校验位合法的法人番号（首位=9-(Σ Pn×Qn mod 9)）
VALID_NUM=$(python3 -c "
base='011122233344'
s=sum(int(base[12-n])*(1 if n%2==1 else 2) for n in range(1,13))
print(str(9-(s%9))+base)")

BID=lckybbrand01
psql $DB >/dev/null <<SQL
INSERT INTO users (id,email,password_hash,nickname,role,roles,created_at,updated_at)
VALUES ('$BID','__LC__kyb@t.local','x','KYB测试商家','BRAND','["BRAND"]',now()::text,now()::text) ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_profiles (id,user_id,company_name,contact_name,is_onboarded)
VALUES ('lckybbp01','$BID','KYB株式会社','KYB','1') ON CONFLICT DO NOTHING;
UPDATE brand_profiles SET kyb_status='none', kyb_note=NULL WHERE user_id='$BID';
INSERT INTO wallets (id,user_id,wallet_type,currency,available_balance)
VALUES ('lckybwal01','$BID','brand','JPY',500000) ON CONFLICT (id) DO NOTHING;
SQL
TB=$(mktoken $BID BRAND)
TA=$(mktoken $(psql $DB -tAc "SELECT id FROM users WHERE email='admin@herix.com' LIMIT 1") ADMIN)

echo "— ① 提交校验 —"
R=$(curl -s -X POST $API/brands/kyb -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"companyName":"KYB株式会社","country":"jp"}')
assert_eq "缺证件被拒 DOC_REQUIRED" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "DOC_REQUIRED"
R=$(curl -s -X POST $API/brands/kyb -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"companyName":"KYB株式会社","country":"jp","corporateNumber":"1234567890123","docUrl":"/uploads/brands/x/kyb.webp"}')
assert_eq "校验位不符被拒 CORPORATE_NUMBER_INVALID" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "CORPORATE_NUMBER_INVALID"

echo "— ② 合法番号提交 → pending + 核验结果留痕 —"
R=$(curl -s -X POST $API/brands/kyb -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d "{\"companyName\":\"KYB株式会社\",\"country\":\"jp\",\"corporateNumber\":\"$VALID_NUM\",\"docUrl\":\"/uploads/brands/x/kyb.webp\"}")
assert_eq "提交成功进 pending（无国税厅API不自动通过）" "$(echo $R | python3 -c "import json,sys;d=json.load(sys.stdin);print(str(d.get('kybStatus'))+'|'+str(d.get('autoApproved')))")" "pending|False"
assert_eq "核验结果：校验位过/API未配置" "$(echo $R | python3 -c "import json,sys;c=json.load(sys.stdin)['autoChecks'];print(str(c['checksumValid'])+'|'+str(c['apiAvailable']))")" "True|False"
assert_eq "审计表留痕（含番号+核验JSON）" "$(psql $DB -tAc "SELECT count(*) FROM kyb_submissions WHERE user_id='$BID' AND corporate_number='$VALID_NUM' AND auto_checks IS NOT NULL")" "1"
assert_eq "快照 kyb_status=pending" "$(psql $DB -tAc "SELECT kyb_status FROM brand_profiles WHERE user_id='$BID'")" "pending"
R=$(curl -s -X POST $API/brands/kyb -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d "{\"companyName\":\"KYB株式会社\",\"country\":\"jp\",\"docUrl\":\"/uploads/brands/x/kyb.webp\"}")
assert_eq "审核中重复提交 409" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "ALREADY_PENDING"

echo "— ③ admin 队列看到核验结果 → 通过 —"
Q=$(curl -s $API/admin/kyb-reviews -H "Authorization: Bearer $TA" | python3 -c "
import json,sys
rows=[r for r in json.load(sys.stdin) if r['user_id']=='$BID']
r=rows[0]
c=json.loads(r['auto_checks'])
print(r['corporate_number']+'|'+str(c['checksumValid']))")
assert_eq "队列带番号+核验结果" "$Q" "$VALID_NUM|True"
curl -s -X POST $API/admin/kyb/$BID/approve -H "Authorization: Bearer $TA" >/dev/null
assert_eq "admin 通过 → approved" "$(psql $DB -tAc "SELECT kyb_status FROM brand_profiles WHERE user_id='$BID'")" "approved"
assert_eq "商家收到 KYB_APPROVED 通知" "$(psql $DB -tAc "SELECT count(*) FROM notifications WHERE user_id='$BID' AND type='KYB_APPROVED'")" "1"

echo "— ④ 过审后发任务免平台审核（直接 OPEN）—"
TID=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{
  "title":"KYB后免审任务","description":"KYB通过后发布任务应免平台审核直接上线","mode":"STANDARD",
  "payoutPerHerald":2000,"maxHeralds":1,"category":"experience","contentType":"photo","difficulty":"easy",
  "visibility":"PUBLIC"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
curl -s -X PATCH $API/tasks/$TID/publish -H "Authorization: Bearer $TB" >/dev/null
assert_eq "发布直接 OPEN（不进 PENDING_REVIEW）" "$(psql $DB -tAc "SELECT status||'|'||platform_review FROM tasks WHERE id='$TID'")" "OPEN|approved"

echo "— ⑤ 已认证再提交被拒 —"
R=$(curl -s -X POST $API/brands/kyb -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"companyName":"KYB株式会社","country":"jp","docUrl":"/uploads/brands/x/kyb.webp"}')
assert_eq "已通过重复提交 ALREADY_APPROVED" "$(echo $R | python3 -c "import json,sys;print(json.load(sys.stdin).get('code',''))")" "ALREADY_APPROVED"

echo ""
echo "== 结果: $PASS 通过 / $FAIL 失败 =="

psql $DB >/dev/null <<SQL
DELETE FROM notifications WHERE user_id='$BID';
DELETE FROM kyb_submissions WHERE user_id='$BID';
DELETE FROM task_content_specs WHERE task_id='$TID';
DELETE FROM tasks WHERE id='$TID';
DELETE FROM wallet_entries WHERE wallet_id='lckybwal01';
DELETE FROM wallets WHERE id='lckybwal01';
DELETE FROM brand_profiles WHERE user_id='$BID';
DELETE FROM users WHERE id='$BID';
SQL
echo "测试数据已清理"
exit $FAIL
