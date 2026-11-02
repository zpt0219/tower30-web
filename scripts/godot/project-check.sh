#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
artifacts="${TOWER_ARTIFACT_DIR:-$(cat .artifact-dir)}"
mkdir -p "$artifacts"
export TOWER_ARTIFACT_DIR="$artifacts"
preview_pid=''
cleanup(){
  if [[ -n "$preview_pid" ]]; then kill "$preview_pid" 2>/dev/null || true; wait "$preview_pid" 2>/dev/null || true; fi
  chmod -R 777 "$artifacts"
}
trap cleanup EXIT
npm run build
npm run build:godot
bash scripts/godot/engine.sh --headless --editor --path integrations/godot --import
if [[ -z "${TOWER_E2E_BASE_URL:-}" ]]; then
  node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4193 --strictPort > "$artifacts/project-preview.log" 2>&1 &
  preview_pid=$!
  export TOWER_E2E_BASE_URL=http://127.0.0.1:4193
  for attempt in {1..50}; do
    if ! kill -0 "$preview_pid" 2>/dev/null; then cat "$artifacts/project-preview.log"; exit 1; fi
    if curl --fail --silent "$TOWER_E2E_BASE_URL" > /dev/null; then break; fi
    sleep .1
  done
fi
printf '{' > "$artifacts/invalid-project.json"
python3 -c 'import os,pathlib; (pathlib.Path(os.environ["TOWER_ARTIFACT_DIR"])/"oversize-project.json").write_text(" "*2000001)'
npx playwright test project-godot.spec.ts --workers=1
xvfb-run -a -s '-screen 0 1280x720x24' bash scripts/godot/engine.sh --path integrations/godot --resolution 1280x720 --max-fps 60 -- --fresh --project-test="$artifacts/desktop-project-checks.json"
xvfb-run -a -s '-screen 0 1200x700x24' bash scripts/godot/engine.sh --path integrations/godot --resolution 1000x450 --max-fps 60 -- --fresh --project-test="$artifacts/mobile-landscape-project-checks.json"
node scripts/godot/compare-project.mjs --prepare
for host in desktop mobile-landscape; do
  bash scripts/godot/engine.sh --headless --path integrations/godot -- --verify="$artifacts/$host-continue-requests.jsonl" --responses="$artifacts/$host-godot-continue-responses.jsonl"
done
node scripts/godot/compare-project.mjs
npx playwright test project-record.spec.ts --workers=1
