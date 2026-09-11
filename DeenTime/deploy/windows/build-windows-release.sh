#!/usr/bin/env bash
# Build a Windows release of IqamaTime (Node.js API + Angular) on a Mac/Linux
# dev machine and zip it for the Windows host.
#
#   ./deploy/windows/build-windows-release.sh            # -> dist/deentime-windows-<sha>.zip
#
# Requires Node.js 22+. The API (backend-node) is built with its production
# node_modules; the Angular production bundle is copied into the API's wwwroot
# so one process serves both the site and the API. The Windows PC needs the
# Node.js LTS runtime installed (winget install OpenJS.NodeJS.LTS).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sha="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo local)"
out="$root/dist/deentime-windows"
rm -rf "$out" && mkdir -p "$out"

echo "==> Building API (Node.js)"
( cd "$root/backend-node" && npm ci --no-audit --no-fund && npm run build )
mkdir -p "$out/app"
cp -R "$root/backend-node/dist" "$root/backend-node/prisma" "$out/app/"
cp "$root/backend-node/package.json" "$root/backend-node/package-lock.json" "$root/backend-node/appsettings.json" "$out/app/"
( cd "$out/app" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts )
printf 'Build__CommitSha=%s\nBuild__TimeUtc=%s\n' "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/app/release.env"

echo "==> Building Angular (production)"
( cd "$root/frontend/deentime-web" && npm ci --no-audit --no-fund && npm run build -- --configuration production )
mkdir -p "$out/app/wwwroot"
cp -R "$root/frontend/deentime-web/dist/deentime-web/browser/." "$out/app/wwwroot/"

echo "==> Adding install files"
cp "$root/deploy/windows/install-deentime-iis.ps1" "$root/deploy/windows/install-deentime.ps1" \
   "$root/deploy/windows/appsettings.Production.template.json" "$root/deploy/windows/README.md" "$out/"

mkdir -p "$root/dist"
zip_path="$root/dist/deentime-windows-$sha.zip"
rm -f "$zip_path"
( cd "$out/.." && zip -qr "$zip_path" "$(basename "$out")" )
echo "Release: $zip_path"
