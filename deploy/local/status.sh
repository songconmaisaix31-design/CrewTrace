#!/usr/bin/env bash
# 只读检查本地演示的进程、监听地址、健康状态、Worker 在线数与当前公网入口。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

if "$PG_CTL" -D "$PGDATA" status >/dev/null 2>&1; then log "PostgreSQL 运行中 127.0.0.1:${PGPORT}"; else log "PostgreSQL 未运行"; fi
for name in runtime gateway worker-1 worker-2 worker-3 cloudflared; do
  if pid_running "$name"; then log "${name} 运行中 pid=$(cat "$RUN_DIR/$name.pid")"; else log "${name} 未运行"; fi
done

if curl -fsS --max-time 3 "$INTERNAL_RUNTIME/health" >/dev/null 2>&1; then
  HEALTH="$(admin_get /health)"
  log "Runtime 健康：$HEALTH"
  log "Worker 与额度：$(admin_get /admin/demo | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);console.log(JSON.stringify({paused:b.deployment.paused,workers:b.workers,active:b.orders.active,today:b.orders.today,quotas:b.quotas.usage}))})')"
else
  log "Runtime 未响应"
fi

if curl -fsS --max-time 3 "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
  log "入口网关运行中 http://127.0.0.1:${GATEWAY_PORT}"
else
  log "入口网关未响应"
fi

if [[ -f "$LOCAL_DIR/tunnel-url" ]]; then
  log "公网入口 $(cat "$LOCAL_DIR/tunnel-url")"
else
  log "公网入口未开启"
fi

if command -v lsof >/dev/null 2>&1; then
  log "监听地址："
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk -v p1="$RUNTIME_PORT" -v p2="$GATEWAY_PORT" -v p3="$PGPORT" '$9 ~ ":"p1"$" || $9 ~ ":"p2"$" || $9 ~ ":"p3"$"' || true
fi
