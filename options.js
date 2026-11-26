// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
// Options: on/off, the largest file to open, the SolidOS link, and an on/off switch for each bundled pane
// (pane-list.js). Stored with storage.local (this browser only).
const api = globalThis.browser || globalThis.chrome
const DEFAULTS = { enabled: true, maxMB: 50, panes: {}, solidosLink: true }
const LIST = globalThis.SOLID_PANE_LIST || []
const enabled = document.getElementById('enabled')
const maxMB = document.getElementById('maxMB')
const solidosLink = document.getElementById('solidosLink')
const saved = document.getElementById('saved')
const switches = {}

for (const p of LIST) {
  const card = document.createElement('div')
  card.className = 'pane'
  const row = document.createElement('label')
  row.className = 'row'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.dataset.pane = p.name
  box.checked = true
  const name = document.createElement('span')
  const icon = document.createElement('img')
  icon.alt = ''
  import('./' + p.file).then(m => { icon.src = m.default.icon }, () => { icon.hidden = true }) // the pane's own icon
  name.append(icon, p.title)
  row.append(box, name)
  const what = document.createElement('p')
  what.textContent = p.opens
  const more = document.createElement('p')
  const link = document.createElement('a')
  link.href = p.source
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = p.source.replace(/^https:\/\//, '')
  more.append(p.licence + ' · ', link)
  card.append(row, what, more)
  document.getElementById('panes').append(card)
  box.addEventListener('change', save)
  switches[p.name] = box
}

api.storage.local.get(DEFAULTS).then(o => {
  enabled.checked = !!o.enabled
  maxMB.value = String(o.maxMB)
  solidosLink.checked = o.solidosLink !== false
  for (const name in switches) switches[name].checked = (o.panes || {})[name] !== false
})
function save () {
  const mb = Math.min(1000, Math.max(1, Math.round(Number(maxMB.value) || DEFAULTS.maxMB)))
  const panes = {}
  for (const name in switches) panes[name] = switches[name].checked
  api.storage.local.set({ enabled: enabled.checked, maxMB: mb, panes, solidosLink: solidosLink.checked }).then(() => { saved.textContent = 'Saved' })
}
enabled.addEventListener('change', save)
maxMB.addEventListener('change', save)
solidosLink.addEventListener('change', save)
