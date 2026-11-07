import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function worker() {
  const handlers = new Map<string, (event: any) => void>()
  const requests: string[] = []
  const cached = new Response('cached screen', { headers: { Vary: 'Origin' } })
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { registration: { scope: 'https://home.example/kinwall/' }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler) },
    caches: { open: async () => ({ match: async (_: unknown, options?: { ignoreVary?: boolean }) => options?.ignoreVary ? cached : undefined }) },
    fetch: async (req: { url: string }) => { requests.push(req.url); throw new Error('offline') },
    setTimeout, clearTimeout,
  })
  return { handlers, requests }
}

test('a prefetched screen is available offline when the host varies responses by Origin', async () => {
  const { handlers, requests } = worker()
  let response!: Promise<Response>
  handlers.get('fetch')!({ request: { method: 'GET', url: 'https://home.example/kinwall/assets/Settings.js' }, respondWith: (p: Promise<Response>) => { response = p } })
  assert.equal(await (await response).text(), 'cached screen')
  assert.deepEqual(requests, [], 'the cached module needs no network request')
})

test('the cached app shell remains available offline with a Vary header', async () => {
  const { handlers } = worker()
  let response!: Promise<Response>
  handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://home.example/kinwall/' }, respondWith: (p: Promise<Response>) => { response = p } })
  assert.equal(await (await response).text(), 'cached screen')
})
