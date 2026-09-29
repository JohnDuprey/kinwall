#!/usr/bin/env bash
# Start work on a feature in its own worktree next to this repo, on a fresh branch from main:
#   scripts/new-feature.sh recipe-timers   ->   ../kinwall-recipe-timers on branch recipe-timers
# Each worktree gets its own `npm ci` (never symlink node_modules: a branch's install would change
# main's packages). Finish with scripts/finish-feature.sh once the work is on main.
set -euo pipefail
name=${1:?usage: scripts/new-feature.sh <name>}
root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
cd "$root"
git fetch -q origin main
dir="$(dirname "$root")/kinwall-$name"
git worktree add -q -b "$name" "$dir" origin/main
(cd "$dir/server" && npm ci --silent) && (cd "$dir/web" && npm ci --silent)
# Copy the local code graph (AGENTS.md) so the worktree has one; scripts/graph.sh refreshes it.
[ -d graphify-out ] && cp -R graphify-out "$dir/"
echo "Ready: $dir (branch $name). Run scripts/check.sh there before pushing."
