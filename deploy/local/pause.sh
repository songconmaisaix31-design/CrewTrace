#!/usr/bin/env bash
# 立即暂停新订单、新注册与新协作任务。已在执行的订单不受影响。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

admin_post /admin/demo/pause '{"paused":true}'
log ""
