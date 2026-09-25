#!/bin/sh
# Started as root (the Home Assistant add-on mounts /data root-owned): make /data writable by the
# unprivileged `node` user, then drop to it. Started as a non-root user (docker-compose `user:`),
# just run.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
