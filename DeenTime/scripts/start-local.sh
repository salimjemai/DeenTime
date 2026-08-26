#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

api_port="${DEENTIME_API_PORT:-8080}"
db_port="${DEENTIME_DB_PORT:-5432}"
web_port="${DEENTIME_WEB_PORT:-4200}"
export DEENTIME_PUBLIC_BASE_URL="${DEENTIME_PUBLIC_BASE_URL:-http://127.0.0.1:${web_port}}"

if ! command -v dotnet >/dev/null 2>&1; then
  echo "The .NET 9 SDK is required (https://dotnet.microsoft.com/download)." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  postgres_bin="$(brew --prefix postgresql@16 2>/dev/null)/bin"
  if [[ -x "$postgres_bin/psql" ]]; then
    export PATH="$postgres_bin:$PATH"
  fi
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL is required. On macOS: brew install postgresql@16 && brew services start postgresql@16" >&2
  exit 1
fi

# ── PostgreSQL ───────────────────────────────────────────────────────────────
if ! pg_isready -h 127.0.0.1 -p "$db_port" >/dev/null 2>&1; then
  echo "PostgreSQL is not listening on 127.0.0.1:${db_port}." >&2
  echo "Start it first, e.g.: brew services start postgresql@16" >&2
  exit 1
fi

# The API's appsettings.Development.json connects as postgres/postgres.
# Homebrew initializes the cluster with your macOS user as the superuser,
# so create the expected role and database if they are missing.
if ! psql -h 127.0.0.1 -p "$db_port" -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname='postgres'" 2>/dev/null | grep -q 1; then
  echo "Creating PostgreSQL role 'postgres'..."
  createuser -h 127.0.0.1 -p "$db_port" -s postgres
fi
psql -h 127.0.0.1 -p "$db_port" -d postgres -qc \
  "ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres'" >/dev/null

if ! psql -h 127.0.0.1 -p "$db_port" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='deentime'" | grep -q 1; then
  echo "Creating database 'deentime'..."
  createdb -h 127.0.0.1 -p "$db_port" -U postgres -O postgres deentime
fi

# ── Ports ────────────────────────────────────────────────────────────────────
check_port() {
  local port="$1"
  local owner
  owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$owner" ]]; then
    echo "Port $port is already owned by another process:" >&2
    echo "$owner" >&2
    echo "Stop that exact process or choose a different port before continuing." >&2
    exit 1
  fi
}
check_port "$api_port"

# ── Secrets ──────────────────────────────────────────────────────────────────
if [[ -z "${DEENTIME_AUTH_SIGNING_KEY:-}" ]]; then
  DEENTIME_AUTH_SIGNING_KEY="$(openssl rand -hex 32)"
  echo "Generated an ephemeral local JWT signing key for this shell." >&2
fi
if [[ -z "${DEENTIME_SUPERUSER_PASSWORD:-}" ]]; then
  DEENTIME_SUPERUSER_PASSWORD="LocalOnly-$(openssl rand -hex 8)"
  echo "Generated local super-user credentials: admin@deentime.dev / $DEENTIME_SUPERUSER_PASSWORD" >&2
fi

# ── API ──────────────────────────────────────────────────────────────────────
api_pid=""
cleanup() {
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ASPNETCORE_ENVIRONMENT=Development \
ASPNETCORE_URLS="http://127.0.0.1:${api_port}" \
ConnectionStrings__Default="Host=localhost;Port=${db_port};Database=deentime;Username=postgres;Password=postgres" \
Auth__SigningKey="$DEENTIME_AUTH_SIGNING_KEY" \
SuperUser__Password="$DEENTIME_SUPERUSER_PASSWORD" \
IslamicContent__HadithApiKey="${DEENTIME_HADITH_API_KEY:-}" \
Frontend__PublicBaseUrl="$DEENTIME_PUBLIC_BASE_URL" \
dotnet run --project backend/DeenTime.Api/DeenTime.Api.csproj &
api_pid=$!

ready="false"
for _ in $(seq 1 90); do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "The API process exited before becoming ready." >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${api_port}/health/ready" >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "The API did not become ready within 90 seconds." >&2
  exit 1
fi

echo "API ready at http://127.0.0.1:${api_port} (version: $(curl -fsS "http://127.0.0.1:${api_port}/api/version"))"
echo "Starting Angular at http://127.0.0.1:${web_port}"
npm --prefix frontend/deentime-web start -- --host 127.0.0.1 --port "$web_port"
