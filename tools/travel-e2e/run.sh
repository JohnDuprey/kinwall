#!/usr/bin/env bash
# Disposable real-server/browser E2E; no host data directory or real family is mounted.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
side=${1:-both}
case "$side" in codex|claude|next|both) ;; *) echo 'Usage: tools/travel-e2e/run.sh [codex|claude|next|both]' >&2; exit 2;; esac
stamp=$(date +%Y%m%d-%H%M%S)-$$
network=kw-travel-e2e-$stamp
results=${RESULTS_DIR:-/tmp/kinwall-travel-e2e-$stamp}
mkdir -p "$results"
results=$(cd "$results" && pwd)
apps=()
cleanup() {
  if [ "${KEEP_CONTAINERS:-0}" = 1 ]; then echo "Kept demo-only containers: ${apps[*]}"; return; fi
  for app in "${apps[@]}"; do docker rm -f "$app-browser" "$app" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build -t kinwall:travel-e2e . >"$results/app-build.log" 2>&1
docker build -t kinwall:travel-e2e-browser tools/travel-e2e >"$results/browser-build.log" 2>&1
docker image inspect kinwall:travel-e2e --format '{{.Id}}' >"$results/app-image.txt"
docker image inspect kinwall:travel-e2e-browser --format '{{.Id}}' >"$results/browser-image.txt"
docker network create "$network" >/dev/null
if [ "$side" = both ]; then sides=(codex claude next); else sides=("$side"); fi
for agent in "${sides[@]}"; do
  app=$network-$agent
  apps+=("$app")
  docker run -d --name "$app" --network "$network" -p 127.0.0.1::8080 \
    --tmpfs /data:rw,uid=1000,gid=1000 -e ADMIN_API_KEY=kw_docker_e2e_only \
    -e TZ=America/New_York kinwall:travel-e2e >/dev/null
  ready=0
  for attempt in $(seq 1 60); do
    if docker exec "$app" node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" != 1 ]; then docker logs "$app" >&2; exit 1; fi
  docker exec -i -e KINWALL_URL=http://localhost:8080 -e KINWALL_KEY=kw_docker_e2e_only \
    "$app" node --input-type=module <scripts/seed-demo.mjs >"$results/$agent-seed.log" 2>&1
done
pids=()
for agent in "${sides[@]}"; do
  app=$network-$agent
  docker run --rm --name "$app-browser" --network "container:$app" --ipc=host \
    -e KINWALL_URL=http://localhost:8080 -e RESULTS_DIR="/results/$agent" \
    -v "$PWD/tools/travel-e2e:/tests:ro" -v "$results:/results" \
    kinwall:travel-e2e-browser "/tests/$agent.mjs" >"$results/$agent.log" 2>&1 &
  pids+=("$!")
done
failed=0
for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
for agent in "${sides[@]}"; do
  docker logs "$network-$agent" >"$results/$agent-server.log" 2>&1
  tail -24 "$results/$agent.log"
done
echo "Results, screenshots and traces: $results"
exit "$failed"
