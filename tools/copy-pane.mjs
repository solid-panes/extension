// Copies json-pane.js, unchanged, from the pane repository into the extension.
// node tools/copy-pane.mjs [path/to/json-pane.js]   (default: ../2026-11-26-json-repo/json-pane.js)
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const from = resolve(process.argv[2] || join(here, '..', '2026-11-26-json-repo', 'json-pane.js'))
const body = readFileSync(from)
if (!/^export default pane\s*$/m.test(body.toString())) throw new Error(from + ' does not look like the JSON pane')
writeFileSync(join(here, 'json-pane.js'), body)
console.log('copied', from, '->', join(here, 'json-pane.js'), body.length, 'bytes, sha256', createHash('sha256').update(body).digest('hex'))
