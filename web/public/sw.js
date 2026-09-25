// Kinwall push service worker. Deliberately does NOT cache anything and has NO fetch handler -
// the app relies on network + Cache-Control headers for freshness; a caching SW previously caused
// stale-PWA problems (see Settings' "Clear cache and reload"). This worker only exists for push.

self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

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
      badge: '/badge-96.png', // Android status bar: single-colour (alpha only), or it renders as a white square
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
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
