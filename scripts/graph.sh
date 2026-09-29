#!/usr/bin/env bash
# Build or refresh graphify-out/, the local (gitignored) code graph agents query before reading files
# (AGENTS.md). Code-structure extraction only: no LLM, nothing leaves the machine. The first run
# builds it (~15s); later runs re-extract and only rewrite outputs when the code graph changed.
set -euo pipefail
cd "$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
command -v graphify >/dev/null || { echo "graphify isn't installed; skip it and search as usual."; exit 0; }
GRAPHIFY_NO_TIPS=1 graphify update .
