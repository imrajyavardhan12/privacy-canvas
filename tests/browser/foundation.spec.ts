import { expect, test } from '@playwright/test'

test('describes the available intake without claiming editing or export is ready', async ({
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
    page.getByText('Redaction and export are not available yet'),
  ).toBeVisible()
  await expect(page.getByText('User media stays on this device')).toBeVisible()
})
