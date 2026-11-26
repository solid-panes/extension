// Renders tools/og.html to og.png (1200 × 630), the picture shown when a link to the site is shared.
// The window in it is drawn by json-pane.js itself, so this serves the repo folder on a local port first.
// Any request that is not to that local port is refused, so the picture cannot depend on the network.
//   node tools/og.mjs [path to playwright's index.mjs]   (default: the playwright package)
// Not part of the extension: nothing in manifest.json refers to tools/, index.html or og.png.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, extname, normalize } from 'node:path'
const { chromium } = await import(process.argv[2] || 'playwright')
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  try {
    const body = await readFile(join(root, path))
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream')
    res.setHeader('Content-Length', body.length)
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch { res.statusCode = 404; res.end() }
}).listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
const refused = []
await page.route('**/*', route => {
  const url = route.request().url()
  if (url.startsWith(origin + '/')) return route.continue()
  refused.push(url)
  return route.abort()
})
page.on('pageerror', e => console.error('page error:', e.message))
await page.goto(`${origin}/tools/og.html`)
await page.waitForSelector('body.ready')
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)
await page.screenshot({ path: here('../og.png') })
await browser.close()
server.close()
if (refused.length) console.error('refused (not local):', refused.join(', '))
console.log('og.png written')
