#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run build:godot
bash scripts/godot/engine.sh --headless --editor --path integrations/godot --import
exec bash scripts/godot/engine.sh --path integrations/godot "$@"
