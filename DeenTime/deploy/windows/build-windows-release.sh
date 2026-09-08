#!/usr/bin/env bash
# Build a self-contained Windows x64 release of IqamaTime (API + Angular) on
# a Mac/Linux dev machine and zip it for the Windows host.
#
#   ./deploy/windows/build-windows-release.sh            # -> dist/deentime-windows-<sha>.zip
#
# Requires the .NET SDK and Node. The Angular production bundle is copied into
# the API's wwwroot so one process serves both the site and the API.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sha="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo local)"
out="$root/dist/deentime-windows"
rm -rf "$out" && mkdir -p "$out"

echo "==> Publishing API (win-x64, self-contained)"
dotnet publish "$root/backend/DeenTime.Api/DeenTime.Api.csproj" \
  --configuration Release --runtime win-x64 --self-contained true \
  -p:Build__CommitSha="$sha" --output "$out/app"

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
