// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
// Options: on/off and the largest file to open. Stored with storage.local (this browser only).
const api = globalThis.browser || globalThis.chrome
const DEFAULTS = { enabled: true, maxMB: 50 }
const enabled = document.getElementById('enabled')
const maxMB = document.getElementById('maxMB')
const saved = document.getElementById('saved')
api.storage.local.get(DEFAULTS).then(o => { enabled.checked = !!o.enabled; maxMB.value = String(o.maxMB) })
function save () {
  const mb = Math.min(1000, Math.max(1, Math.round(Number(maxMB.value) || DEFAULTS.maxMB)))
  api.storage.local.set({ enabled: enabled.checked, maxMB: mb }).then(() => { saved.textContent = 'Saved' })
}
enabled.addEventListener('change', save)
maxMB.addEventListener('change', save)
