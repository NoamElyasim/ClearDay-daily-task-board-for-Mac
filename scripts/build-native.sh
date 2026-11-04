#!/bin/bash
# Builds the ⌘⌘ helper (native/cmdtap.swift) as one universal binary in
# build/native/, which electron-builder ships in the app's Resources.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/native
tmp=$(mktemp -d)
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13" native/cmdtap.swift -o "$tmp/cmdtap-$arch"
done
lipo -create "$tmp/cmdtap-arm64" "$tmp/cmdtap-x86_64" -output build/native/cmdtap
rm -rf "$tmp"
echo "built build/native/cmdtap"
