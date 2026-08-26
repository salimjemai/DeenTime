#!/usr/bin/env bash
set -euo pipefail

release_tag="${1:?Usage: deploy-staging.sh <release-tag>}"
if [[ ! "$release_tag" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "Release tag must be a 7-64 character Git commit SHA." >&2
  exit 1
fi
deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$deploy_dir"

if [[ ! -f .env.staging ]]; then
  echo "Missing $deploy_dir/.env.staging. Create it from .env.staging.example before deploying." >&2
  exit 1
fi

# DEENTIME_WEB_ROOT tells the script where OpenLiteSpeed serves the site from,
# e.g. /home/iqama.momyum.com/public_html
web_root="$(grep -E '^DEENTIME_WEB_ROOT=' .env.staging | tail -1 | cut -d= -f2- || true)"
if [[ -z "$web_root" ]]; then
  echo "Set DEENTIME_WEB_ROOT in .env.staging (the OpenLiteSpeed document root)." >&2
  exit 1
fi
if [[ ! -d "$web_root" || ! -w "$web_root" ]]; then
  echo "OpenLiteSpeed document root is missing or not writable: $web_root" >&2
  exit 1
fi

for required_command in curl install rsync systemctl tar; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required server command is missing: $required_command" >&2
    exit 1
  fi
done

release_dir="$deploy_dir/releases/$release_tag"
api_tar="$deploy_dir/incoming/deentime-api-$release_tag.tar.gz"
web_tar="$deploy_dir/incoming/deentime-web-$release_tag.tar.gz"

for f in "$api_tar" "$web_tar"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing release archive: $f" >&2
    exit 1
  fi
done

previous_tag=""
if [[ -f .deployed-tag ]]; then
  previous_tag="$(tr -d '[:space:]' < .deployed-tag)"
fi

# ── Unpack the release ───────────────────────────────────────────────────────
rm -rf "$release_dir"
mkdir -p "$release_dir/api" "$release_dir/web" shared/uploads
tar -xzf "$api_tar" -C "$release_dir/api"
tar -xzf "$web_tar" -C "$release_dir/web"
chmod +x "$release_dir/api/DeenTime.Api"
cat > "$release_dir/release.env" <<EOF
Build__CommitSha=$release_tag
Build__TimeUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# Uploads must survive releases: replace the release's uploads dir with a
# symlink into the shared directory.
mkdir -p "$release_dir/api/wwwroot"
rm -rf "$release_dir/api/wwwroot/uploads"
ln -s "$deploy_dir/shared/uploads" "$release_dir/api/wwwroot/uploads"

activate() {
  local tag="$1"
  ln -sfn "$deploy_dir/releases/$tag" "$deploy_dir/current"
  systemctl --user restart deentime-api
}

install_service() {
  mkdir -p "$HOME/.config/systemd/user"
  install -m 0644 "$deploy_dir/deentime-api.service" "$HOME/.config/systemd/user/deentime-api.service"
  systemctl --user daemon-reload
  systemctl --user enable deentime-api >/dev/null
}

publish_web() {
  local tag="$1"
  rsync -a --delete \
    --exclude '.well-known' \
    --exclude '.htaccess' \
    "$deploy_dir/releases/$tag/web/" "$web_root/"
}

health_check() {
  for _ in $(seq 1 24); do
    if curl -fsS http://127.0.0.1:18080/health/ready >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

# ── Activate and verify ──────────────────────────────────────────────────────
install_service
activate "$release_tag"

if ! health_check; then
  systemctl --user status deentime-api --no-pager >&2 || true
  journalctl --user -u deentime-api --no-pager -n 120 >&2 || true

  if [[ -n "$previous_tag" && "$previous_tag" != "$release_tag" \
        && -d "$deploy_dir/releases/$previous_tag" ]]; then
    echo "Release failed health checks; rolling back to $previous_tag." >&2
    activate "$previous_tag"
  fi
  exit 1
fi

publish_web "$release_tag"

printf '%s\n' "$release_tag" > .deployed-tag
rm -f "$api_tar" "$web_tar"

# Keep the five most recent releases for rollback.
ls -1t "$deploy_dir/releases" | tail -n +6 | while read -r old; do
  rm -rf "$deploy_dir/releases/$old"
done

echo "Deployed $release_tag successfully."
