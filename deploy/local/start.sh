#!/usr/bin/env bash
# 启动本地演示：PostgreSQL、迁移、三个 Worker、Runtime（回环）、入口网关。
# 默认不开启公网入口。使用 --tunnel 且显式设置 CREWTRACE_TUNNEL_AUTHORIZED=yes 时才启动 Cloudflare Quick Tunnel。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

TUNNEL=false
for arg in "$@"; do
  case "$arg" in
    --tunnel) TUNNEL=true ;;
    *) echo "未知参数 $arg，可用参数：--tunnel" >&2; exit 2 ;;
  esac
done

if $TUNNEL && [[ "${CREWTRACE_TUNNEL_AUTHORIZED:-}" != "yes" ]]; then
  echo "拒绝开启公网入口：如需临时隧道，请显式设置 CREWTRACE_TUNNEL_AUTHORIZED=yes" >&2
  exit 3
fi
if $TUNNEL && ! command -v cloudflared >/dev/null 2>&1; then
  echo "未找到 cloudflared，请执行 brew install cloudflared（免费，无需账号）" >&2
  exit 1
fi

require_dist
node -e 'if(process.versions.node.split(".")[0]!=="24")throw new Error("需要 Node 24，当前 "+process.versions.node)'

start_postgres
log "应用数据库迁移"
DATABASE_URL="$DATABASE_URL" node --import tsx "$REPO_ROOT/services/runtime/src/migrate.ts"

log "准备三个 CSV Worker 身份"
PREPARE_OUTPUT="$(DATABASE_URL="$DATABASE_URL" ADMIN_TOKEN="$ADMIN_TOKEN" PUBLIC_BASE_URL="$INTERNAL_RUNTIME" \
  node --import tsx "$SCRIPT_DIR/prepare-workers.ts")"
# shellcheck disable=SC1090
set -a; . "$LOCAL_DIR/workers.env"; set +a
WORKER_COUNT="$(printf '%s' "$WORKER_AGENT_IDS" | awk -F, '{print NF}')"
if [[ "$WORKER_COUNT" -ne 3 ]]; then
  echo "Worker 身份数量不是 3：$PREPARE_OUTPUT" >&2
  exit 1
fi

if pid_running runtime; then stop_pid runtime; fi
if pid_running gateway; then stop_pid gateway; fi
if pid_running cloudflared; then stop_pid cloudflared; fi
for index in 1 2 3; do if pid_running "worker-$index"; then stop_pid "worker-$index"; fi; done

# 本次启动成功的进程标记。任一关键步骤失败时只清理本次启动的进程与公网隧道。
STARTED_CLOUDFLARED=0
STARTED_GATEWAY=0
STARTED_RUNTIME=0
STARTED_WORKERS=0
TUNNEL_CREATED=0
SUCCESS=0

rollback_start() {
  local status=$?
  if [[ "$SUCCESS" -eq 1 ]]; then return 0; fi
  echo "启动未完成，关闭本次创建的公网入口并停止本次启动的进程" >&2
  if [[ "$STARTED_CLOUDFLARED" -eq 1 ]]; then stop_pid cloudflared; fi
  if [[ "$TUNNEL_CREATED" -eq 1 ]]; then rm -f "$LOCAL_DIR/tunnel-url"; fi
  if [[ "$STARTED_WORKERS" -eq 1 ]]; then
    for index in 3 2 1; do stop_pid "worker-$index"; done
  fi
  if [[ "$STARTED_GATEWAY" -eq 1 ]]; then stop_pid gateway; fi
  if [[ "$STARTED_RUNTIME" -eq 1 ]]; then stop_pid runtime; fi
  echo "日志目录 $LOG_DIR" >&2
  exit "$status"
}
trap rollback_start EXIT

PUBLIC_DEPLOYMENT=false
PROXY_TRUST_MODE=none
TRUSTED_PROXY_CIDRS=""
PUBLIC_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}"
ALLOWED_ORIGINS="$PUBLIC_BASE_URL"

if $TUNNEL; then
  log "启动 Cloudflare Quick Tunnel（临时公网入口）"
  rm -f "$LOCAL_DIR/tunnel-url"
  cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${GATEWAY_PORT}" \
    > "$LOG_DIR/cloudflared.log" 2>&1 &
  write_pid cloudflared $! "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:${GATEWAY_PORT}"
  STARTED_CLOUDFLARED=1
  TUNNEL_CREATED=1
  TUNNEL_URL=""
  for _ in $(seq 1 40); do
    TUNNEL_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" 2>/dev/null | head -1 || true)"
    [[ -n "$TUNNEL_URL" ]] && break
    if ! pid_running cloudflared; then break; fi
    sleep 1
  done
  if [[ -z "$TUNNEL_URL" ]]; then
    echo "Cloudflare Quick Tunnel 启动失败，日志见 $LOG_DIR/cloudflared.log" >&2
    exit 1
  fi
  printf '%s\n' "$TUNNEL_URL" > "$LOCAL_DIR/tunnel-url"
  PUBLIC_BASE_URL="$TUNNEL_URL"
  PUBLIC_DEPLOYMENT=true
  # 公网网关不采信客户端可伪造的 CF-Connecting-IP，所有隧道流量按本机回环来源计数。
  PROXY_TRUST_MODE=cidr
  TRUSTED_PROXY_CIDRS="127.0.0.1/32,::1/128"
  ALLOWED_ORIGINS="$TUNNEL_URL"
  log "临时公网地址 $TUNNEL_URL"
