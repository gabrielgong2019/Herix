#!/bin/bash
# Herix 赫使 - 服务管理脚本
# 使用 launchd 管理进程，崩溃自动重启，不受终端影响

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD=${1:-start}

case "$CMD" in
  start)
    echo "启动 Herix 服务..."
    # 后端 API (port 3004)
    launchctl load /tmp/com.herix.server.plist 2>/dev/null
    # 静态文件 (port 3005)
    launchctl load /tmp/com.herix.static.plist 2>/dev/null
    sleep 3
    echo "  后端: http://localhost:3004"
    echo "  预览: http://localhost:3005/preview.html"
    echo "  商家: http://localhost:3005/merchant.html"
    echo "  运营: http://localhost:3005/admin.html"
    ;;
  stop)
    echo "停止 Herix 服务..."
    launchctl unload /tmp/com.herix.server.plist 2>/dev/null
    launchctl unload /tmp/com.herix.static.plist 2>/dev/null
    echo "已停止"
    ;;
  status)
    echo "后端: $(launchctl list com.herix.server 2>/dev/null | awk '{print $3}')"
    echo "静态: $(launchctl list com.herix.static 2>/dev/null | awk '{print $3}')"
    curl -s -o /dev/null -w "  API: %{http_code}\n" http://localhost:3004/api/tasks 2>/dev/null || echo "  API: 无响应"
    curl -s -o /dev/null -w "  页面: %{http_code}\n" http://localhost:3005/preview.html 2>/dev/null || echo "  页面: 无响应"
    ;;
  *)
    echo "用法: bash start.sh {start|stop|status}"
    ;;
esac
