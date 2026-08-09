import { expect, test } from '@playwright/test'
import { join } from 'node:path'

const fixture = join(process.cwd(), 'tests/fixtures/jpeg/control-valid.jpg')

test('exercises the narrow verified workflow in WebKit-like automation', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()
  const runtimeRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) runtimeRequests.push(request.url())
  })

  await page.getByLabel('Choose a JPEG').setInputFiles(fixture)
  await expect(page.getByRole('status')).toContainText('Source ready')
  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()
  await page.getByRole('button', { name: 'Create verified PNG' }).click()
  const downloadLink = page.getByRole('link', {
    name: 'Download verified PNG',
  })
  await expect(downloadLink).toHaveAttribute('download', 'privacy-export.png')
  await expect(page.getByText('1 opaque region checked')).toBeVisible()
  expect(runtimeRequests).toEqual([])

  await page.getByRole('button', { name: 'Reset session' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Ready to inspect one local JPEG',
  )
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      indexedDb: (await indexedDB.databases()).length,
      assetCaches: (await caches.keys()).filter((name) =>
        name.startsWith('privacy-canvas-assets-'),
      ).length,
    })),
  ).toEqual({ local: 0, session: 0, indexedDb: 0, assetCaches: 1 })
})
