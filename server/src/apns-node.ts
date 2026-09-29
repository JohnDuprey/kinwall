// APNs over HTTP/2 on Node (apns.ts explains why fetch won't do). node.ts hands it to apns.ts as
// APNS_SEND; the Workers build never imports it.
import { connect } from 'node:http2';
import type { ApnsSend } from './apns.ts';

// ponytail: a connection per push. Pushes are a few per event per device, so pooling isn't worth it yet.
export const http2Send: ApnsSend = (r) =>
  new Promise((resolve, reject) => {
    const session = connect(`https://${r.host}`);
    session.on('error', reject);
    const req = session.request({ ':method': 'POST', ':path': r.path, ...r.headers });
    let status = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('response', (h) => { status = Number(h[':status']); });
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      session.close();
      let reason: string | undefined;
      try { reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined; } catch { /* not JSON */ }
      resolve({ status, reason });
    });
    req.on('error', (e) => { session.close(); reject(e); });
    req.setTimeout(15000, () => req.close());
    req.end(r.body);
  });
