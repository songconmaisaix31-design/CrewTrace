#!/usr/bin/env bash
# 恢复接受新订单。公网入口需要另外执行 start.sh --tunnel 才会重新开启。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

admin_post /admin/demo/pause '{"paused":false}'
log ""
