#!/bin/sh
# Builds libpopmind_native.dylib into resources/darwin-<arch>/, where myGo ships platform resources.
set -eu
cd "$(dirname "$0")/.."
arch="${1:-$(uname -m)}"
case "$arch" in
  arm64) goarch=arm64 ;;
  x86_64 | amd64) arch=x86_64; goarch=amd64 ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac
out="resources/darwin-$goarch"
mkdir -p "$out"
xcrun clang++ -std=c++17 -O2 -arch "$arch" -mmacosx-version-min=12.0 -fno-objc-arc -fvisibility=hidden \
  -dynamiclib -install_name @rpath/libpopmind_native.dylib \
  -framework AppKit -framework ApplicationServices -framework Carbon -framework Vision \
  -framework ScreenCaptureKit -framework CoreGraphics -framework ImageIO -framework QuartzCore \
  -o "$out/libpopmind_native.dylib" native/popmind_native.mm
echo "built $out/libpopmind_native.dylib"
