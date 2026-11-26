// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/settings.js — what the user has chosen, from storage.local (this browser only).
// Owns: the defaults, reading the settings, and remembering which tab was last chosen.
// Must not: decide what the build contains (config.js), or touch the page.
// (options.js writes the same keys; it keeps its own copy of the defaults.)
(() => {
  const H = globalThis.SOLID_PANE_HOST
  const DEFAULTS = { enabled: true, maxMB: 50, panes: {}, chosen: {}, solidosLink: true }

  H.settings = {
    DEFAULTS,
    read: () => H.api.storage.local.get(DEFAULTS).catch(() => DEFAULTS),
    // the longest text to take over
    maxChars: opts => Math.max(0.1, Number(opts.maxMB) || 50) * 1048576,
    // a pane is on unless it has been switched off
    paneOn: (opts, name) => (opts.panes || {})[name] !== false,
    remember: chosen => { H.api.storage.local.set({ chosen }).catch(() => {}) }
  }
})()
