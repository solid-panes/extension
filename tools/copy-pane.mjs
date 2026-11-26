// Copies the bundled panes, byte for byte, from their own repositories into the extension, and
// writes panes.json: where each file came from, at which commit, and its SHA-256.
//   node tools/copy-pane.mjs                      copy all three from the default folders
//   node tools/copy-pane.mjs json=path/to/json-pane.js notes=... mindstr=...   other sources
// Nothing in a pane is edited; all adapting to the browser page is in content.js.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
// also: the Notes pane's MIT licence text travels with it, as notes-pane.LICENSE (the pane file has no licence header)
const PANES = [
  { key: 'mindstr', file: 'mindstr-pane.js', from: join(here, '..', '2026-11-25-mindstr-repo', 'mindstr-pane.js'), licence: 'AGPL-3.0-or-later' },
  { key: 'notes', file: 'notes-pane.js', from: join(homedir(), 'remote', 'github.com', 'solid-panes', 'notes', 'notes-pane.js'), licence: 'MIT', licenceFile: 'notes-pane.LICENSE' },
  { key: 'json', file: 'json-pane.js', from: join(here, '..', '2026-11-26-json-repo', 'json-pane.js'), licence: 'AGPL-3.0-or-later' }
]
const given = Object.fromEntries(process.argv.slice(2).map(a => a.split(/=(.*)/s).slice(0, 2)))
for (const k in given) if (!PANES.some(p => p.key === k)) throw new Error('unknown pane "' + k + '": use ' + PANES.map(p => p.key + '=path').join(' '))

const git = (dir, ...args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch (e) { return '' } }
const tilde = p => p.startsWith(homedir() + '/') ? '~' + p.slice(homedir().length) : p
const record = []
for (const p of PANES) {
  const from = resolve(given[p.key] || p.from)
  const body = readFileSync(from)
  if (basename(from) !== p.file || !/^export default \w+\s*$/m.test(body.toString())) throw new Error(from + ' does not look like ' + p.file)
  writeFileSync(join(here, p.file), body)
  const dir = dirname(from)
  if (p.licenceFile) writeFileSync(join(here, p.licenceFile), readFileSync(join(dir, 'LICENSE')))
  const sha256 = createHash('sha256').update(body).digest('hex')
  record.push({
    file: p.file,
    licence: p.licence,
    repository: git(dir, 'remote', 'get-url', 'origin').replace(/\.git$/, ''),
    commit: git(dir, 'rev-parse', 'HEAD'),
    changedSinceCommit: git(dir, 'status', '--porcelain', '--', p.file) !== '', // true: the copy is newer than the commit named
    source: tilde(from),
    bytes: body.length,
    sha256
  })
  console.log('copied', from, '->', p.file, body.length, 'bytes, sha256', sha256)
}
writeFileSync(join(here, 'panes.json'), JSON.stringify({ note: 'Written by tools/copy-pane.mjs. Each file is an unchanged copy of the one in its repository.', panes: record }, null, 2) + '\n')
console.log('wrote panes.json')
