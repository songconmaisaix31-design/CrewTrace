#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

rm -rf .pack node_modules package-lock.json
mkdir -p .pack
npm pack ../../packages/attestation --pack-destination .pack
npm install --no-save ./.pack/*.tgz
node generate-inputs.mjs
node run.mjs
