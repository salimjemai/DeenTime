#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

api_port="${DEENTIME_API_PORT:-8080}"
db_port="${DEENTIME_DB_PORT:-5432}"
web_port="${DEENTIME_WEB_PORT:-4200}"
export DEENTIME_PUBLIC_BASE_URL="${DEENTIME_PUBLIC_BASE_URL:-http://127.0.0.1:${web_port}}"
compose=(docker compose)
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then compose+=( -p "$COMPOSE_PROJECT_NAME" ); fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the deterministic local stack." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

compose_running_api="$("${compose[@]}" ps -q api 2>/dev/null || true)"
compose_running_db="$("${compose[@]}" ps -q db 2>/dev/null || true)"

check_port() {
  local port="$1"
  local owner
  owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$owner" ]]; then return; fi
  if [[ "$port" == "$api_port" && -n "$compose_running_api" ]]; then return; fi
  if [[ "$port" == "$db_port" && -n "$compose_running_db" ]]; then return; fi
  echo "Port $port is already owned by another process:" >&2
  echo "$owner" >&2
  echo "Stop that exact process or choose a different local stack before continuing." >&2
  exit 1
}

check_port "$db_port"
check_port "$api_port"

if [[ -z "${DEENTIME_AUTH_SIGNING_KEY:-}" ]]; then
  DEENTIME_AUTH_SIGNING_KEY="$(openssl rand -hex 32)"
  export DEENTIME_AUTH_SIGNING_KEY
  echo "Generated an ephemeral local JWT signing key for this shell." >&2
fi
if [[ -z "${DEENTIME_SUPERUSER_PASSWORD:-}" ]]; then
  DEENTIME_SUPERUSER_PASSWORD="LocalOnly-$(openssl rand -hex 8)"
  export DEENTIME_SUPERUSER_PASSWORD
  echo "Generated local super-user credentials: admin@deentime.dev / $DEENTIME_SUPERUSER_PASSWORD" >&2
fi

"${compose[@]}" up -d --build

ready="false"
for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${api_port}/health/ready" >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "The API did not become ready within 60 seconds." >&2
  "${compose[@]}" ps >&2
  exit 1
fi

echo "API ready at http://127.0.0.1:${api_port} (version: $(curl -fsS "http://127.0.0.1:${api_port}/api/version"))"
echo "Starting Angular at http://127.0.0.1:${web_port}"
trap 'kill 0' EXIT INT TERM
npm --prefix frontend/deentime-web start -- --host 127.0.0.1 --port "$web_port"
