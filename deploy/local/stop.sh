#!/usr/bin/env bash
# 立即关闭公网入口并停止演示进程。PostgreSQL 默认保留，使用 --pg 一并停止。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

stop_pid cloudflared
rm -f "$LOCAL_DIR/tunnel-url"
log "公网入口已关闭"
for index in 1 2 3; do stop_pid "worker-$index"; done
log "三个 Worker 已停止"
stop_pid gateway
log "入口网关已停止"
stop_pid runtime
log "Runtime 已停止"

if [[ "${1:-}" == "--pg" ]]; then stop_postgres; fi
