#!/usr/bin/env bash
# DeenTime staging release script for the plain-Ubuntu box (nginx + systemd).
# Runs as root on the server. Invoked by GitHub Actions as:
#   bash /opt/deentime/deploy-staging.sh <commit-sha>
#
# Expects in /opt/deentime/incoming:
#   deentime-api-<sha>.tar.gz   Node.js API build (dist/, node_modules/, prisma/, appsettings.json)
#   deentime-web-<sha>.tar.gz   Angular static bundle (dist/deentime-web/browser)
# and, alongside this script, deentime-api.service (installed on every release).
set -euo pipefail

release_tag="${1:?Usage: deploy-staging.sh <release-tag>}"
if [[ ! "$release_tag" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "Release tag must be a 7-64 character Git commit SHA." >&2
  exit 1
fi

deploy_dir=/opt/deentime
web_root=/var/www/deentime
env_file=/etc/deentime/deentime.env
service_user=deentime
api_port=5080
unit_src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deentime-api.service"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file (database, signing key, and other secrets)." >&2
  exit 1
fi
if ! id "$service_user" >/dev/null 2>&1; then
  echo "System user '$service_user' does not exist." >&2
  exit 1
fi
for required_command in curl install node rsync systemctl tar; do
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
if [[ -f "$deploy_dir/.deployed-tag" ]]; then
  previous_tag="$(tr -d '[:space:]' < "$deploy_dir/.deployed-tag")"
fi

# ── Unpack the release ───────────────────────────────────────────────────────
rm -rf "$release_dir"
mkdir -p "$release_dir/api" "$release_dir/web" "$deploy_dir/shared/uploads" "$web_root"
tar -xzf "$api_tar" -C "$release_dir/api"
tar -xzf "$web_tar" -C "$release_dir/web"
if [[ ! -f "$release_dir/api/dist/main.js" ]]; then
  echo "The API archive does not contain dist/main.js." >&2
  exit 1
fi
cat > "$release_dir/release.env" <<EOF
Build__CommitSha=$release_tag
Build__TimeUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# Uploads must survive releases: replace the release's uploads dir with a
# symlink into the shared directory.
mkdir -p "$release_dir/api/wwwroot"
rm -rf "$release_dir/api/wwwroot/uploads"
ln -s "$deploy_dir/shared/uploads" "$release_dir/api/wwwroot/uploads"
chown -R "$service_user:$service_user" "$release_dir" "$deploy_dir/shared"

activate() {
  local tag="$1"
  ln -sfn "$deploy_dir/releases/$tag" "$deploy_dir/current"
  systemctl restart deentime-api
}

install_service() {
  if [[ -f "$unit_src" ]]; then
    install -m 0644 "$unit_src" /etc/systemd/system/deentime-api.service
    systemctl daemon-reload
  fi
  systemctl enable deentime-api >/dev/null
}

publish_web() {
  local tag="$1"
  rsync -a --delete --exclude '.well-known' "$deploy_dir/releases/$tag/web/" "$web_root/"
}

health_check() {
  for _ in $(seq 1 24); do
    if curl -fsS "http://127.0.0.1:$api_port/health/ready" >/dev/null 2>&1; then
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
  systemctl status deentime-api --no-pager >&2 || true
  journalctl -u deentime-api --no-pager -n 120 >&2 || true

  if [[ -n "$previous_tag" && "$previous_tag" != "$release_tag" \
        && -d "$deploy_dir/releases/$previous_tag" ]]; then
    echo "Release failed health checks; rolling back to $previous_tag." >&2
    activate "$previous_tag"
  fi
  exit 1
fi

publish_web "$release_tag"

printf '%s\n' "$release_tag" > "$deploy_dir/.deployed-tag"
rm -f "$api_tar" "$web_tar"

# Keep the five most recent releases for rollback.
ls -1t "$deploy_dir/releases" | tail -n +6 | while read -r old; do
  rm -rf "$deploy_dir/releases/$old"
done

echo "Deployed $release_tag successfully."
