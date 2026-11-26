// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/config.js — the one place that says what this build of the extension is. Together with
// pane-list.js (which panes are bundled) it decides everything the other host modules do: the kinds
// of page worth looking at follow from the panes in the list, and each control is a feature here.
// A JSON-only build is this file and pane-list.js (and the pane files named in manifest.json).
// Owns: the SOLID_PANE_HOST namespace every host module attaches to. This is the content script's
// own world; the page cannot see it.
// Must not: touch the page, read storage, or hold anything the user can change (that is settings.js).
(() => {
  const panes = (globalThis.SOLID_PANE_LIST || []).slice()
  globalThis.SOLID_PANE_HOST = {
    api: globalThis.browser || globalThis.chrome,
    config: {
      panes, // most specific first
      kinds: [...new Set(panes.map(p => p.kind))], // 'json', 'markdown': a kind with no pane is never detected
      features: {
        tabs: true, // a tab bar when more than one pane fits; off: only the first that fits
        rawSwitch: true, // the Viewer / Raw switch in the corner
        solidosLink: true // the "Open in SolidOS" link (the user can also switch it off in the options)
      }
    }
  }
})()
