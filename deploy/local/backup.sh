#!/usr/bin/env bash
# 备份本地数据库：pg_dump 自定义格式，保留最近 7 份，并校验备份可读。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/common.sh"

BACKUP_DIR="${BACKUP_DIR:-$LOCAL_DIR/backups}"
KEEP="${BACKUP_KEEP:-7}"
mkdir -p "$BACKUP_DIR"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "未找到 pg_dump，请安装 PostgreSQL 客户端" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/crewtrace-${STAMP}.dump"

log "备份数据库到 $TARGET"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$TARGET"

if ! pg_restore --list "$TARGET" >/dev/null; then
  echo "备份文件校验失败：$TARGET" >&2
  rm -f "$TARGET"
  exit 1
fi

log "备份完成，大小 $(wc -c < "$TARGET") 字节"

index=0
while IFS= read -r old; do
  [[ -n "$old" ]] || continue
  index=$((index + 1))
  if [[ "$index" -gt "$KEEP" ]]; then
    rm -f "$old"
    log "删除过期备份 $old"
  fi
done < <(ls -1t "$BACKUP_DIR"/crewtrace-*.dump 2>/dev/null || true)
