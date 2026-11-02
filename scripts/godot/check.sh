#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Outputs follow the same NAS artifact contract as the browser checks.
if [[ -n "${TOWER_ARTIFACT_DIR:-}" ]]; then
  mkdir -p "$TOWER_ARTIFACT_DIR"
elif [[ -f .artifact-dir ]]; then
  TOWER_ARTIFACT_DIR=$(cat .artifact-dir)
else
  TOWER_ARTIFACT_DIR="/srv/nas/Shared/hd2d-videos/$(date +%y%m%d_%H%M)_tower30_godot_checks"
  mkdir -p "$TOWER_ARTIFACT_DIR"
  printf '%s\n' "$TOWER_ARTIFACT_DIR" > .artifact-dir
fi
export TOWER_ARTIFACT_DIR
trap 'chmod -R 777 "$TOWER_ARTIFACT_DIR"' EXIT
npm run build:godot
bash scripts/godot/engine.sh --headless --editor --path integrations/godot --import
node scripts/godot/fixtures.mjs
bash scripts/godot/engine.sh --headless --path integrations/godot -- \
  --verify="$TOWER_ARTIFACT_DIR/requests.jsonl" --responses="$TOWER_ARTIFACT_DIR/godot-responses.jsonl"
node scripts/godot/compare.mjs
