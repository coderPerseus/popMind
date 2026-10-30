#!/bin/sh
# Builds popMind for Windows (x64) from macOS or Linux, in build/:
#   popMind-<version>-windows-x64-setup.exe   the installer (NSIS: `brew install makensis` / `apt install nsis`)
#   popMind-windows-x64-setup.exe             the same, under the name the website downloads
#   windows-amd64/popmind-<version>-windows-amd64.tar.gz, update-windows-amd64.json   in-app updates
# MYGO_UPDATER_PRIVATE_KEY signs the updates (as for macOS). The app is not code-signed: Windows SmartScreen
# warns on first run.
set -eu
cd "$(dirname "$0")/.."
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.27.3}"

version="$(python3 -c 'import json; print(json.load(open("mygo.json"))["version"])')"
echo "popMind $version for Windows"

GOOS=windows GOARCH=amd64 go vet ./...
go tool mygo build -platform windows/amd64

setup="build/windows-amd64/popMind Setup $version amd64.exe"
[ -f "$setup" ] || { echo "installer not found: $setup (is NSIS installed?)" >&2; exit 1; }
cp "$setup" "build/popMind-$version-windows-x64-setup.exe"
cp "$setup" "build/popMind-windows-x64-setup.exe"
ls -lh build/*windows-x64-setup.exe build/windows-amd64/*.tar.gz build/windows-amd64/update-*.json 2>/dev/null || true
