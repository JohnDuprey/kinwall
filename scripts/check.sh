#!/usr/bin/env bash
# Every check a change must pass before it's pushed (AGENTS.md): server typecheck and tests, web
# typecheck, lint, tests and both builds, and the commit-message check on what isn't on main yet.
# Run from the repo root or a worktree. Exits non-zero on the first failure.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

step() { printf '\n== %s\n' "$*"; }
# node:test prints "ℹ fail N"; a run that prints no summary means the tests didn't load (not a pass).
tests() { local out; out=$(npm test 2>&1) || { echo "$out" | tail -40; return 1; }
  echo "$out" | grep -E '^ℹ (tests|pass|fail) ' || { echo "$out" | tail -40; echo "no test summary: the tests didn't run"; return 1; }
  echo "$out" | grep -qE '^ℹ fail 0$' || { echo "$out" | grep -B2 -A12 'not ok' | head -60; return 1; }; }

step "server: typecheck"; (cd server && npm run typecheck >/dev/null)
step "server: tests";     (cd server && tests)
# `tsc -p .` in web checks nothing (web/tsconfig.json has no files); use the app config.
step "web: typecheck";    (cd web && npx tsc --noEmit -p tsconfig.app.json)
step "web: lint";         (cd web && npm run lint >/dev/null 2>&1 || { npm run lint 2>&1 | tail -30; exit 1; })
step "web: tests";        (cd web && tests)
step "web: build";        (cd web && npm run build >/dev/null 2>&1 || { npm run build 2>&1 | tail -30; exit 1; })
step "web: demo build";   (cd web && npm run build:demo >/dev/null 2>&1 || { npm run build:demo 2>&1 | tail -30; exit 1; })

base=$(git merge-base HEAD origin/main 2>/dev/null || echo "")
if [ -n "$base" ] && [ "$base" != "$(git rev-parse HEAD)" ]; then
  step "commit messages"; git log --no-merges --format=%s "$base..HEAD" | .github/check-commits.sh
fi
printf '\nAll checks passed.\n'
