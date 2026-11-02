#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Run npm run test:godot first: it builds resources and creates genuine Boss report checkpoints.
artifacts="${TOWER_ARTIFACT_DIR:-$(cat .artifact-dir)}"
for floor in 10 20 30; do
  [[ -f "$artifacts/native-boss-$floor-unclaimed.json" ]] || { printf '%s\n' 'Run npm run test:godot first to generate verified normal-resource checkpoints.' >&2; exit 1; }
done
trap 'chmod -R 777 "$artifacts"' EXIT
xvfb-run -a -s '-screen 0 1280x720x24' bash scripts/godot/engine.sh \
  --path integrations/godot --resolution 1280x720 --max-fps 60 -- --fresh \
  --ui-test="$artifacts/desktop-ui-checks.json"
xvfb-run -a -s '-screen 0 1200x700x24' bash scripts/godot/engine.sh \
  --path integrations/godot --resolution 1000x450 --max-fps 60 -- --fresh \
  --ui-test="$artifacts/mobile-landscape-ui-checks.json"
