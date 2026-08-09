import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const fixture = join(process.cwd(), 'tests/fixtures/jpeg/control-valid.jpg')

async function openSource(
  page: import('@playwright/test').Page,
  runtimeRequests?: string[],
): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  if (runtimeRequests !== undefined) {
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) runtimeRequests.push(request.url())
    })
  }
  await page.getByLabel('Choose a JPEG').setInputFiles(fixture)
  await expect(page.getByRole('status')).toContainText('Source ready')
}

test('keyboard user can add, move, resize, remove, undo, and redo one rectangle', async ({
  page,
}) => {
  await openSource(page)

  await page
    .getByRole('button', { name: 'Add opaque rectangle' })
    .press('Enter')
  const editor = page.getByRole('group', { name: 'Redaction editor' })
  await editor.focus()
  await expect(page.getByText('1 confirmed opaque rectangle')).toBeVisible()
  await expect(
    page.getByText(/Rectangle: x 25%, y 25%, width 50%, height 50%/),
  ).toBeVisible()

  await editor.press('ArrowRight')
  await expect(
    page.getByText(/Rectangle: x 27%, y 25%, width 50%, height 50%/),
  ).toBeVisible()

  await editor.press('Shift+ArrowRight')
  await expect(
    page.getByText(/Rectangle: x 27%, y 25%, width 52%, height 50%/),
  ).toBeVisible()

  await editor.press('Delete')
  await expect(page.getByText('No confirmed redactions')).toBeVisible()

  await editor.press('Control+z')
  await expect(page.getByText('1 confirmed opaque rectangle')).toBeVisible()
  await editor.press('Control+z')
  await expect(page.getByText(/width 50%/)).toBeVisible()
  await editor.press('Control+y')
  await expect(page.getByText(/width 52%/)).toBeVisible()
})

test('renders confirmed masks into the worker-produced preview', async ({
  page,
}) => {
  await openSource(page)
  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()

  const preview = page.getByRole('img', {
    name: 'Normalized Source Media preview',
  })
  await expect
    .poll(() =>
      preview.evaluate((element) => {
        const canvas = element as HTMLCanvasElement
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('missing preview context')
        return [
          ...context.getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data,
        ]
      }),
    )
    .toEqual([0, 0, 0, 255])
  await expect(preview).toHaveJSProperty('width', 64)
  await expect(preview).toHaveJSProperty('height', 48)
})

test('discards stale previews and redraws from retained canonical source pixels', async ({
  page,
}) => {
  await openSource(page)
  const preview = page.getByRole('img', {
    name: 'Normalized Source Media preview',
  })
  const sourcePixel = await readPreviewPixel(preview, 17, 24)
  expect(sourcePixel).not.toEqual([0, 0, 0, 255])

  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()
  const editor = page.getByRole('group', { name: 'Redaction editor' })
  await editor.focus()
  for (let step = 0; step < 4; step += 1) await editor.press('ArrowRight')

  await expect
    .poll(async () => ({
      uncovered: await readPreviewPixel(preview, 17, 24),
      covered: await readPreviewPixel(preview, 20, 24),
    }))
    .toEqual({
      uncovered: sourcePixel,
      covered: [0, 0, 0, 255],
    })
})

test('withholds download until a full-resolution PNG is independently verified', async ({
  page,
}) => {
  const runtimeRequests: string[] = []
  await openSource(page, runtimeRequests)
  await expect(
    page.getByRole('link', { name: 'Download verified PNG' }),
  ).toBeHidden()
  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()

  await page.getByRole('button', { name: 'Create verified PNG' }).click()
  await expect(page.getByRole('status')).toContainText('Verified PNG ready')
  await expect(page.getByText('1 opaque region checked')).toBeVisible()
  const downloadLink = page.getByRole('link', {
    name: 'Download verified PNG',
  })
  await expect(downloadLink).toHaveAttribute('download', 'privacy-export.png')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLink.click(),
  ])
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  if (downloadedPath === null) return
  const png = readStrictRgbPng(await readFile(downloadedPath))

  expect(png.dimensions).toEqual({ width: 64, height: 48 })
  expect(png.chunkTypes).toEqual(['IHDR', 'IDAT', 'IEND'])
  expect(readRgbPixel(png.rgb, png.dimensions.width, 32, 24)).toEqual([0, 0, 0])
  expect(runtimeRequests).toEqual([])
})

test('fails closed and restores intake after malformed export output', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalAddEventListener = Worker.prototype.addEventListener
    Object.defineProperty(Worker.prototype, 'addEventListener', {
      configurable: true,
      value(
        this: Worker,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type !== 'message' || listener === null) {
          originalAddEventListener.call(this, type, listener, options)
          return
        }
        const invokeListener = (event: Event): void => {
          if (typeof listener === 'function') listener.call(this, event)
          else listener.handleEvent(event)
        }
        const validateExportResponse = (event: Event): void => {
          const data = (event as MessageEvent<unknown>).data
          if (
            typeof data === 'object' &&
            data !== null &&
            'type' in data &&
            data.type === 'export-ready'
          ) {
            invokeListener(
              new MessageEvent('message', {
                data: {
                  ...(data as Record<string, unknown>),
                  rgba: new Uint8Array(4),
                },
              }),
            )
            return
          }
          invokeListener(event)
        }
        originalAddEventListener.call(
          this,
          type,
          validateExportResponse,
          options,
        )
      },
    })
  })
  await openSource(page)
  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()

  await page.getByRole('button', { name: 'Create verified PNG' }).click()

  await expect(page.getByRole('status')).toContainText(
    'Privacy Export could not be verified safely',
  )
  await expect(page.getByLabel('Choose a JPEG')).toBeEnabled()
  await expect(
    page.getByRole('link', { name: 'Download verified PNG' }),
  ).toBeHidden()
})

