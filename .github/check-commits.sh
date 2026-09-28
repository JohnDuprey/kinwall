#!/usr/bin/env bash
# Conventional Commits check (see AGENTS.md): every non-merge commit in the range, or subjects on stdin.
set -euo pipefail
re='^(feat|fix|docs|test|refactor|perf|style|chore|ci|build|revert)(\([a-z0-9][a-z0-9-]*\))?!?: [^ ].*$|^Revert "'
if [ $# -eq 0 ]; then subjects=$(cat); else subjects=$(git log --no-merges --format=%s "$1"); fi
bad=$(printf '%s\n' "$subjects" | grep -vE "$re" | grep -v '^$' || true)
if [ -n "$bad" ]; then
  echo "::error::These commit messages don't follow Conventional Commits, type(scope): summary (see AGENTS.md):"
  printf '%s\n' "$bad"
  exit 1
fi
echo "Commit messages OK"
