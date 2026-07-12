#!/usr/bin/env bash
set -euo pipefail

version="${1:?version is required}"
artifact_arch="${2:?artifact architecture is required}"
deb_arch="${3:?Debian architecture is required}"
appimage_arch="${4:?AppImage architecture is required}"

bundle_dir="$(find flutter/build/linux -type d -path '*/release/bundle' -print -quit)"
test -n "$bundle_dir"
test -x "$bundle_dir/camellia"

mkdir -p artifacts

package_root="artifacts/deb-root-${artifact_arch}"
rm -rf "$package_root"
mkdir -p \
  "$package_root/DEBIAN" \
  "$package_root/usr/bin" \
  "$package_root/usr/lib/camellia" \
  "$package_root/usr/share/applications" \
  "$package_root/usr/share/icons/hicolor/128x128/apps"
cp -a "$bundle_dir/." "$package_root/usr/lib/camellia/"
ln -s ../lib/camellia/camellia "$package_root/usr/bin/camellia"
install -m 0644 res/camellia.desktop "$package_root/usr/share/applications/camellia.desktop"
install -m 0644 res/128x128.png "$package_root/usr/share/icons/hicolor/128x128/apps/camellia.png"
printf '%s\n' \
  'Package: camellia' \
  "Version: ${version}" \
  "Architecture: ${deb_arch}" \
  'Maintainer: Camellia <contact@aimmv.com>' \
  'Section: net' \
  'Priority: optional' \
  'Depends: libasound2, libglib2.0-0, libgstreamer1.0-0, libgstreamer-plugins-base1.0-0, libgtk-3-0, libx11-6, libxcb1, libxdo3' \
  'Description: Secure remote desktop client' \
  ' Camellia provides remote access, file transfer, and device management.' \
  > "$package_root/DEBIAN/control"
dpkg-deb --build --root-owner-group \
  "$package_root" \
  "artifacts/camellia-${version}-linux-${artifact_arch}.deb"

appdir="artifacts/Camellia.AppDir"
rm -rf "$appdir"
mkdir -p "$appdir/usr/lib/camellia" "$appdir/usr/share/applications"
cp -a "$bundle_dir/." "$appdir/usr/lib/camellia/"
install -m 0644 res/camellia.desktop "$appdir/camellia.desktop"
install -m 0644 res/128x128.png "$appdir/camellia.png"
ln -s usr/lib/camellia/camellia "$appdir/AppRun"

appimagetool="artifacts/appimagetool-${appimage_arch}.AppImage"
curl --fail --location --retry 3 \
  "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${appimage_arch}.AppImage" \
  --output "$appimagetool"
chmod +x "$appimagetool"
ARCH="$appimage_arch" "$appimagetool" --appimage-extract-and-run \
  "$appdir" \
  "artifacts/camellia-${version}-linux-${artifact_arch}.AppImage"

rm -rf "$package_root" "$appdir" "$appimagetool"
