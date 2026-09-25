# Quick start (Docker)

The image is `ghcr.io/johnduprey/kinwall`, built for `linux/amd64` and `linux/arm64`, so it runs on a Raspberry Pi, a NAS or any VPS.

```bash
docker run -d --name kinwall -p 8080:8080 -v ./data:/data \
  -e PUBLIC_URL=http://<your-server>:8080 ghcr.io/johnduprey/kinwall
docker logs kinwall   # prints the 6-digit setup code
```

Open `http://<your-server>:8080` and enter the setup code from the log. The [setup wizard](setup-wizard.md) handles the rest.

## What's in `/data`

| File | What it is |
|---|---|
| `kinwall.sqlite` | The whole database. |
| `encryption.key` | Generated on first boot (mode 0600) if you didn't set `ENCRYPTION_KEY`. It encrypts calendar logins, webhook secrets and push keys. |

**Back up both files.** Without the key, stored calendar credentials can't be recovered, and every account has to be reconnected. See [Backups](../your-data/backups.md).

## The setup code

While the instance is unclaimed, the server generates a new 6-digit setup code on every start and prints it to the log. Setting `ADMIN_API_KEY` gives you a permanent admin key that also works as the setup code. Claim attempts are limited to 10 per hour.

## HTTPS

Google sign-in only accepts HTTPS or `localhost` redirect URIs, and passkeys also need a secure origin. On a LAN you can:

* put Kinwall behind a reverse proxy with a real certificate, or
* use Cloudflare Tunnel or Tailscale instead of port forwarding, or
* finish Google sign-in from `http://localhost:8080` on the server itself.

## Next

* [Docker Compose](../self-hosting/docker-compose.md) for a compose file with a healthcheck.
* [Configuration](../self-hosting/configuration.md) for every environment variable.
* [Updating](../self-hosting/updating.md).
