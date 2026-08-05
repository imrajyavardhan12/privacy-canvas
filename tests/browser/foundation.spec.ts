import { expect, test } from '@playwright/test'

test('describes the foundation without claiming image processing is ready', async ({
  page,
}) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Privacy Canvas' }),
  ).toBeVisible()
  await expect(page.getByRole('status')).toContainText(
    'The editor is not available yet',
  )
  await expect(
    page.getByText('No user media is processed in this build'),
  ).toBeVisible()
})
