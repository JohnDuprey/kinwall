#!/usr/bin/env bash
# Remove a feature worktree and its branch once every commit on it is on main (merged, rebased or
# squashed). Refuses otherwise. With no name, lists which worktrees are safe to remove.
#   scripts/finish-feature.sh recipe-timers      scripts/finish-feature.sh --all
set -euo pipefail
cd "$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
git fetch -q origin main
landed() { # every commit on the branch has an equivalent on main (git cherry prints no "+")
  [ -z "$(git cherry origin/main "$1" 2>/dev/null | grep '^+' || true)" ]; }
finish() {
  local branch=$1 dir; dir=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{w=substr($0, 10)} $0=="branch "b{print w}')
  if ! landed "$branch"; then echo "skip $branch: has commits not on main"; return; fi
  [ -n "$dir" ] && git worktree remove --force "$dir"
  git branch -D -q "$branch" && echo "removed $branch${dir:+ ($dir)}"
}
if [ "${1:-}" = "--all" ] || [ -z "${1:-}" ]; then
  for b in $(git worktree list --porcelain | awk '/^branch refs\/heads\//{sub("refs/heads/","",$2); print $2}' | grep -vx main); do
    if [ "${1:-}" = "--all" ]; then finish "$b"; elif landed "$b"; then echo "can remove: $b"; else echo "in progress: $b"; fi
  done
else finish "$1"; fi
