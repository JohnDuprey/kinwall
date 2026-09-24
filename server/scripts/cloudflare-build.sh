#!/usr/bin/env sh
# Build step for Cloudflare Workers Builds (git-connected deploys). Run from server/.
# Builds the web UI into ../web/dist, installs server deps, and - if the D1_DATABASE_ID build
# variable is set in the Cloudflare dashboard - writes it into this build's copy of wrangler.toml,
# so the database ID never has to be committed. The repo keeps the all-zeros placeholder.
set -eu

(cd ../web && npm ci && npm run build)
npm ci

if [ -n "${D1_DATABASE_ID:-}" ]; then
  sed -i.bak "s/^database_id = \".*\"/database_id = \"${D1_DATABASE_ID}\"/" wrangler.toml && rm -f wrangler.toml.bak
  echo "D1 database_id set from the D1_DATABASE_ID build variable"
elif grep -q '^database_id = "00000000-0000-0000-0000-000000000000"' wrangler.toml; then
  echo "error: set the D1_DATABASE_ID build variable (Settings > Build > Variables) to your D1 database's ID" >&2
  exit 1
fi
