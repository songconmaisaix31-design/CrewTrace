#!/usr/bin/env bash
# 恢复验证：把备份恢复到临时库，比对关键表计数，结束后删除临时库。
# 用法：./deploy/local/restore-verify.sh [dump 文件]，默认使用 backups 下最新一份。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

BACKUP_DIR="${BACKUP_DIR:-$LOCAL_DIR/backups}"
DUMP="${1:-$(ls -1t "$BACKUP_DIR"/crewtrace-*.dump 2>/dev/null | head -1 || true)}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "未找到可用的备份文件，请先执行 ./deploy/local/backup.sh" >&2
  exit 1
fi

BASE_URL="${DATABASE_URL%/*}"
RESTORE_DB="crewtrace_v2_restore_check"
RESTORE_URL="${BASE_URL}/${RESTORE_DB}"
ADMIN_URL="${BASE_URL}/postgres"
TABLES=(commerce_orders commerce_payments collaboration_tasks collaboration_handoffs collaboration_credentials)

cleanup() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "恢复 $DUMP 到临时库 $RESTORE_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ${RESTORE_DB}"
pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" "$DUMP" >/dev/null

count_sql=""
for table in "${TABLES[@]}"; do
  count_sql+="SELECT '${table}', count(*) FROM ${table} UNION ALL "
done
count_sql="${count_sql% UNION ALL } ORDER BY 1"

SOURCE_COUNTS="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -F '=' -c "$count_sql")"
RESTORE_COUNTS="$(psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -tA -F '=' -c "$count_sql")"

printf '%s\n' "源库计数：" "$SOURCE_COUNTS" "恢复库计数：" "$RESTORE_COUNTS"

if [[ "$SOURCE_COUNTS" != "$RESTORE_COUNTS" ]]; then
  echo "恢复校验失败：关键表计数不一致" >&2
  exit 1
fi

echo "恢复校验通过：5 张关键表计数一致"
