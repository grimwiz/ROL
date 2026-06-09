#!/usr/bin/env bash
#
# Pinned deploy for The Folly. Run on the server after changes land on main.
#
# Why `npm ci` (not `npm install`): ci installs EXACTLY what package-lock.json
# pins and verifies every integrity hash, refusing to drift the lockfile. That
# is what keeps a new/updated server on the approved, reviewed versions instead
# of "whatever the registry serves today". Dependency updates are taken
# deliberately (bump + audit + commit a new lockfile), never forced at deploy.
#
# --omit=dev: the only devDeps are the Excalidraw build tooling, and the built
# bundle is committed under public/vendor/, so the server never needs to build
# anything — it just runs the tracked artifact.
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Fetching origin/main"
git fetch --prune origin

# Deploy boxes hold no local commits, so match the approved remote exactly.
# (A plain `git pull` would conflict after a history rewrite; reset is robust.)
echo "==> Resetting working tree to origin/main"
git reset --hard origin/main

echo "==> Installing pinned dependencies (npm ci --omit=dev)"
npm ci --omit=dev

echo
echo "Done. Restart the service to pick up changes, e.g.:"
echo "    sudo systemctl restart folly"
