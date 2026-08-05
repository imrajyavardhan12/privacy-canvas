import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixtureDirectory = join(process.cwd(), 'tests/fixtures/jpeg')
const responseHeaders = readFileSync(
  join(process.cwd(), 'public/_headers'),
  'utf8',
)
const contentSecurityPolicy = responseHeaders.match(
  /^\s*Content-Security-Policy:\s*(.+)$/m,
)?.[1]
if (contentSecurityPolicy === undefined) {
  throw new Error('public/_headers must define Content-Security-Policy')
}
const fixtureManifest = JSON.parse(
  readFileSync(join(fixtureDirectory, 'manifest.json'), 'utf8'),
) as {
  fixtures: Array<{
    file: string
    orientation?: number
    normalizedWidth?: number
    normalizedHeight?: number
    expectedCorners?: string[]
  }>
}

function trackNetworkRequests(
  page: import('@playwright/test').Page,
  sink: string[],
): void {
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) sink.push(request.url())
  })
}

test('starts worker-owned intake under the production content security policy', async ({
  page,
}) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': contentSecurityPolicy,
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  await page
    .getByLabel('Choose a JPEG')
    .setInputFiles(join(fixtureDirectory, 'control-valid.jpg'))
  await expect(page.getByRole('status')).toContainText('Source ready')
  expect(
    await page.evaluate(() => {
      let workerUrlRejected = false
      let htmlRejected = false
      try {
        new Worker('/not-an-approved-worker.js')
      } catch {
        workerUrlRejected = true
      }
      try {
        document.createElement('div').innerHTML = '<img src=x>'
      } catch {
        htmlRejected = true
      }
      return { workerUrlRejected, htmlRejected }
    }),
  ).toEqual({ workerUrlRejected: true, htmlRejected: true })
})

test('opens one local JPEG through worker-owned intake', async ({ page }) => {
  const runtimeRequests: string[] = []
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )

  trackNetworkRequests(page, runtimeRequests)
  await page
    .getByLabel('Choose a JPEG')
    .setInputFiles(join(fixtureDirectory, 'control-valid.jpg'))

  await expect(page.getByRole('status')).toContainText('Source ready')
  await expect(page.getByText('64 × 48 pixels')).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toBeVisible()
  expect(runtimeRequests).toEqual([])
})

test('renders hostile filenames and metadata as inert text', async ({
  page,
}) => {
  const runtimeRequests: string[] = []
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  trackNetworkRequests(page, runtimeRequests)

  const hostileName =
    'PC-HOSTILE-NAME <img src=x onerror="globalThis.PC_PWNED=1">.jpg'
  await page.getByLabel('Choose a JPEG').setInputFiles({
    name: hostileName,
    mimeType: 'image/jpeg',
    buffer: readFileSync(join(fixtureDirectory, 'metadata-rich.jpg')),
  })

  await expect(page.getByRole('status')).toContainText('Source ready')
  await expect(page.getByText(hostileName, { exact: true })).toBeVisible()
  await expect(
    page
      .getByText(
        'PC-HOSTILE-EXIF <img src=x onerror="globalThis.PC_PWNED=1">',
        { exact: true },
      )
      .first(),
  ).toBeVisible()
  await expect(
    page.getByText('PC-HOSTILE-XMP <script>globalThis.PC_PWNED=1</script>', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText('PC-HOSTILE-IPTC <svg onload=globalThis.PC_PWNED=1>', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Location' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Device identity' }),
  ).toBeVisible()

  expect(await page.evaluate(() => Reflect.has(globalThis, 'PC_PWNED'))).toBe(
    false,
  )
  expect(runtimeRequests).toEqual([])
})

test('bounds filenames and makes bidirectional controls visible', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )

  const fixtureBytes = readFileSync(join(fixtureDirectory, 'control-valid.jpg'))
  await page.getByLabel('Choose a JPEG').setInputFiles({
    name: 'report.jpg\u202egpj.exe',
    mimeType: 'image/jpeg',
    buffer: fixtureBytes,
  })
  await expect(page.getByRole('status')).toContainText('Source ready')
  const displayedName = page.locator('.source-facts dd').first()
  await expect(displayedName).toHaveText('report.jpg\\u{202e}gpj.exe')

  await page.getByLabel('Choose a JPEG').setInputFiles({
    name: `${'x'.repeat(520)}.jpg`,
    mimeType: 'image/jpeg',
    buffer: fixtureBytes,
  })
  await expect(page.getByRole('status')).toContainText('Source ready')
  await expect(displayedName).toHaveText(`${'x'.repeat(511)}…`)
})

