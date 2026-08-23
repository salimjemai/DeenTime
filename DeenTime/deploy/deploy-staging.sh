#!/usr/bin/env bash
set -euo pipefail

release_tag="${1:?Usage: deploy-staging.sh <image-tag>}"
deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$deploy_dir"

if [[ ! -f .env.staging ]]; then
  echo "Missing $deploy_dir/.env.staging. Create it from .env.staging.example before deploying." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "The deployment account cannot access Docker. Add it to the docker group or install a scoped deploy command." >&2
  exit 1
fi

previous_tag=""
if [[ -f .deployed-tag ]]; then
  previous_tag="$(tr -d '[:space:]' < .deployed-tag)"
fi

export DEENTIME_IMAGE_TAG="$release_tag"
docker compose -f compose.staging.yml config --quiet
docker compose -f compose.staging.yml up -d --remove-orphans

ready=false
for _ in $(seq 1 24); do
  if curl -fsS http://127.0.0.1:18080/health/ready >/dev/null \
    && curl -fsS http://127.0.0.1:10080/health/ready >/dev/null; then
    ready=true
    break
  fi
  sleep 5
done

if [[ "$ready" != "true" ]]; then
  docker compose -f compose.staging.yml ps >&2
  docker compose -f compose.staging.yml logs --tail=120 >&2 || true

  if [[ -n "$previous_tag" && "$previous_tag" != "$release_tag" ]]; then
    echo "Release failed health checks; rolling back to $previous_tag." >&2
    export DEENTIME_IMAGE_TAG="$previous_tag"
    docker compose -f compose.staging.yml up -d --remove-orphans
  fi
  exit 1
fi

printf '%s\n' "$release_tag" > .deployed-tag
docker image prune -f --filter until=168h >/dev/null
echo "Deployed $release_tag successfully."
