#!/bin/bash
# Herix 分享脚本 - 开一个公网链接发给朋友体验

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. 确保 share server 在 3999 端口
echo "[1/3] 检查分享服务器..."
if ! curl -s -m 2 http://localhost:3999/api/health >/dev/null 2>&1; then
  echo "      启动 share server..."
  node "$DIR/share.js" &
  sleep 2
fi
echo "       ✓ http://localhost:3999"

# 2. 启动 ngrok 隧道
echo "[2/3] 启动公网隧道..."
npx ngrok http 3999 --log=stdout > /tmp/ngrok.log 2>&1 &
sleep 4

# 3. 读取公网地址
URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print([x['public_url'] for x in t if x['public_url'].startswith('https')][0])" 2>/dev/null)

if [ -n "$URL" ]; then
  echo "       ✓ $URL"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  发这个链接给朋友："
  echo "  $URL"
  echo ""
  echo "  测试账号: alice@d.com / 123456"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo "       ❌ 隧道启动失败"
  echo ""
  echo "需要去 https://ngrok.com 注册免费账号，然后:"
  echo "  ngrok config add-authtoken 你的token"
  echo "然后再运行这个脚本"
fi
