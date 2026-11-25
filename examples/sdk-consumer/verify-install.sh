#!/usr/bin/env bash
set -euo pipefail

# 在仓库之外的临时目录安装并运行独立消费者，避免误用工作区源码或已安装依赖。
SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crewtrace-sdk-consumer.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

cp "$SRC/package.json" "$SRC/run.mjs" "$SRC/generate-inputs.mjs" "$WORK/"
mkdir -p "$WORK/.pack"
npm pack "$SRC/../../packages/attestation" --pack-destination "$WORK/.pack" >/dev/null

cd "$WORK"
npm install --no-save ./.pack/*.tgz >/dev/null
node generate-inputs.mjs
node run.mjs
