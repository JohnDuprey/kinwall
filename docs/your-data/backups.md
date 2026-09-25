# Backups

## Docker / Node

All state is in the data directory (`/data` in the container, `./data` by default for Node):

| File | Why it matters |
|---|---|
| `kinwall.sqlite` | Everything: settings, members, events, chores, lists, keys, calendar configs. |
| `encryption.key` | Decrypts calendar credentials, webhook secrets, push keys and provider secrets. Only present if you didn't set `ENCRYPTION_KEY`. |

**Back up both, together.** A database without its key still works, but every stored credential is unreadable, so you'd have to reconnect every calendar account and recreate webhooks.

Simple approach: stop the container (or make sure nothing is writing), copy `./data`, then start it again.

```bash
docker stop kinwall && tar czf kinwall-$(date +%F).tgz data && docker start kinwall
```

If you pass `ENCRYPTION_KEY` or `ENCRYPTION_KEY_FILE`, keep that value in your password manager instead.

## Home Assistant add-on

The add-on's `/data` is included in normal Home Assistant backups.

## Cloudflare Workers (D1)

* **D1 Time Travel** can restore the database to any point in its retention window: `npx wrangler d1 time-travel restore kinwall --timestamp=…`.
* **Export a SQL dump**: `npx wrangler d1 export kinwall --remote --output=kinwall.sql`.
* Keep `ENCRYPTION_KEY` somewhere safe. Cloudflare won't show a secret's value again once it's set.

## Application-level export

On any target, **Settings → Access → Your data → Download export** gives you a portable JSON copy that doesn't depend on the encryption key. See [Export & import](export-import.md). It's a good second copy, but it leaves out logins and synced events, so it's not a full disaster-recovery backup.
