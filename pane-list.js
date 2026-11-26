// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// pane-list.js — the panes bundled in the extension, most specific first. Read by content.js (to
// choose a pane for the page) and by the options page (the on/off list). The pane files themselves
// are copied in unchanged by tools/copy-pane.mjs, which records where each came from in panes.json.
//   kind      the sort of page the host offers the pane: 'json' (JSON, JSON Lines) or 'markdown'
//   needs     text the page must contain before the pane's file is loaded at all
//   trustKind true: the host's own page test is enough; false: the pane's label() decides
globalThis.SOLID_PANE_LIST = [
  {
    name: 'mindstr',
    file: 'mindstr-pane.js',
    title: 'Mind map',
    opens: 'Mindstr mind maps: JSON-LD with nodes and connections',
    kind: 'json',
    needs: 'https://mindstr.org/ns#',
    trustKind: false,
    licence: 'AGPL-3.0-or-later',
    source: 'https://github.com/solid-panes/mindstr'
  },
  {
    name: 'notes-reader',
    file: 'notes-pane.js',
    title: 'Notes',
    opens: 'Markdown: text/markdown pages, and text files whose address ends in .md',
    kind: 'markdown',
    trustKind: true,
    licence: 'MIT',
    source: 'https://github.com/solid-panes/notes'
  },
  {
    name: 'json-viewer',
    file: 'json-pane.js',
    title: 'JSON',
    opens: 'JSON, JSON-LD and JSON Lines: tree, table and raw text',
    kind: 'json',
    trustKind: true,
    licence: 'AGPL-3.0-or-later',
    source: 'https://github.com/solid-panes/json'
  }
]
