#!/bin/bash
# 更新 ECS 上的 Airwallex API Key
# 用法：bash scripts/update-airwallex-key.sh

set -e

echo "=== Airwallex API Key 更新 ==="
echo ""

read -p "新的 Client ID（留空保持不变）: " NEW_CLIENT_ID
read -p "新的 API Key: " NEW_API_KEY

if [ -z "$NEW_API_KEY" ]; then
  echo "❌ API Key 不能为空"
  exit 1
fi

ENV_FILE="/home/herix/Herix/herix-server/.env"

echo ""
echo "正在更新 ECS 上的 .env ..."

ssh root@8.210.73.0 bash <<EOF
  set -e

  # 更新 API Key
  if grep -q "^AIRWALLEX_API_KEY=" "$ENV_FILE"; then
    sed -i "s|^AIRWALLEX_API_KEY=.*|AIRWALLEX_API_KEY=$NEW_API_KEY|" "$ENV_FILE"
  else
    echo "AIRWALLEX_API_KEY=$NEW_API_KEY" >> "$ENV_FILE"
  fi

  # 更新 Client ID（如果提供了）
  if [ -n "$NEW_CLIENT_ID" ]; then
    if grep -q "^AIRWALLEX_CLIENT_ID=" "$ENV_FILE"; then
      sed -i "s|^AIRWALLEX_CLIENT_ID=.*|AIRWALLEX_CLIENT_ID=$NEW_CLIENT_ID|" "$ENV_FILE"
    else
      echo "AIRWALLEX_CLIENT_ID=$NEW_CLIENT_ID" >> "$ENV_FILE"
    fi
  fi

  echo "✅ .env 已更新"
  grep "AIRWALLEX_" "$ENV_FILE"
EOF

echo ""
echo "验证新 Key 权限..."
ssh root@8.210.73.0 "AIRWALLEX_CLIENT_ID=${NEW_CLIENT_ID:-kl-_cFozTfq6e2fjt-88aw} AIRWALLEX_API_KEY=$NEW_API_KEY node /home/herix/Herix/scripts/check-airwallex.mjs"
