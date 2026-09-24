#!/usr/bin/env sh
# Cloudflare dashboard "Build command". Writes this account's settings, set as dashboard Build
# variables, into the build's own copy of wrangler.toml, so the repo stays generic and nothing
# account-specific is committed:
#   D1_DATABASE_ID  the D1 database to use (otherwise wrangler auto-provisions one)
#   CUSTOM_DOMAIN   e.g. kinwall.example.com - served as a custom domain, workers.dev turned off
set -eu
cd "$(dirname "$0")/.."

if [ -n "${D1_DATABASE_ID:-}" ]; then
  awk -v id="$D1_DATABASE_ID" '{ print } /^binding = "DB"$/ { print "database_name = \"kinwall-db\""; print "database_id = \"" id "\"" }' wrangler.toml > wrangler.toml.tmp
  mv wrangler.toml.tmp wrangler.toml
  echo "wrangler.toml: D1 database $D1_DATABASE_ID"
fi

if [ -n "${CUSTOM_DOMAIN:-}" ]; then
  # Top-level keys must come before the first [table], so insert right after compatibility_flags.
  awk -v d="$CUSTOM_DOMAIN" '{ print } /^compatibility_flags/ { print "routes = [{ pattern = \"" d "\", custom_domain = true }]"; print "workers_dev = false"; print "preview_urls = false" }' wrangler.toml > wrangler.toml.tmp
  mv wrangler.toml.tmp wrangler.toml
  echo "wrangler.toml: custom domain $CUSTOM_DOMAIN (workers.dev off)"
fi
