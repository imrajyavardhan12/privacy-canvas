import { expect, test } from '@playwright/test'
import { join } from 'node:path'

const fixture = join(process.cwd(), 'tests/fixtures/jpeg/control-valid.jpg')

test('runs the complete manual privacy workflow offline from the installed asset cache', async ({
  context,
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('Network Lock active')).toBeVisible()
  const installedCache = await readAssetCache(page)
  expect(installedCache.names).toHaveLength(1)
  expect(installedCache.names[0]).toMatch(
    /^privacy-canvas-assets-[a-f0-9]{16}$/,
  )
  expect(installedCache.urls).toHaveLength(3)
  expect(installedCache.urls).toEqual(
    expect.arrayContaining([
      'http://127.0.0.1:4173/',
      expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:4173\/assets\/index-[a-zA-Z0-9_-]+\.css$/,
      ),
      expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:4173\/assets\/index-[a-zA-Z0-9_-]+\.js$/,
      ),
    ]),
  )

  await page.close()
  await context.setOffline(true)
  const offlinePage = await context.newPage()
  await offlinePage.goto('/')
  await expect(offlinePage.getByText('Network Lock active')).toBeVisible()
  await expect(offlinePage.getByLabel('Choose a JPEG')).toBeEnabled()

  await offlinePage.getByLabel('Choose a JPEG').setInputFiles(fixture)
  await expect(offlinePage.getByRole('status')).toContainText('Source ready')
  await offlinePage
    .getByRole('button', { name: 'Add opaque rectangle' })
    .click()
  await offlinePage.getByRole('button', { name: 'Create verified PNG' }).click()
  await expect(
    offlinePage.getByRole('link', { name: 'Download verified PNG' }),
  ).toBeVisible()

  expect(await readAssetCache(offlinePage)).toEqual(installedCache)
})

async function readAssetCache(
  page: import('@playwright/test').Page,
): Promise<Readonly<{ names: string[]; urls: string[] }>> {
  return await page.evaluate(async () => {
    const names = (await caches.keys()).sort()
    const urls: string[] = []
    for (const name of names) {
      const cache = await caches.open(name)
      urls.push(...(await cache.keys()).map(({ url }) => url))
    }
    return { names, urls: urls.sort() }
  })
}
