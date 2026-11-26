// Draws icons/icon-{16,32,48,128}.png from icons/icon.svg with Playwright's Chromium.
// node tools/make-icons.mjs [path/to/playwright/index.mjs]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const pw = process.argv[2] || '/home/melvin/remote/github.com/melvincarvalho/mindstr/node_modules/playwright/index.mjs'
const { chromium } = await import(pw)
const svg = readFileSync(join(here, 'icons', 'icon.svg'), 'utf8')
const browser = await chromium.launch()
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: join(here, 'icons', `icon-${size}.png`), omitBackground: true })
  await page.close()
}
await browser.close()
console.log('icons written')