test('reports typed intake failure and recovers for the next source', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )

  await page
    .getByLabel('Choose a JPEG')
    .setInputFiles(join(fixtureDirectory, 'invalid-not-jpeg.jpg'))
  await expect(page.getByRole('status')).toContainText(
    'Only JPEG Source Media is supported',
  )
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toBeHidden()

  await page
    .getByLabel('Choose a JPEG')
    .setInputFiles(join(fixtureDirectory, 'control-valid.jpg'))
  await expect(page.getByRole('status')).toContainText('Source ready')
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toBeVisible()
})

test('contains decoder failure behind a typed worker error', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )

  const structurallyCompleteButUndecodable = Buffer.from(
    readFileSync(join(fixtureDirectory, 'control-valid.jpg')),
  )
  const frameOffset = structurallyCompleteButUndecodable.indexOf(
    Buffer.from([0xff, 0xc0]),
  )
  expect(frameOffset).toBeGreaterThan(0)
  structurallyCompleteButUndecodable[frameOffset + 4] = 0
  await page.getByLabel('Choose a JPEG').setInputFiles({
    name: 'undecodable.jpg',
    mimeType: 'image/jpeg',
    buffer: structurallyCompleteButUndecodable,
  })

  await expect(page.getByRole('status')).toContainText(
    'The JPEG could not be decoded safely',
  )
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toBeHidden()
})

test('reset releases the preview and worker session without persistence or egress', async ({
  page,
}) => {
  const runtimeRequests: string[] = []
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  trackNetworkRequests(page, runtimeRequests)

  await page
    .getByLabel('Choose a JPEG')
    .setInputFiles(join(fixtureDirectory, 'metadata-rich.jpg'))
  await expect(page.getByRole('status')).toContainText('Source ready')
  await page.getByRole('button', { name: 'Reset session' }).click()

  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toBeHidden()
  await expect(page.getByText('Metadata risks')).toBeHidden()
  expect(runtimeRequests).toEqual([])
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      indexedDb: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
    })),
  ).toEqual({ local: 0, session: 0, indexedDb: 0, caches: 0 })
})

test('keeps full-resolution pixels in the worker and returns a bounded preview', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )

  const jpegBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('missing fixture context')
    context.fillStyle = '#d23b31'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result === null
            ? reject(new Error('JPEG encode failed'))
            : resolve(result),
        'image/jpeg',
        0.9,
      )
    })
    return [...new Uint8Array(await blob.arrayBuffer())]
  })

  await page.getByLabel('Choose a JPEG').setInputFiles({
    name: 'large-preview-control.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpegBytes),
  })
  await expect(page.getByRole('status')).toContainText('Source ready')
  await expect(page.getByText('1024 × 512 pixels')).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toHaveJSProperty('width', 512)
  await expect(
    page.getByRole('img', { name: 'Normalized Source Media preview' }),
  ).toHaveJSProperty('height', 256)
})

test('normalizes EXIF orientations 1 through 8 into displayed pixels', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )

  const orientationFixtures = fixtureManifest.fixtures.filter(
    (fixture) => fixture.orientation !== undefined,
  )
  expect(orientationFixtures).toHaveLength(8)

  for (const fixture of orientationFixtures) {
    await page
      .getByLabel('Choose a JPEG')
      .setInputFiles(join(fixtureDirectory, fixture.file))
    await expect(page.getByRole('status')).toContainText('Source ready')
    await expect(
      page.getByText(
        `${fixture.normalizedWidth} × ${fixture.normalizedHeight} pixels`,
      ),
    ).toBeVisible()

    const corners = await page
      .getByRole('img', { name: 'Normalized Source Media preview' })
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('missing preview context')
        const points = [
          [canvas.width / 4, canvas.height / 4],
          [(canvas.width * 3) / 4, canvas.height / 4],
          [canvas.width / 4, (canvas.height * 3) / 4],
          [(canvas.width * 3) / 4, (canvas.height * 3) / 4],
        ]
        return points.map(([x, y]) => {
          const [red = 0, green = 0, blue = 0] = context.getImageData(
            Math.floor(x),
            Math.floor(y),
            1,
            1,
          ).data
          if (red > 150 && green > 150) return 'yellow'
          if (red > green && red > blue) return 'red'
          if (green > red && green > blue) return 'green'
          return 'blue'
        })
      })
    expect(corners, fixture.file).toEqual(fixture.expectedCorners)
  }
})
