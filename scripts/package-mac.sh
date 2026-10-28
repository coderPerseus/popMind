#!/bin/sh
# Builds the macOS release: the native library, the signed app, and the installers in build/:
#   popMind-<version>.pkg   installs to /Applications/popMind.app over the old copy (quits it, relaunches)
#   popMind <version> arm64.dmg   drag to Applications, over a background with an arrow (dmgbuild)
#   popMind-<version>-mac-arm64.zip
#
# Signing: POPMIND_MAC_SIGN_IDENTITY names the certificate ("popMind Self Signed", the one the Electron app was
# signed with, keeps users' Accessibility / Screen Recording grants across the update); without it the app is
# signed ad hoc, for local testing only.
set -eu
cd "$(dirname "$0")/.."
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.27.3}"

version="$(python3 -c 'import json; print(json.load(open("mygo.json"))["version"])')"
identity="${POPMIND_MAC_SIGN_IDENTITY:--}"
echo "popMind $version, signing identity: $identity"

./native/build.sh arm64
go vet ./...
go test ./...
go tool mygo build -platform darwin/arm64 -sign "$identity" -skip-dmg

app="build/popMind.app"
[ -d "$app" ] || app="$(find build -maxdepth 3 -name 'popMind.app' -type d | head -1)"
[ -d "$app" ] || { echo "popMind.app not found in build/" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$app"

# The installer, as the Electron app shipped: same identifier and location, so it upgrades in place.
root="$(mktemp -d)"
mkdir -p "$root/Applications"
# Without extended attributes: they would ride along as "._" files and spoil the signature once installed.
ditto --norsrc --noextattr --noacl "$app" "$root/Applications/popMind.app"
COPYFILE_DISABLE=1 pkgbuild --root "$root" --identifier com.popmind.app --version "$version" --install-location / \
  --scripts packaging/pkg-scripts "build/popMind-$version.pkg"
rm -rf "$root"

ditto -c -k --norsrc --noextattr --keepParent "$app" "build/popMind-$version-mac-arm64.zip"

# The disk image: the app beside a link to /Applications over packaging/dmg-background*.png (drawn by
# TestRenderDMGBackground), laid out by dmgbuild (pip), which writes Finder's layout without AppleScript.
dmgbuild_bin="$(command -v dmgbuild || true)"
if [ -z "$dmgbuild_bin" ]; then
  venv="build/.dmgbuild-venv"
  [ -x "$venv/bin/dmgbuild" ] || { python3 -m venv "$venv" && "$venv/bin/pip" install --quiet "dmgbuild==1.6.7"; }
  dmgbuild_bin="$venv/bin/dmgbuild"
fi
background="build/dmg-background.tiff"
tiffutil -cathidpicheck packaging/dmg-background.png packaging/dmg-background@2x.png -out "$background"
dmg="build/popMind $version arm64.dmg"
rm -f "$dmg"
"$dmgbuild_bin" -s packaging/dmg-settings.py -D app="$app" -D background="$background" "popMind" "$dmg"
if [ "$identity" != "-" ]; then
  codesign --force --sign "$identity" "$dmg"
fi
# The same image under a name that never changes, which the website's download button points to
# (releases/latest/download/popMind-arm64.dmg).
cp "$dmg" build/popMind-arm64.dmg
ls -lh build/*.pkg build/*.dmg build/*.zip
