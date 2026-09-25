# Deleting everything

Kinwall has no in-app "delete my family" button. Your data lives wherever you deployed it, so you delete it there.

## Before you delete

* Optionally **Download export** (Settings → Access → Your data).
* Remove connected accounts in **Settings → Calendars** if you want Kinwall's access revoked at the provider. Removing a Google account revokes its token (best effort). For Microsoft and CalDAV, also revoke the app or app-specific password in your account settings.
* Delete [connected apps](../settings/access.md#connected-apps) and API keys if the instance might keep running for a while.

Removing a calendar or account from Kinwall never deletes anything at Google, Outlook or iCloud.

## Docker / Node

```bash
docker rm -f kinwall
rm -rf ./data        # kinwall.sqlite + encryption.key
```

Delete any backups of `data/` too.

## Home Assistant add-on

Uninstall the add-on. Its `/data` is removed with it. Older Home Assistant backups still contain it.

## Cloudflare Workers

```bash
npx wrangler delete kinwall
npx wrangler d1 delete kinwall
```

Or delete the Worker and the D1 database in the dashboard. D1 Time Travel history goes with the database.

## Hosted by someone else

If your host set it up, **Settings → Access → Your data → Manage or delete this family** links to your host's page for this. Anything the host does on your instance shows up under [Hosting activity](../settings/access.md#hosting-activity).
