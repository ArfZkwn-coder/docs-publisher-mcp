#!/bin/sh
# Builds the image and (re)starts the connector container, for Docker hosts without
# `docker compose` (such as ZimaOS). Run from this folder as root: sh run.sh
set -e
cd "$(dirname "$0")"

# The admin API (port 8788, used by n8n) is published only on the Docker bridge address,
# so other containers on this host can reach it but your network and the internet can't.
ADMIN_BIND="${ADMIN_BIND:-172.17.0.1}"

docker build -t docs-publisher:local .
docker rm -f docs-publisher >/dev/null 2>&1 || true
docker run -d --name docs-publisher --restart unless-stopped \
  --env-file .env -e PORT=8787 -e SITE_DIR=/data/site \
  -p 8787:8787 -p "$ADMIN_BIND:8788:8788" -v "$PWD/data:/data" \
  docs-publisher:local

echo "Started. Follow the logs with: docker logs -f docs-publisher"
