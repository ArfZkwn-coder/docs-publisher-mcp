#!/bin/sh
# Prepares Git and the site clone used by deploy_site, then starts the HTTP connector.
set -e

git config --global user.name "${GIT_AUTHOR_NAME:-docs-publisher}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-docs-publisher@users.noreply.github.com}"
# Git authenticates with GITHUB_TOKEN through a helper, so the token never appears in a
# remote URL or in the command output that deploy_site returns.
git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'

if [ -n "$SITE_DIR" ]; then
  if [ ! -d "$SITE_DIR/.git" ]; then
    echo "Cloning $DOCS_REPO into $SITE_DIR"
    git clone "https://github.com/$DOCS_REPO.git" "$SITE_DIR"
  fi
  cd "$SITE_DIR"
  git pull --ff-only || echo "warning: could not update $SITE_DIR; deploy_site will pull again"
  # Reinstall the site's dependencies only when its lockfile has changed.
  hash=$(sha256sum package-lock.json | cut -d' ' -f1)
  if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$hash" ]; then
    npm ci --no-audit --no-fund
    echo "$hash" > node_modules/.lock-hash
  fi
  cd /app
fi

exec node src/http.js
