# Deploy to Cloudflare Workers

Kinwall runs on the Workers free tier: Workers for the API, D1 for the database, Cron Triggers for sync and notifications, and static assets for the UI. HTTPS comes with it, so Google/Microsoft sign-in and passkeys work without extra steps.

There are three ways to deploy. Pick one.

## 1. The setup script (recommended)

From a clone of the repo, with Node 24:

```bash
node scripts/setup-cloudflare.mjs
```

It's safe to re-run, for example to add a custom domain later or after pulling updates. It:

1. Logs you in to Cloudflare (`wrangler login` opens a browser) and lets you pick the account.
2. Finds or creates a D1 database named `kinwall` in the location nearest you (guessed from your timezone) and writes its ID into `wrangler.toml`.
3. Optionally serves Kinwall on a custom domain in one of your zones instead of `workers.dev`.
4. Deploys, which builds the UI, then sets these secrets:
   * `ENCRYPTION_KEY`: paste one or let the script generate one.
   * `ADMIN_API_KEY`: a permanent admin key that also works as the setup code. It's printed once and not saved anywhere.
   * `PUBLIC_URL`
5. Calls `/api/health`, which makes the Worker apply its database migrations, then prints your URL and admin key.

Existing secrets are kept unless you choose to replace them. **Keep a copy of `ENCRYPTION_KEY`.** If you lose it, you have to reconnect every calendar account.

| Flag / variable | Effect |
|---|---|
| `--dry-run` | Prints what it would do and changes nothing. |
| `--yes` | Runs without prompts, for CI. |
| `KINWALL_DOMAIN` | Custom domain (with `--yes`). |
| `KINWALL_D1_LOCATION` | One of `enam`, `wnam`, `weur`, `eeur`, `apac`, `oc`. |
| `KINWALL_ENCRYPTION_KEY`, `KINWALL_ADMIN_API_KEY` | Use these values instead of generating new ones. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Use these instead of an interactive login. |

The script edits your local `wrangler.toml`. Those account-specific lines don't belong in a pull request.

## 2. Manual: git-connected dashboard

1. Fork the repo. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and pick your fork. Keep the root directory `/` and the deploy command `npx wrangler deploy`.
2. Under **Settings → Build → Build command**, enter `sh scripts/cloudflare-config.sh`. This copies your **Build variables** into the build's copy of `wrangler.toml`:
   * `D1_DATABASE_ID`: create a D1 database named `kinwall` under Storage & Databases, choosing the **Location** nearest you, and paste its ID. You can leave it out and the first deploy creates one, but it lands near Cloudflare's build servers rather than near you.
   * `CUSTOM_DOMAIN` (optional): for example `kinwall.example.com`. This turns off `workers.dev`. Set domains here rather than only in the dashboard, because each deploy re-applies `wrangler.toml` and removes a dashboard-only domain.
3. Under **Settings → Variables and Secrets**, add `ENCRYPTION_KEY` as a *Secret* (`openssl rand -base64 32`). Optionally add `ADMIN_API_KEY` too.
4. Open your URL. If you didn't set `ADMIN_API_KEY`, the setup code is printed in the Worker's logs on the first visit.

## 2b. Manual: wrangler by hand

```bash
npx wrangler d1 create kinwall --location enam   # add database_name/database_id under [[d1_databases]]
npx wrangler deploy                              # from the repo root: builds the UI and deploys
npx wrangler secret put ENCRYPTION_KEY           # openssl rand -base64 32
npx wrangler secret put ADMIN_API_KEY            # optional; also works as the setup code
```

Set the public URL in **Settings → Calendars → Calendar providers**, or as a `PUBLIC_URL` secret.

## 3. Deploy on release tags only

The dashboard's git integration builds on every push. To ship only releases, you have two options:

* Point the integration at a `release` branch (**Settings → Build → Branch control**) and turn off non-production builds.
* Leave the repo unconnected and use `.github/workflows/cloudflare.yml`. It deploys on `v*` tags (the same tags that publish the Docker image) and runs `scripts/cloudflare-config.sh` first. It needs:

| Kind | Name |
|---|---|
| Repository secret | `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit, Workers Routes:Edit) |
| Repository secret | `CLOUDFLARE_ACCOUNT_ID` |
| Repository variable | `D1_DATABASE_ID`, optional `CUSTOM_DOMAIN` |
| Repository variable | `CLOUDFLARE_DEPLOY=true` (the workflow skips itself without it) |

For free-tier limits, the cron schedule and placement, see [Cloudflare specifics](../self-hosting/cloudflare.md).
