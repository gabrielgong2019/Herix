#!/usr/bin/env python3
"""前后端路由契约审计：商家端 http.* 调用路径 ↔ 服务端注册路由 全量比对。

背景（2026-07-26）：React 商家端由 herix.html 移植而来，API 层当时按想象写了一批
不存在的路由（/tasks/:id/applications/:appId/approve 等），报名/提交审核整块失效。
shared contracts 一期只锁枚举/类型，锁不住"这个 endpoint 存不存在"——本脚本补这层。

匹配规则：模板变量归一为 :x；FE 的 :x 段可匹配服务端字面量段（如 /uploads/brand/:x
匹配 /uploads/brand/logo，FE 传错值属运行时问题不在本审计范围）。
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def fe_calls():
    src = open(f'{ROOT}/herix-merchant/src/lib/api.ts').read()
    calls = set()
    for m in re.finditer(r"http\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*(`[^`]+`|'[^']+')", src):
        method, raw = m.group(1).upper(), m.group(2).strip("`'")
        path = re.sub(r"\$\{[^}]+\}", ":x", raw).split('?')[0].rstrip('/')
        calls.add((method, path or '/'))
    return calls

def server_routes():
    idx = open(f'{ROOT}/herix-server/src/index.ts').read()
    prefix = dict((m.group(2), m.group(1)) for m in re.finditer(r"app\.use\('(/api[^']*)',\s*(\w+)\)", idx))
    imports = dict(re.findall(r"import \{ (\w+) \} from '\./routes/([\w-]+)'", idx))
    routes = set()
    for m in re.finditer(r"app\.(get|post|patch|put|delete)\('(/api[^']*)'", idx):
        routes.add((m.group(1).upper(), re.sub(r":\w+", ":x", m.group(2)).replace('/api', '', 1)))
    for var, pfx in prefix.items():
        fname = imports.get(var)
        if not fname: continue
        src = open(f'{ROOT}/herix-server/src/routes/{fname}.ts').read()
        for m in re.finditer(r"\w+Router\.(get|post|patch|put|delete)\('([^']+)'", src):
            p = re.sub(r":\w+", ":x", m.group(2))
            routes.add((m.group(1).upper(), (pfx + ('' if p == '/' else p)).replace('/api', '', 1)))
    return routes

def seg_match(fe_path, srv_path):
    a, b = fe_path.split('/'), srv_path.split('/')
    if len(a) != len(b): return False
    return all(x == y or x == ':x' or y == ':x' for x, y in zip(a, b))

def main():
    calls, routes = fe_calls(), server_routes()
    missing = [(m, p) for m, p in sorted(calls)
               if not any(m == rm and seg_match(p, rp) for rm, rp in routes)]
    if missing:
        print(f"❌ 商家端调用了服务端不存在的路由（{len(missing)} 个）：")
        for m, p in missing: print(f"   {m} {p}")
        sys.exit(1)
    print(f"✅ 路由契约审计通过：{len(calls)} 个前端调用全部有服务端路由")

if __name__ == '__main__':
    main()
