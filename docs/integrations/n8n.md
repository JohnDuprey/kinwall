# n8n

There's no dedicated Kinwall node for n8n yet. Everything here uses n8n's **built-in** HTTP Request and Webhook nodes. A native node may come later.

Since Kinwall is just a [REST API](rest-api.md) with [webhooks](webhooks.md), n8n can read and write anything the touch UI can.

## Prerequisites

* A reachable Kinwall URL, e.g. `https://kinwall.example`.
* An API key from **Settings → Access → API keys**:
  * **display** scope is enough for reading events/chores/lists and adding list items or completing chores.
  * **admin** scope is required for `POST /api/notify` (pushing a message; it answers 403 while **Family messages** is off in [Settings → General → Features](../settings/general.md#features)) and for managing webhooks (`POST/PATCH/DELETE /api/webhooks*`).

## Credentials in n8n

Create a **Header Auth** credential (n8n's generic credential type, not a Kinwall-specific one):

* **Name**: `Authorization`
* **Value**: `Bearer <your key>`

Attach it to each HTTP Request node's **Authentication → Generic Credential Type → Header Auth**.

## Workflow 1: Chore completed → message

1. **Webhook** node — Method `POST`, any path (e.g. `kinwall-chore-completed`), Respond `Immediately`.
2. **Code** node — verify `X-Kinwall-Signature` against the webhook secret before trusting the payload.
3. A "send a message" step of your choice (email, chat, SMS — whatever notifier you already use in n8n).

The payload's `data` carries the chore's `title`, `memberId` and the `points` awarded, so the message can say who did what ("Maya finished Feed the dog, +5") without another call. Look up the member's name with `GET /api/members` if you need it. See [Webhooks](webhooks.md#events).

Signature check (Code node, JavaScript, "Run Once for Each Item"):

```js
const crypto = require('crypto');
const secret = 'YOUR_WEBHOOK_SECRET'; // or read from an n8n credential
const raw = JSON.stringify($input.item.json.body ?? $input.item.json);
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const got = $input.item.json.headers['x-kinwall-signature'];
if (expected !== got) throw new Error('bad signature');
return $input.item;
```

This round-trips because Kinwall signs the compact JSON it sends and n8n parses it losslessly. If you turn on the Webhook node's **Raw Body** option, hash the raw body it gives you instead of re-serializing `body`.

Note: n8n's Webhook node re-serializes the parsed JSON, so the bytes you hash may not exactly match what Kinwall signed if you need byte-for-byte verification. For strict verification, set the Webhook node's **Response Data** to raw and read `$input.item.binary` instead — this snippet is the common-case version.

```json
{
  "nodes": [
    {
      "parameters": { "httpMethod": "POST", "path": "kinwall-chore-completed", "responseMode": "onReceived" },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [260, 300]
    },
    {
      "parameters": {
        "jsCode": "const crypto = require('crypto');\nconst secret = 'YOUR_WEBHOOK_SECRET';\nconst raw = JSON.stringify($input.item.json.body);\nconst expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');\nif (expected !== $input.item.json.headers['x-kinwall-signature']) throw new Error('bad signature');\nreturn $input.item;"
      },
      "name": "Verify signature",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [480, 300]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Verify signature", "type": "main", "index": 0 }]] }
  }
}
```

## Workflow 2: Morning digest

1. **Schedule Trigger** — daily at `07:00`.
2. **HTTP Request** — `GET {{$env.KINWALL_URL}}/api/events?from={{ $today.startOf('day').toISO() }}&to={{ $today.plus({days:1}).startOf('day').toISO() }}`.
3. **HTTP Request** — `GET {{$env.KINWALL_URL}}/api/chores/day?date={{ $today.toFormat('yyyy-LL-dd') }}`.
4. **Code** node — build a plain-text summary from both responses.
5. **HTTP Request** — `POST {{$env.KINWALL_URL}}/api/notify` with an admin key, body:

```json
{ "title": "Good morning, Our Family", "body": "Today: Sam has soccer at 4pm. Chores due: Alex — feed the dog, Maya — set the table." }
```

`NotifyInput` fields: `title` (required), `body` (required), `memberIds` (optional array — omit to notify everyone), `url` (optional, opened when the notification is tapped).

```json
{
  "nodes": [
    { "parameters": { "rule": { "interval": [{ "field": "cronExpression", "expression": "0 7 * * *" }] } }, "name": "Every morning", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1, "position": [260, 300] },
    {
      "parameters": {
        "method": "GET",
        "url": "={{$env.KINWALL_URL}}/api/events",
        "sendQuery": true,
        "queryParameters": { "parameters": [
          { "name": "from", "value": "={{$today.startOf('day').toISO()}}" },
          { "name": "to", "value": "={{$today.plus({days:1}).startOf('day').toISO()}}" }
        ] },
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth"
      },
      "name": "Get today's events", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [480, 200],
      "credentials": { "httpHeaderAuth": { "id": "1", "name": "Kinwall API key" } }
    },
    {
      "parameters": {
        "method": "GET",
        "url": "={{$env.KINWALL_URL}}/api/chores/day",
        "sendQuery": true,
        "queryParameters": { "parameters": [{ "name": "date", "value": "={{$today.toFormat('yyyy-LL-dd')}}" }] },
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth"
      },
      "name": "Get today's chores", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [480, 400],
      "credentials": { "httpHeaderAuth": { "id": "1", "name": "Kinwall API key" } }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.KINWALL_URL}}/api/notify",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ { \"title\": \"Good morning, \" + $json.familyName, \"body\": $json.summary } }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth"
      },
      "name": "Push digest", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [900, 300],
      "credentials": { "httpHeaderAuth": { "id": "1", "name": "Kinwall API key" } }
    }
  ]
}
```

(The Code node that builds `summary`/`familyName` from the two HTTP responses is left out — plug in your own [chores](../using/chores.md)/events formatting.)

## Workflow 3: Add to the shopping list from anywhere

Trigger this from a phone shortcut, a form, or any app that can hit a webhook URL.

1. **Webhook** node — Method `POST`, path e.g. `kinwall-add-item`, expecting `{ "title": "Milk" }`.
2. **HTTP Request** — `POST {{$env.KINWALL_URL}}/api/lists/{{$env.SHOPPING_LIST_ID}}/items` with body `{ "title": "={{$json.body.title}}" }`.

Find the shopping list's id once with `GET /api/lists` (display key is enough) and hardcode it, or look it up by name in a small Code/IF step if you have several lists.

```json
{
  "nodes": [
    { "parameters": { "httpMethod": "POST", "path": "kinwall-add-item", "responseMode": "onReceived" }, "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [260, 300] },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.KINWALL_URL}}/api/lists/{{$env.SHOPPING_LIST_ID}}/items",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ { \"title\": $json.body.title } }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth"
      },
      "name": "Add item", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [480, 300],
      "credentials": { "httpHeaderAuth": { "id": "1", "name": "Kinwall API key" } }
    }
  ],
  "connections": { "Webhook": { "main": [[{ "node": "Add item", "type": "main", "index": 0 }]] } }
}
```

## Registering the webhook

Workflow 1 needs Kinwall to know n8n's webhook URL. Either use **Settings → Access → Webhooks → New webhook** in the UI, or call the API directly (admin key required):

```bash
curl -X POST https://kinwall.example/api/webhooks \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://your-n8n.example/webhook/kinwall-chore-completed","events":["chore.completed"]}'
```

`WebhookInput` fields are `url` (required, public http/https), `events` (required array of event type strings — an empty array means *all* events), `secret` (optional — Kinwall generates one if omitted) and `enabled` (optional). The response includes the plain `secret` **once**; save it into the Code node from Workflow 1 (or an n8n credential) right away, since Kinwall never returns it again.

n8n gives every Webhook node two different URLs:

* **Test URL** (`/webhook-test/...`) — only live while you have the workflow open and click "Listen for test event". Useful for a one-off `curl` while building the workflow, but Kinwall won't reliably reach it.
* **Production URL** (`/webhook/...`) — live once the workflow is **activated**. Register *this* URL with Kinwall, not the test one.

## Tips

* **Polling instead of webhooks**: `GET /api/rev` returns `{rev}`, a counter that increments on every write. A Schedule Trigger that polls it cheaply and only fetches the rest when it changes is a fine alternative (or backstop — Kinwall webhooks have no retries; see [Webhooks](webhooks.md#delivery)).
* **Rate limits**: general API calls aren't rate-limited; only sign-in/recovery/setup-code guessing is (see [REST API](rest-api.md#rate-limits)). If self-hosting on Cloudflare Workers, the free-tier quota (100k requests/day) is the practical ceiling.
* **OpenAPI spec**: import `https://kinwall.example/openapi.json` straight into n8n's HTTP Request node ("Import cURL"/schema tools) or browse it interactively at `https://kinwall.example/docs`.
