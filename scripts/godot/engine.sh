#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${GODOT:-}" ]]; then exec "$GODOT" "$@"; fi
if command -v godot-mono >/dev/null 2>&1; then exec godot-mono "$@"; fi
local_engine="$HOME/apps/godot-4.6.2-csharp/Godot_v4.6.2-stable_mono_linux_x86_64/Godot_v4.6.2-stable_mono_linux.x86_64"
if [[ -x "$local_engine" ]]; then exec "$local_engine" "$@"; fi
printf '%s\n' 'Set GODOT to the Godot 4.6.2 .NET executable (not the standard build).' >&2
exit 1
