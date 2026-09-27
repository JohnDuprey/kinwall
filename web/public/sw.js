// Kinwall service worker: push notifications, and the app shell for opening offline.
//
// Offline shell only: the page itself is network-first (a caching SW that served the page first
// once left installed PWAs stuck on old builds; see Settings' "Clear cache and reload"), falling back
// to the last good copy only when the network fails or takes over NAV_TIMEOUT. Hashed /assets/ files
// never change, so they come from cache when present. API calls are never touched here: the page
// keeps its own offline copies per server in IndexedDB (src/outbox.ts), which also works where
// there is no service worker (the Kinwall app's web view on iOS, old browsers).
// Plain ES2017: old iPads (iOS 12) must be able to parse this file.

var SHELL = 'kinwall-shell-v1'
var NAV_TIMEOUT = 5000
var scopeUrl = self.registration.scope // the app's index, e.g. https://home.example/ or an ingress sub-path

self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('kinwall-shell-') && k !== SHELL).map(k => caches.delete(k)))),
  ]))
})

// The page posts the files it loaded (it ran before this worker controlled it), so the very first
// visit already leaves an app that opens offline. That list is the whole running build (index +
// App chunk), so older builds' files are dropped here and the cache doesn't grow with each deploy.
self.addEventListener('message', (event) => {
  const urls = event.data && event.data.cacheUrls
  if (!Array.isArray(urls)) return
  const current = urls.filter(isAsset)
  if (!current.length) return
  event.waitUntil(caches.open(SHELL).then(cache => Promise.all([
    ...current.map(u => cache.match(u).then(hit => hit || cache.add(u).catch(() => {}))),
    cache.match(scopeUrl).then(hit => hit || cache.add(scopeUrl).catch(() => {})),
    cache.keys().then(reqs => Promise.all(reqs.filter(r => isAsset(r.url) && !current.includes(r.url)).map(r => cache.delete(r)))),
  ])))
})

function isAsset(url) {
  return typeof url === 'string' && url.startsWith(scopeUrl + 'assets/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = req.url.split('#')[0]
  // The app is one page (hash routes). Other navigations (API downloads, OAuth pages) pass through.
  if (req.mode === 'navigate' && url.split('?')[0] === scopeUrl) {
    event.respondWith(shell(req))
  } else if (isAsset(url)) {
    event.respondWith(caches.open(SHELL).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {})
      return res
    }))))
  }
})

function shell(req) {
  return caches.open(SHELL).then(cache => {
    const network = fetch(req).then(res => {
      if (res.ok && !res.redirected && (res.headers.get('content-type') || '').includes('text/html')) cache.put(scopeUrl, res.clone()).catch(() => {})
      return res
    })
    const fallback = () => cache.match(scopeUrl).then(hit => hit || network)
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(fallback()), NAV_TIMEOUT)
      network.then(res => { clearTimeout(timer); resolve(res) }, () => { clearTimeout(timer); resolve(fallback()) })
    })
  })
}

self.addEventListener('push', (event) => {
  let data = { title: 'Kinwall', body: '' }
  try {
    if (event.data) data = event.data.json()
  } catch {
    // ignore malformed payload
  }
  const title = data.title || 'Kinwall'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png', // Android status bar: single-color (alpha only), or it renders as a white square
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientsList) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) client.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
