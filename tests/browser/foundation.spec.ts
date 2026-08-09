import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createServer } from 'vite'

test('keeps development usable without presenting a production Network Lock', async ({
  browser,
}) => {
  const developmentServer = await createServer({
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  })
  await developmentServer.listen()
  const address = developmentServer.httpServer?.address() as AddressInfo
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(`http://127.0.0.1:${address.port}/`)
    await expect(
      page.getByText('Development mode — Network Lock'),
    ).toBeVisible()
    await expect(page.getByLabel('Choose a JPEG')).toBeEnabled()
    expect(
      await page.evaluate(async () => (await fetch('/src/main.tsx')).ok),
    ).toBe(true)

    await page.reload()
    await expect(
      page.getByText('Development mode — Network Lock'),
    ).toBeVisible()
    await expect(page.getByLabel('Choose a JPEG')).toBeEnabled()
  } finally {
    await context.close()
    await developmentServer.close()
  }
})

test('activates the one-way Network Lock before Source Media selection', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByText('Network Lock active')).toBeVisible()
  await expect(page.getByLabel('Choose a JPEG')).toBeEnabled()
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('/runtime-network-probe', { cache: 'no-store' })
        return 'resolved'
      } catch {
        return 'rejected'
      }
    }),
  ).toBe('rejected')
})

test('blocks browser-initiated runtime requests after Network Lock', async ({
  page,
}) => {
  const runtimeProbeRequests: string[] = []
  await page.route('**/runtime-image-probe', async (route) => {
    runtimeProbeRequests.push(route.request().url())
    await route.fulfill({ body: 'network reached', status: 200 })
  })
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const image = new Image()
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
        image.src = '/runtime-image-probe'
        document.body.append(image)
      }),
  )

  expect(runtimeProbeRequests).toEqual([])
})

test('remains locked after the browser restarts the service worker', async ({
  context,
  page,
}) => {
  const runtimeProbeRequests: string[] = []
  await page.route('**/runtime-restart-probe', async (route) => {
    runtimeProbeRequests.push(route.request().url())
    await route.fulfill({ body: 'network reached', status: 200 })
  })
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()

  const browserSession = await context.newCDPSession(page)
  await browserSession.send('ServiceWorker.enable')
  await browserSession.send('ServiceWorker.stopAllWorkers')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const image = new Image()
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
        image.src = '/runtime-restart-probe'
        document.body.append(image)
      }),
  )

  expect(runtimeProbeRequests).toEqual([])
})

test('blocks runtime requests initiated by a dedicated worker', async ({
  page,
}) => {
  const runtimeProbeRequests: string[] = []
  await page.route('**/runtime-worker-probe', async (route) => {
    runtimeProbeRequests.push(route.request().url())
    await route.fulfill({ body: 'network reached', status: 200 })
  })
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()

  expect(
    await page.evaluate(async () => {
      const source = `fetch('/runtime-worker-probe')
        .then(() => postMessage('resolved'))
        .catch(() => postMessage('rejected'))`
      const url = URL.createObjectURL(
        new Blob([source], { type: 'text/javascript' }),
      )
      const worker = new Worker(url)
      try {
        return await new Promise<string>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (event: MessageEvent<string>) => resolve(event.data),
            { once: true },
          )
          worker.addEventListener(
            'error',
            () => reject(new Error('worker failed')),
            {
              once: true,
            },
          )
        })
      } finally {
        worker.terminate()
        URL.revokeObjectURL(url)
      }
    }),
  ).toBe('rejected')
  expect(runtimeProbeRequests).toEqual([])
})

test('blocks XMLHttpRequest after Network Lock', async ({ page }) => {
  const runtimeProbeRequests: string[] = []
  await page.route('**/runtime-xhr-probe', async (route) => {
    runtimeProbeRequests.push(route.request().url())
    await route.fulfill({ body: 'network reached', status: 200 })
  })
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()

  expect(
    await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const request = new XMLHttpRequest()
          request.addEventListener('load', () => resolve('resolved'), {
            once: true,
          })
          request.addEventListener('error', () => resolve('rejected'), {
            once: true,
          })
          request.open('GET', '/runtime-xhr-probe')
          request.send()
        }),
    ),
  ).toBe('rejected')
  expect(runtimeProbeRequests).toEqual([])
})

test('blocks navigator.sendBeacon egress after Network Lock', async ({
  page,
}) => {
  const runtimeProbeRequests: string[] = []
  await page.route('**/runtime-beacon-probe', async (route) => {
    runtimeProbeRequests.push(route.request().url())
    await route.fulfill({ body: 'network reached', status: 200 })
  })
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()

  await page.evaluate(async () => {
    navigator.sendBeacon('/runtime-beacon-probe', 'private probe')
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  expect(runtimeProbeRequests).toEqual([])
})

test('rejects WebSocket creation after Network Lock', async ({ page }) => {
  const sockets: string[] = []
  page.on('websocket', (socket) => sockets.push(socket.url()))
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()

  expect(
    await page.evaluate(() => {
      try {
        new WebSocket('ws://127.0.0.1:4173/runtime-websocket-probe')
        return 'started'
      } catch {
        return 'rejected'
      }
    }),
  ).toBe('rejected')
  expect(sockets).toEqual([])
})

test('offers an installed application update and activates it atomically', async ({
  context,
  page,
}) => {
  const currentServiceWorker = await readFile(
    join(process.cwd(), 'dist/sw.js'),
    'utf8',
  )
  const currentVersion = currentServiceWorker.match(
    /CACHE_NAME = CACHE_PREFIX \+ "([a-f0-9]{16})"/,
  )?.[1]
  expect(currentVersion).toBeDefined()
  const oldVersion = '0000000000000000'
  let servedServiceWorker = currentServiceWorker.replaceAll(
    currentVersion!,
    oldVersion,
  )
  await context.route('**/sw.js', async (route) => {
    await route.fulfill({
      body: servedServiceWorker,
      contentType: 'text/javascript; charset=utf-8',
      headers: { 'Cache-Control': 'no-store' },
    })
  })

  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()
  expect(await page.evaluate(() => caches.keys())).toEqual([
    `privacy-canvas-assets-${oldVersion}`,
  ])

  servedServiceWorker = currentServiceWorker
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    await registration?.update()
  })

  await expect(page.getByText('Network Lock update available')).toBeVisible()
  await expect(page.getByLabel('Choose a JPEG')).toBeDisabled()
  expect((await page.evaluate(() => caches.keys())).sort()).toEqual(
    [
      `privacy-canvas-assets-${oldVersion}`,
      `privacy-canvas-assets-${currentVersion!}`,
    ].sort(),
  )
  const otherInstalledPage = await context.newPage()
  await otherInstalledPage.goto('/')
  await expect(
    otherInstalledPage.getByText('Network Lock update available'),
  ).toBeVisible()
  const otherPageReloaded = otherInstalledPage.waitForEvent('load')
  await page.getByRole('button', { name: 'Activate update and reload' }).click()

  await otherPageReloaded
  await expect(page.getByText('Network Lock active')).toBeVisible()
  await expect(page.getByLabel('Choose a JPEG')).toBeEnabled()
  expect(await page.evaluate(() => caches.keys())).toEqual([
    `privacy-canvas-assets-${currentVersion!}`,
  ])
})

test('describes local editing and verification-gated PNG download', async ({
  page,
}) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Privacy Canvas' }),
  ).toBeVisible()
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  await expect(
    page.getByText(
      'Rectangle editing is local; verified PNG download appears only after final-output checks pass',
    ),
  ).toBeVisible()
  await expect(page.getByText('User media stays on this device')).toBeVisible()
})
