import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), privacyServiceWorker()],
})

function privacyServiceWorker(): Plugin {
  let sourceIndexHtml = ''
  return {
    name: 'privacy-canvas-service-worker',
    configResolved({ root }) {
      sourceIndexHtml = readFileSync(join(root, 'index.html'), 'utf8')
    },
    configureServer(server) {
      server.middlewares.use('/sw.js', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(createServiceWorkerSource('development', ['/']))
      })
    },
    generateBundle(_options, bundle) {
      const artifacts = Object.values(bundle).filter(
        ({ fileName }) => !fileName.endsWith('.map'),
      )
      const precacheUrls = [
        '/',
        ...artifacts.map(({ fileName }) => `/${fileName}`),
      ]
      const digest = createHash('sha256').update(sourceIndexHtml)
      for (const artifact of artifacts.sort((left, right) =>
        left.fileName.localeCompare(right.fileName),
      )) {
        digest.update(artifact.fileName)
        digest.update(
          artifact.type === 'chunk'
            ? artifact.code
            : typeof artifact.source === 'string'
              ? artifact.source
              : artifact.source,
        )
      }
      digest.update(createServiceWorkerSource('VERSION', precacheUrls))
      const version = digest.digest('hex').slice(0, 16)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: createServiceWorkerSource(version, precacheUrls),
      })
    },
  }
}

function createServiceWorkerSource(
  version: string,
  precacheUrls: readonly string[],
): string {
  const urls = [...new Set(precacheUrls)].sort()
  return `const CACHE_PREFIX = 'privacy-canvas-assets-'
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)}
const PRECACHE_URLS = Object.freeze(${JSON.stringify(urls)})
const PRECACHE_PATHS = new Set(PRECACHE_URLS)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim()
      .then(() => caches.keys())
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'activate-network-lock-update') {
    event.waitUntil(self.skipWaiting())
    return
  }
  if (
    event.data?.type !== 'activate-network-lock' ||
    event.source === null ||
    typeof event.source.id !== 'string'
  ) return
  event.ports[0]?.postMessage({ type: 'network-lock-active', version: ${JSON.stringify(version)} })
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  const isSameOrigin = url.origin === self.location.origin
  const cachePath = url.pathname === '/' ? '/' : url.pathname
  const isPrecached =
    request.method === 'GET' && isSameOrigin && PRECACHE_PATHS.has(cachePath)

  if (isPrecached) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(cachePath)
        return cached ?? Response.error()
      }),
    )
    return
  }
  event.respondWith(Response.error())
})
`
}
