#!/usr/bin/env bash
# 零成本本地演示的公共配置与进程工具。所有脚本只操作本机回环地址。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_DIR="$REPO_ROOT/.local"
RUN_DIR="$LOCAL_DIR/run"
LOG_DIR="$LOCAL_DIR/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

if [[ -f "$LOCAL_DIR/env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$LOCAL_DIR/env"
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PGDATA="${PGDATA:-$LOCAL_DIR/pg-data}"
PGPORT="${PGPORT:-55481}"
PGSOCK="${PGSOCK:-/Users/${USER}/.crewtrace-pg-sock}"
DATABASE_URL="${DATABASE_URL:-postgresql://${USER}:${PGPASSWORD:-local_ci_only}@127.0.0.1:${PGPORT}/crewtrace_v2_test}"
RUNTIME_PORT="${RUNTIME_PORT:-3000}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
INTERNAL_RUNTIME="http://127.0.0.1:${RUNTIME_PORT}"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-staging}"

ADMIN_TOKEN_FILE="$LOCAL_DIR/admin-token"
if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  if [[ ! -f "$ADMIN_TOKEN_FILE" ]]; then
    (umask 077; openssl rand -hex 32 > "$ADMIN_TOKEN_FILE")
  fi
  ADMIN_TOKEN="$(cat "$ADMIN_TOKEN_FILE")"
fi

PG_CTL="${PG_CTL:-$(command -v pg_ctl || true)}"
if [[ -z "$PG_CTL" ]]; then
  echo "未找到 pg_ctl，请安装 PostgreSQL 或设置 PG_CTL" >&2
  exit 1
fi

log() { printf '%s\n' "$*"; }

pid_running() {
  local file="$RUN_DIR/$1.pid"
  [[ -f "$file" ]] && kill -0 "$(cat "$file")" 2>/dev/null
}

write_pid() { echo "$2" > "$RUN_DIR/$1.pid"; }

stop_pid() {
  local name="$1" file="$RUN_DIR/$name.pid"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  fi
  rm -f "$file"
}

wait_for_http() {
  local url="$1" seconds="${2:-30}"
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS -o /dev/null --max-time 2 "$url"; then return 0; fi
    sleep 1
  done
  return 1
}

start_postgres() {
  if "$PG_CTL" -D "$PGDATA" status >/dev/null 2>&1; then
    log "PostgreSQL 已在运行"
    return 0
  fi
  mkdir -p "$PGSOCK"
  "$PG_CTL" -D "$PGDATA" -l "$LOG_DIR/postgres.log" \
    -o "-p $PGPORT -k $PGSOCK -h 127.0.0.1" start >/dev/null
  log "PostgreSQL 已启动，127.0.0.1:${PGPORT}"
}

stop_postgres() {
  if "$PG_CTL" -D "$PGDATA" status >/dev/null 2>&1; then
    "$PG_CTL" -D "$PGDATA" -m fast stop >/dev/null
    log "PostgreSQL 已停止"
  fi
}

require_dist() {
  if [[ ! -f "$REPO_ROOT/apps/web/dist/index.html" ]]; then
    echo "缺少 apps/web/dist，请先运行 npm run build" >&2
    exit 1
  fi
}

admin_get() { curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$INTERNAL_RUNTIME$1"; }
admin_post() {
  curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "$2" "$INTERNAL_RUNTIME$1"
}
