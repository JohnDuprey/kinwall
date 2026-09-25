# Webhooks

Kinwall can POST to your URL whenever something changes. Every change also bumps `GET /api/rev`.

## Create one

* **UI**: **Settings → Access → Webhooks → New webhook**, then pick a URL and events.
* **API**: `POST /api/webhooks {url, events, secret?, enabled?}`. An empty `events` array means **all events**.

If you don't pass a `secret`, Kinwall generates a random one. Either way, the create response includes the plain `secret` **once**; the UI shows it in a copyable field with the note "Shown once. Use it to verify the X-Kinwall-Signature header." Copy it then: secrets are encrypted at rest and never returned by `GET /api/webhooks` or anything else.

## Rotate the secret

Lost the secret, or want a new one? **Rotate secret** next to the webhook (or `POST /api/webhooks/{id}/rotate`) generates a new one and shows it once. The old secret stops working immediately, so update your receiver. Each rotation is logged on the server (`webhook <id> secret rotated`).

URLs must be public `http(s)` addresses. Private and LAN addresses are refused unless the server runs with `ALLOW_PRIVATE_WEBHOOK_URLS=1` (the Home Assistant add-on sets it, since Home Assistant is the receiver). `ALLOW_PRIVATE_FEED_URLS` does not affect webhooks.

## Events

| Type | Fired when |
|---|---|
| `member.changed` | A member is added, edited or removed. |
| `calendar.changed` | A calendar is added, edited or removed. |
| `calendar.synced` | A calendar finished syncing (includes `error` on failure). |
| `events.changed` | Events were created, edited, deleted or re-synced. |
| `chore.changed` | A chore is added, edited or deleted. |
| `chore.completed` | A chore is marked done for a date. |
| `chore.uncompleted` | A completion is undone. |
| `list.changed` | A list is created, edited, archived, deleted, cleared, reset or reordered. |
| `list.item.changed` | A list item is added, edited, ticked or deleted. |
| `category.changed` | A category is added, edited, reordered or deleted. |
| `settings.changed` | Household settings changed. |
| `sticker.changed` | A sticker pack is bought, or the scrapbook is edited. |
| `display.paired` | A wall display was paired. |

## Payload and signature

```http
POST /your/endpoint
Content-Type: application/json
X-Kinwall-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the secret>

{"type":"chore.completed","data":{...},"at":"2026-09-24T18:02:11.000Z"}
```

To verify, compute the HMAC-SHA256 of the **raw request body** with your secret and compare it to the header in constant time:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = 'sha256=' + createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-kinwall-signature']));
```

## Delivery

* Webhooks are sent in the background after the change is saved, with a **5-second timeout**.
* There are **no retries**. If you need every change, poll `GET /api/rev` as a backstop.
* A disabled webhook (`enabled: false`) is skipped.
