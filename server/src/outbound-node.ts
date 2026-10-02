// Node only. The fetch node.ts hands outbound.ts as OUTBOUND_FETCH: it checks the address it
// actually connects to, so a public name that resolves to a private address (10.0.0.1.nip.io, an
// A record pointing at 192.168.1.1, DNS rebinding) is refused before a socket opens.
//
// Built on node:http(s) with a custom `lookup`: net.connect connects to exactly the address our
// lookup returns, so there's no second resolution to rebind. Node's built-in fetch can't take a
// lookup without an undici Agent, and undici isn't a runtime dependency here. TLS is unchanged:
// the request still goes to the hostname, so SNI and certificate checks use the name.
import dns, { type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { isPrivateAddress, type Fetch } from './outbound.ts';

type LookupAll = (host: string, opts: dns.LookupAllOptions, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void) => void;

// dns.lookup that refuses the name if ANY address it resolves to is private (a name with one
// public and one private record could otherwise connect to either). `lookup` and `blocked` are
// there for tests.
export function guardedLookup(lookup: LookupAll = dns.lookup, blocked: (ip: string) => boolean = isPrivateAddress): LookupFunction {
  return (host, opts, cb) => lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (!err && !addrs.length) err = Object.assign(new Error(`${host} did not resolve`), { code: 'ENOTFOUND' });
    const bad = err ? undefined : addrs.find((a) => blocked(a.address));
    if (bad) err = Object.assign(new Error(`${host} resolves to a private address (${bad.address})`), { code: 'EPRIVATEADDR' });
    if (err) cb(err, '', 0);
    else if (opts.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

// A fetch() over node:http(s) whose every connection resolves through `lookup`. Callers here
// always handle redirects themselves (redirect: 'manual'); anything else is refused rather than
// followed unchecked.
// ponytail: no Accept-Encoding sent, so servers answer uncompressed; add zlib if a feed insists.
export function nodeFetch(lookup: LookupFunction): Fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`unsupported protocol ${url.protocol}`);
    if (req.redirect !== 'manual') throw new TypeError('outbound fetch never follows a redirect itself: pass redirect: "manual"');
    // net.connect skips lookup for an IP literal, so put the literal through it here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) await new Promise((ok, fail) => lookup(host, {}, (err) => (err ? fail(err) : ok(null))));
    const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
    const headers: Record<string, string> = { accept: '*/*', 'user-agent': 'node', ...Object.fromEntries(req.headers) };
    if (body) headers['content-length'] = String(body.byteLength);
    return new Promise<Response>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const out = send(url, { method: req.method, headers, lookup, agent: false, signal: req.signal, timeout: 60_000 }, (res) => {
        try {
          const status = res.statusCode ?? 0;
          const h = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2) h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          const empty = req.method === 'HEAD' || status === 204 || status === 205 || status === 304;
          if (empty) res.resume();
          resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, statusText: res.statusMessage, headers: h }));
        } catch (err) {
          res.destroy();
          reject(err);
        }
      });
      out.on('timeout', () => out.destroy(new Error(`${url.host} timed out`)));
      out.on('error', reject);
      out.end(body);
    });
  };
}
