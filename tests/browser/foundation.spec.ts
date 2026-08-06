import { expect, test } from '@playwright/test'

test('describes local intake and editing without claiming verified export is ready', async ({
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
      'Rectangle editing is local; verified export is not available yet',
    ),
  ).toBeVisible()
  await expect(page.getByText('User media stays on this device')).toBeVisible()
})
