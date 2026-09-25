# Private / LAN feeds

By default, Kinwall refuses to fetch calendar URLs that point at private or internal addresses: `localhost`, `*.local`, `*.internal`, `10.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x` (CGNAT), link-local and IPv6 private ranges. This guards against server-side request forgery, where someone with an admin key could make the server probe your network.

## Self-hosted CalDAV/ICS on your LAN

To use a Radicale or Baïkal server at `192.168.x.x`, set:

```bash
ALLOW_PRIVATE_FEED_URLS=1
```

Then ICS and CalDAV URLs may point at private addresses. Error messages mention this: "Calendar URL must be a public http(s) address (self-hosted: set ALLOW_PRIVATE_FEED_URLS=1 to reach a LAN server)".

## Caveats

* **Webhooks stay public-only**, even with this set.
* Anyone with an admin key can then make the server fetch internal URLs. Only enable it on a trusted network.
* The check looks at the literal host. On Workers there's no DNS lookup, so a public name that resolves to a private address isn't caught. It wouldn't be reachable from Cloudflare anyway.
* Redirects are checked hop by hop, so a public feed can't redirect into your LAN.
