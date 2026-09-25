# Docker Compose

The repository's `docker-compose.yml` builds from source. To use the published image instead, replace `build: .` with `image: ghcr.io/johnduprey/kinwall`.

```yaml
services:
  kinwall:
    build: .                      # or: image: ghcr.io/johnduprey/kinwall
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      PUBLIC_URL: http://localhost:8080
      TZ: America/New_York
      # ADMIN_API_KEY: kw_change-me          # else a setup code is logged on first boot
      # GOOGLE_CLIENT_ID: / GOOGLE_CLIENT_SECRET:
      # MS_CLIENT_ID: / MS_CLIENT_SECRET:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

* `./data` holds `kinwall.sqlite` and `encryption.key`. See [Backups](../your-data/backups.md).
* Set `PUBLIC_URL` to the address people actually use. It matters for OAuth redirects and passkeys.
* The server runs as the unprivileged `node` user (UID 1000). The container starts as root only to make `/data` writable by that user, then drops privileges; set `user: "1000:1000"` in Compose to skip the root step entirely (then `./data` must already be writable by UID 1000).
* `/api/health` returns `{ok}` without authentication and is used by the healthcheck. It deliberately doesn't report a version.
* The image also has a built-in `HEALTHCHECK`.

Add any other variable from [Configuration](configuration.md) under `environment:`.