test('invalidates a verified download when the Working Document changes', async ({
  page,
}) => {
  await openSource(page)
  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()
  await page.getByRole('button', { name: 'Create verified PNG' }).click()
  await expect(
    page.getByRole('link', { name: 'Download verified PNG' }),
  ).toBeVisible()

  const editor = page.getByRole('group', { name: 'Redaction editor' })
  await editor.focus()
  await editor.press('ArrowRight')

  await expect(
    page.getByRole('link', { name: 'Download verified PNG' }),
  ).toBeHidden()
  await expect(page.getByRole('status')).toContainText(
    'Working Document changed. Create a new verified PNG',
  )
})

test('pointer user edits one rectangle in canonical coordinates', async ({
  page,
}) => {
  const runtimeRequests: string[] = []
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await openSource(page, runtimeRequests)
  const editor = page.getByRole('group', { name: 'Redaction editor' })
  await editor.scrollIntoViewIfNeeded()
  const bounds = await editor.boundingBox()
  expect(bounds).not.toBeNull()
  if (bounds === null) return
  const point = (x: number, y: number) => ({
    x: bounds.x + bounds.width * x,
    y: bounds.y + bounds.height * y,
  })

  await page.mouse.move(point(0.1, 0.1).x, point(0.1, 0.1).y)
  await page.mouse.down()
  await page.mouse.move(point(0.105, 0.11).x, point(0.105, 0.11).y)
  await page.mouse.up()
  await expect(page.getByText('No confirmed redactions')).toBeVisible()
  expect(pageErrors).toEqual([])

  await page.mouse.move(point(0.2, 0.2).x, point(0.2, 0.2).y)
  await page.mouse.down()
  await page.mouse.move(point(0.5, 0.6).x, point(0.5, 0.6).y)
  await page.mouse.up()
  await expect(
    page.getByText(/Rectangle: x 20%, y 20%, width 30%, height 40%/),
  ).toBeVisible()

  await page.mouse.move(point(0.3, 0.3).x, point(0.3, 0.3).y)
  await page.mouse.down()
  await page.mouse.move(point(0.4, 0.4).x, point(0.4, 0.4).y)
  await page.mouse.up()
  await expect(
    page.getByText(/Rectangle: x 30%, y 30%, width 30%, height 40%/),
  ).toBeVisible()

  await page.mouse.move(point(0.6, 0.7).x, point(0.6, 0.7).y)
  await page.mouse.down()
  await page.mouse.move(point(0.8, 0.9).x, point(0.8, 0.9).y)
  await page.mouse.up()
  await expect(
    page.getByText(/Rectangle: x 30%, y 30%, width 50%, height 60%/),
  ).toBeVisible()

  await page.mouse.move(point(0.4, 0.4).x, point(0.4, 0.4).y)
  await page.mouse.down()
  await page.mouse.move(point(-0.1, -0.1).x, point(-0.1, -0.1).y)
  await page.mouse.up()
  await expect(
    page.getByText(/Rectangle: x 0%, y 0%, width 50%, height 60%/),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Remove rectangle' }).click()
  await expect(page.getByText('No confirmed redactions')).toBeVisible()
  expect(runtimeRequests).toEqual([])
})

function readStrictRgbPng(bytes: Uint8Array): Readonly<{
  dimensions: Readonly<{ width: number; height: number }>
  chunkTypes: readonly string[]
  rgb: Uint8Array
}> {
  expect([...bytes.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  const chunks: Array<Readonly<{ type: string; data: Uint8Array }>> = []
  let offset = 8
  while (offset < bytes.byteLength) {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    chunks.push({
      type,
      data: bytes.subarray(offset + 8, offset + 8 + length),
    })
    offset += length + 12
  }
  const header = chunks[0]?.data
  if (header === undefined) throw new Error('missing PNG header')
  const headerView = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  )
  const dimensions = {
    width: headerView.getUint32(0),
    height: headerView.getUint32(4),
  }
  const compressed = Buffer.concat(
    chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data),
  )
  const scanlines = inflateSync(compressed)
  const rowBytes = dimensions.width * 3
  const rgb = new Uint8Array(rowBytes * dimensions.height)
  for (let y = 0; y < dimensions.height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1)
    expect(scanlines[scanlineOffset]).toBe(0)
    rgb.set(
      scanlines.subarray(scanlineOffset + 1, scanlineOffset + rowBytes + 1),
      y * rowBytes,
    )
  }
  return {
    dimensions,
    chunkTypes: chunks.map(({ type }) => type),
    rgb,
  }
}

function readRgbPixel(
  rgb: Uint8Array,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 3
  return [...rgb.subarray(offset, offset + 3)]
}

async function readPreviewPixel(
  preview: import('@playwright/test').Locator,
  x: number,
  y: number,
): Promise<number[]> {
  return preview.evaluate(
    (element, point) => {
      const canvas = element as HTMLCanvasElement
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('missing preview context')
      return [...context.getImageData(point.x, point.y, 1, 1).data]
    },
    { x, y },
  )
}
