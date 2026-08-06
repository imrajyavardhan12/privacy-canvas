import { expect, test } from '@playwright/test'
import { join } from 'node:path'

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
