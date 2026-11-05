#!/bin/bash
# Builds the native helpers (native/*.swift: cmdtap for quick add's
# double tap, pointer for hover in the background) as universal binaries in
# build/native/, which electron-builder ships in the app's Resources.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/native
tmp=$(mktemp -d)
for tool in cmdtap pointer; do
  for arch in arm64 x86_64; do
    swiftc -O -target "$arch-apple-macos13" "native/$tool.swift" -o "$tmp/$tool-$arch"
  done
  lipo -create "$tmp/$tool-arm64" "$tmp/$tool-x86_64" -output "build/native/$tool"
  echo "built build/native/$tool"
done
rm -rf "$tmp"
