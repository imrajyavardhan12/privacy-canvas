import { chromium } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(repositoryRoot, 'tests/fixtures/png')
const outputPath = join(outputDirectory, 'verified-redaction.png')
const sourcePath = join(repositoryRoot, 'tests/fixtures/jpeg/control-valid.jpg')
const origin = 'http://127.0.0.1:4174'

execFileSync('corepack', ['pnpm', 'build'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})
await mkdir(outputDirectory, { recursive: true })

const server = spawn(
  'corepack',
  [
    'pnpm',
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4174',
    '--strictPort',
  ],
  { cwd: repositoryRoot, stdio: 'ignore' },
)

let browser
try {
  await waitForServer(origin)
  browser = await chromium.launch()
  const page = await browser.newPage({ acceptDownloads: true })
  await page.goto(origin)
  await page
    .getByRole('status')
    .filter({ hasText: 'Ready to inspect' })
    .waitFor()
  await page.getByLabel('Choose a JPEG').setInputFiles(sourcePath)
  await page.getByRole('status').filter({ hasText: 'Source ready' }).waitFor()
  await page.getByRole('button', { name: 'Add opaque rectangle' }).click()
  await page.getByRole('button', { name: 'Create verified PNG' }).click()
  const downloadLink = page.getByRole('link', {
    name: 'Download verified PNG',
  })
  await downloadLink.waitFor()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLink.click(),
  ])
  await download.saveAs(outputPath)
  console.log(`Generated ${outputPath}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Preview server exited with code ${server.exitCode}.`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for the preview server.')
}
