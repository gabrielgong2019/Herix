#!/bin/bash
# Herix 本地 PostgreSQL 开发环境一键安装

set -e

echo "=== 1. 安装 PostgreSQL ==="
if ! command -v psql &>/dev/null; then
  echo "→ 通过 Homebrew 安装 PostgreSQL 16..."
  brew install postgresql@16
  echo "→ 启动 PostgreSQL 服务..."
  brew services start postgresql@16
  sleep 2
else
  echo "✅ PostgreSQL 已安装 ($(psql --version))"
  if ! brew services list 2>/dev/null | grep postgresql | grep started &>/dev/null; then
    echo "→ 启动 PostgreSQL 服务..."
    brew services start postgresql@16
    sleep 2
  fi
fi

echo ""
echo "=== 2. 创建数据库 ==="
if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw herix; then
  echo "✅ 数据库 herix 已存在"
else
  createdb herix
  echo "✅ 数据库 herix 已创建"
fi

echo ""
echo "=== 3. 生成 .env 文件 ==="
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cp "$PROJECT_DIR/herix-server/.env.example" "$PROJECT_DIR/herix-server/.env"
echo "✅ .env 文件已创建"

echo ""
echo "=== 4. 安装依赖 ==="
cd "$PROJECT_DIR/herix-server" && npm install

echo ""
echo "========== 🎉 本地开发环境已就绪 =========="
echo ""
echo "启动开发服务器:"
echo "  cd herix-server && npm run dev"
echo ""
echo "运行测试数据 (启动服务器后另开终端):"
echo "  cd herix-server && node seed.js"
echo ""
echo "访问地址: http://localhost:3004"
