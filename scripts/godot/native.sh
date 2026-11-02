#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
version=2026-06-04
sha=b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a
cache=.tools/quickjs-$version
mkdir -p "$cache" integrations/godot/generated
if [[ ! -f "$cache/source.tar.xz" ]]; then
  curl --fail --location --silent --show-error "https://bellard.org/quickjs/quickjs-$version.tar.xz" -o "$cache/source.tar.xz"
fi
printf '%s  %s\n' "$sha" "$cache/source.tar.xz" | sha256sum --check
if [[ ! -f "$cache/quickjs.c" ]]; then tar xf "$cache/source.tar.xz" -C "$cache" --strip-components=1; fi
gcc -O2 -fPIC -shared -fvisibility=default -D_GNU_SOURCE -DCONFIG_VERSION=\"$version\" \
  -I"$cache" integrations/godot/native/bridge.c "$cache/quickjs.c" "$cache/dtoa.c" \
  "$cache/libregexp.c" "$cache/libunicode.c" "$cache/cutils.c" \
  -o integrations/godot/generated/libtower_quickjs.so -lm -lpthread
cp "$cache/LICENSE" integrations/godot/generated/QUICKJS-LICENSE.txt
