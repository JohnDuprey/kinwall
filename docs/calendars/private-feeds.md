# Private / LAN feeds

By default, Kinwall refuses to fetch calendar URLs that point at private or internal addresses: `localhost`, `*.local`, `*.internal`, `0.x`, `10.x`, `127.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x` (CGNAT), link-local, and the IPv6 equivalents (including IPv4 addresses written inside IPv6, such as `::ffff:192.168.1.1` or NAT64 `64:ff9b::…`). This guards against server-side request forgery, where someone with an admin key could make the server probe your network.

On a Node server (Docker, the Home Assistant add-on, `npm start`), Kinwall also checks the address a name resolves to, at the moment it connects. A public-looking name that points at a private address (`10.0.0.1.nip.io`, or a domain whose DNS answer changes between checks) is refused too.

## Self-hosted CalDAV/ICS on your LAN

To use a Radicale or Baïkal server at `192.168.x.x`, set:

```bash
ALLOW_PRIVATE_FEED_URLS=1
```

Then ICS and CalDAV URLs may point at private addresses, written as an IP or as a name that resolves to one (both checks above are skipped for feeds). Recipe links follow the same setting. Error messages mention this: "Calendar URL must be a public http(s) address (self-hosted: set ALLOW_PRIVATE_FEED_URLS=1 to reach a LAN server)".

## Caveats

* **Webhooks stay public-only**, even with this set.
* Anyone with an admin key can then make the server fetch internal URLs. Only enable it on a trusted network.
* On Cloudflare Workers only the URL as written is checked: Workers can't look up DNS. A public name that resolves to a private address isn't caught there, but it wouldn't be reachable from Cloudflare anyway.
* A name with several DNS records is refused if any of them is private.
* Redirects are checked hop by hop, so a public feed can't redirect into your LAN.
