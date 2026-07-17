# i18n-review — 多语言改动全套审查与收尾

## 用途

任何触碰 `herix-miniapp/src/i18n/` 或新增/修改 `t('...')` 调用的改动（无论是本会话、其他 AI 会话还是手改），
跑这套审查 + 收尾。背景：体系是"四件套"——zh/ja/en.json + context.json + seed 双库 + 构建部署，
外部改动常只做第一件（2026-07-17 实例：另一会话加税务声明词条，漏了 context/seed/部署三步）。

## 审查清单（逐项执行，全过才算完）

### 1. 四文件键集合一致

```bash
cd /Users/gabrielg/Herix/herix-miniapp/src/i18n && python3 -c "
import json
ks = {f: set(json.load(open(f + '.json'))) for f in ['zh', 'ja', 'en', 'context']}
base = ks['zh']
ok = True
for f in ['ja', 'en', 'context']:
    miss, extra = base - ks[f], ks[f] - base
    if miss: print(f'{f}.json 缺键:', sorted(miss)); ok = False
    if extra: print(f'{f}.json 多键:', sorted(extra)); ok = False
print('✓ 四文件键集合一致' if ok else '✗ 键不同步——先补齐')"
```

### 2. 占位符三语一致

```bash
cd /Users/gabrielg/Herix/herix-miniapp/src/i18n && python3 -c "
import json, re
zh, ja, en = (json.load(open(f + '.json')) for f in ['zh', 'ja', 'en'])
ph = lambda s: set(re.findall(r'\{(\w+)\}', str(s)))
bad = [k for k in zh if not (ph(zh[k]) == ph(ja.get(k, '')) == ph(en.get(k, '')))]
print('✗ 占位符不一致:', bad) if bad else print('✓ 占位符三语一致')"
```

### 3. 键与代码引用互查

```bash
cd /Users/gabrielg/Herix/herix-miniapp && python3 -c "
import json, re, subprocess
zh = set(json.load(open('src/i18n/zh.json')))
src = subprocess.run(['grep', '-rhoE', r\"\bt(f)?\(['\\\"]([a-zA-Z0-9_.]+)['\\\"]\", 'src', '--include=*.tsx', '--include=*.ts'], capture_output=True, text=True).stdout
used = set(re.findall(r\"\(['\\\"]([a-zA-Z0-9_.]+)['\\\"]\", src))
undef = sorted(k for k in used if k not in zh and '.' in k)
print('✗ 代码引用了不存在的键(typo/漏加):', undef[:20]) if undef else print('✓ 代码引用的键全部存在')"
```

（词典里未被引用的键不算错——`notif.*`/`error.*` 是按后端 code 动态拼的。）

### 4. context 质量（人工过目）

新增/改动的键逐个看 context.json：语境是否说清"在哪、干什么、参数含义"；
**法律/合规/金额类文案必须标注**"措辞改动需产品确认"（参考 `ob.taxAgree`、`ob.sub2` 的写法）。

### 5. seed 双库

```bash
# 本地
DBURL=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:DATABASE_URL' ~/Library/LaunchAgents/com.herix.server.plist)
cd /Users/gabrielg/Herix/herix-server && DATABASE_URL="$DBURL" npx tsx scripts/seed-i18n.ts
# 生产（⚠️ 必须先 git push + ECS git pull，再 seed——2026-07-17 踩过顺序坑）
ssh root@8.210.73.0 'cd /home/herix/Herix && git pull && cd herix-server && export $(grep -v "^#" .env | grep "=" | xargs) && npx tsx scripts/seed-i18n.ts'
```

### 6. 构建 + 部署

```bash
cd /Users/gabrielg/Herix/herix-miniapp && npx taro build --type h5 && npx taro build --type weapp
# 生产 H5（ECS 不构建，从本地 rsync）
rsync -az --delete dist/h5/ root@8.210.73.0:/home/herix/Herix/herix-miniapp/dist/h5/
# 小程序端提醒用户：开发者工具重新上传 + 选为体验版
```

### 7. 运营矩阵漂移检查（顺手）

```bash
cd /Users/gabrielg/Herix/herix-server && DATABASE_URL="$DBURL" npx tsx -e "
import pool from './src/db';
(async () => { const r = await pool.query(\"SELECT COUNT(*)::int AS n FROM i18n_entries WHERE updated_by IS DISTINCT FROM 'seed'\"); console.log('运营改过的行:', r.rows[0].n, r.rows[0].n > 0 ? '→ 提醒用户可跑反向同步收进代码' : ''); await pool.end(); })();"
```

## 输出格式

逐项 ✓/✗ 汇报；✗ 项修完复跑；最后提交（i18n 改动与相关代码同 commit），并明确告知：
生产是否已同步（H5 rsync / ECS seed / 小程序需重新上传体验版）。

## 术语一致性（必查）

跑 `node scripts/check-terms.js`——品牌核心术语（赫使/アンバサダー/Ambassador、広告代理店、紹介コード、コンバージョン、精算、海外ルーツコミュニティ/海外生活社群 等）以 PRD §27 为唯一权威，检查器违例必须清零才算通过。新词条翻译时先对照该表。