fi

log "启动入口网关 127.0.0.1:${GATEWAY_PORT}"
(
  cd "$REPO_ROOT"
  exec env GATEWAY_PORT="$GATEWAY_PORT" GATEWAY_RUNTIME_URL="$INTERNAL_RUNTIME" RUNTIME_URL="$INTERNAL_RUNTIME" \
    PUBLIC_RUNTIME_URL="$PUBLIC_BASE_URL" GATEWAY_PUBLIC_ORIGIN="$PUBLIC_BASE_URL" \
    node --import tsx "$SCRIPT_DIR/gateway.ts"
) >> "$LOG_DIR/gateway.log" 2>&1 &
write_pid gateway $! "$SCRIPT_DIR/gateway.ts"
STARTED_GATEWAY=1

log "启动 Runtime 127.0.0.1:${RUNTIME_PORT}"
(
  cd "$REPO_ROOT"
  exec env PORT="$RUNTIME_PORT" DATABASE_URL="$DATABASE_URL" ADMIN_TOKEN="$ADMIN_TOKEN" \
  PUBLIC_BASE_URL="$PUBLIC_BASE_URL" PUBLIC_WEB_URL="$PUBLIC_BASE_URL" ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
  DEPLOYMENT_ENV="$DEPLOYMENT_ENV" PUBLIC_DEPLOYMENT="$PUBLIC_DEPLOYMENT" \
  DEPLOYMENT_SHA="$(git rev-parse HEAD)" NODE_ENV=production \
  PROXY_TRUST_MODE="$PROXY_TRUST_MODE" TRUSTED_PROXY_CIDRS="$TRUSTED_PROXY_CIDRS" \
  PAYMENT_MODE=disabled EXPERIMENT_CHAIN_WRITES=OFF \
  EXPERIMENT_WORKER_AGENT_IDS="$WORKER_AGENT_IDS" \
  PUBLIC_RATE_LIMIT_PER_MINUTE=60 PUBLIC_ORDER_LIMIT_PER_HOUR=10 \
  PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE=30 \
  node --import tsx services/runtime/src/local.ts
) >> "$LOG_DIR/runtime.log" 2>&1 &
write_pid runtime $! "services/runtime/src/local.ts"
STARTED_RUNTIME=1

for index in 1 2 3; do
  credential_var="WORKER_${index}_CREDENTIAL"
  (
    cd "$REPO_ROOT/workers"
    exec env CREWTRACE_WORKER_RUNTIME="$INTERNAL_RUNTIME" CREWTRACE_WORKER_CREDENTIAL="${!credential_var}" \
      node --import tsx src/portfolio-worker.ts
  ) >> "$LOG_DIR/worker-${index}.log" 2>&1 &
  write_pid "worker-$index" $! "src/portfolio-worker.ts"
done
STARTED_WORKERS=1

if ! wait_for_http "$INTERNAL_RUNTIME/health" 60; then
  echo "Runtime 未在 60 秒内就绪，请查看 $LOG_DIR/runtime.log" >&2
  exit 1
fi
if ! pid_running runtime; then
  echo "Runtime 进程未存活，端口可能被其他程序占用，请查看 $LOG_DIR/runtime.log" >&2
  exit 1
fi

if ! wait_for_http "http://127.0.0.1:${GATEWAY_PORT}/" 20; then
  echo "入口网关未在 20 秒内就绪，请查看 $LOG_DIR/gateway.log" >&2
  exit 1
fi
if ! pid_running gateway; then
  echo "入口网关进程未存活，端口可能被其他程序占用，请查看 $LOG_DIR/gateway.log" >&2
  exit 1
fi

online=0
for _ in $(seq 1 20); do
  online="$(admin_get /admin/demo | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).workers.online)}catch{console.log(0)}})')"
  [[ "$online" -ge 3 ]] && break
  sleep 1
done
if [[ "$online" -lt 3 ]]; then
  echo "三个 Worker 未全部在线，当前 ${online}/3，请查看 $LOG_DIR/worker-*.log" >&2
  exit 1
fi

if $TUNNEL; then
  if ! wait_for_http "$PUBLIC_BASE_URL/health" 30; then
    echo "公网入口健康检查失败" >&2
    exit 1
  fi
  log "公网健康检查通过"
fi

SUCCESS=1
log "演示已启动"
log "  本机地址 http://127.0.0.1:${GATEWAY_PORT}"
if $TUNNEL; then log "  公网地址 $PUBLIC_BASE_URL（用完立即执行 ./deploy/local/stop.sh）"; fi
log "  在线 Worker ${online}/3，暂停状态 $(admin_get /admin/demo | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).deployment.paused)}catch{console.log("unknown")}})')"
