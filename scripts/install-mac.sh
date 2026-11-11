#!/bin/bash
# Builds ClearDay for this Mac's architecture and installs it into
# /Applications. The build is re-signed locally (scripts/after-pack.js):
# without an Apple Developer certificate, Electron's own signature is all the
# app would carry, and macOS refuses to launch a bundle whose contents no
# longer match it.
#
# Signing identity: $MAC_SIGN_IDENTITY, else the keychain certificate
# "ClearDay Signing" if one exists, else ad-hoc. A certificate keeps the
# signature stable across rebuilds, so macOS keeps treating each build as the
# same app, and quick add keeps its Input Monitoring permission.
set -euo pipefail
cd "$(dirname "$0")/.."

arch=$(uname -m)                       # arm64 or x86_64
[ "$arch" = x86_64 ] && arch=x64
name="ClearDay"
out="dist/mac$([ "$arch" = arm64 ] && echo -arm64)/$name.app"

SIGN_ID=${MAC_SIGN_IDENTITY:-}
if [ -z "$SIGN_ID" ] && security find-identity -p codesigning | grep -q '"ClearDay Signing"'; then
  SIGN_ID="ClearDay Signing"
fi
SIGN_ID=${SIGN_ID:--}
export MAC_SIGN_IDENTITY=$SIGN_ID

bash scripts/build-native.sh
npx electron-builder --mac dir "--$arch"

# Quit the app only. Claude's MCP servers run on the same binary (with
# server.mjs after it), and killing them disconnects Claude until it restarts.
pkill -f "/$name.app/Contents/MacOS/$name\$" 2>/dev/null || true
# Opening it again while it is still quitting fails (LaunchServices -609).
for _ in $(seq 20); do pgrep -f "/$name.app/Contents/MacOS/$name\$" >/dev/null || break; sleep 0.25; done
rm -rf "/Applications/$name.app"
ditto "$out" "/Applications/$name.app"
open "/Applications/$name.app"
echo "installed /Applications/$name.app"
