# Updating

Database migrations run automatically on every target: at boot on Docker/Node, and on the first request or cron tick on Workers. You never run them by hand. After an update, open wall displays show **Kinwall updated — tap to reload**.

## Docker

Images are published to `ghcr.io/johnduprey/kinwall` for every push to `main` (tag `main`) and every release (`1.2.3`, `1.2`).

```bash
docker pull ghcr.io/johnduprey/kinwall
docker rm -f kinwall
docker run -d --name kinwall -p 8080:8080 -v ./data:/data -e PUBLIC_URL=... ghcr.io/johnduprey/kinwall
```

With Compose: `docker compose pull && docker compose up -d` (or `docker compose up -d --build` if you build from source). Pin a version tag if you don't want to follow `main`.

## Cloudflare Workers

* **Setup script**: `git pull`, then `node scripts/setup-cloudflare.mjs` again. It keeps your database and secrets.
* **Git-connected dashboard**: every push to the production branch deploys. Sync your fork to update.
* **Tag workflow**: push a `v*` tag (or run the workflow manually).

## Home Assistant add-on

Update from the add-on page like any other add-on.

## If a device shows an old version

Home Screen apps can hang on to an old build. Use **Settings → General → Troubleshooting → Clear cache and reload**. See [Troubleshooting](troubleshooting.md#stale-app-after-an-update).
