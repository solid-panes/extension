// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// json-pane.js — a JSON and JSON-LD viewer for the SolidOS data browser, read-only.
// Opens .json and .jsonld files (or anything the store knows is application/json or
// application/ld+json), and JSON Lines (.jsonl, .ndjson): one record a line, shown as an array of
// records, where a line that does not parse is an error row in place, not the end of the file. Fetches the file once as text with a short Accept header, parses it once,
// and shows it as:
//   - a Tree: collapsible and lazy (children are built when a node opens, and big arrays and
//     objects are split into ranges of 100), with type colours, counts, indent guides, previews
//     of dates, colours, links, images, e-mail addresses and Unix times, Copy value / Copy path,
//     and ARIA tree keyboard navigation;
//   - a Table of any array of objects, sortable, 200 rows a page;
//   - the Raw text, numbered and coloured, pretty-printed or as it came.
// Level 1-4 opens the tree to that depth and closes anything deeper; the selected row's path is a
// row of crumbs, each a jump to that ancestor.
// One search box finds keys and values (highlight, next/previous, count, a Filter that hides
// branches without matches), and when it starts with $ it runs a JSONPath query instead.
// A Schema panel lists the inferred type of every path. JSON-LD gets a light touch: @type values
// are badges and @id values are links that are followed in place: a reference to a node the same
// document defines jumps to it in the tree (with a back / forward trail, and "N references" on the
// definition to step through what points at it); a reference to another document opens it through
// the host, and "peek" fetches it and shows the node right under the reference. A file that does
// not parse gets an error card with the line, column and the text around it.
// Numbers too long for a JavaScript number (integers beyond 2^53, long decimals) keep their exact
// source text everywhere and carry a small "big" badge.
// It imports nothing, builds the DOM with createElement/textContent (never innerHTML), and
// writes nothing to the server.
//
// Hooks for hosts other than SolidOS (a browser extension, a plain page), all optional:
//   context.source = { text, contentType, url }  (or context.jsonText) — text the host already has,
//                     so the pane does not fetch again;
//   context.css     — a CSS string to use instead of the built-in one, or false for none (the host
//                     styled it, for example from an extension's manifest);
//   context.shadow  — true to draw inside an open shadow root; styles then go in as a constructed
//                     stylesheet, which a strict page Content-Security-Policy does not block;
//   context.imagePreviews — false to leave out picture previews, so nothing is loaded even on hover;
//   context.navigate — a function (url) that opens another document in place, used for a link to
//                     another document when the host has no outliner (SolidOS: getOutliner().GotoSubject);
//                     with neither, the link's own href is followed in the same tab;
//   context.peek    — false to leave out "peek", the one control that fetches another document
//                     (on a click only); a host that promises no network requests sets this;
//   pane.css        — the built-in CSS, for hosts that want to ship it as a file.
//
// https://solid-panes.github.io/json/ · licence: AGPL-3.0-or-later (see LICENSE).

const ACCEPT = 'application/json, application/ld+json;q=0.9, */*;q=0.5' // short: no CORS preflight
const PEEK_ACCEPT = 'application/ld+json, application/json;q=0.9, */*;q=0.1' // the same, for a linked document
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", sans-serif'
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace'
const LIMITS = {
  bucket: 100, // children shown at one level before they are grouped in ranges
  string: 280, // characters of a string shown before "more"
  cell: 120, // the same, in a table cell
  autoRows: 260, // rows opened on first view
  filterRows: 1500, // rows opened when the filter is on
  expandAll: 3000, // rows Expand all will open
  levelRows: 3000, // rows a Level button will show
  errText: 160, // characters of a bad line shown in its error row
  matches: 10000, // search matches kept for next / previous
  results: 100, // path query results shown at a time
  tablePage: 200, // table rows a page
  rawPage: 2000, // raw lines shown at a time
  rawLine: 4000, // characters of one raw line shown before "more"
  preview: 64 // characters of a collapsed node's preview
}
const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2f6fde" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/><circle cx="12" cy="12" r="1.2" fill="#2f6fde"/></svg>')

const CSS = `
.jv { --jv-text: #1b2230; --jv-muted: #5f687a; --jv-faint: #8f97a7; --jv-line: #e5e8ee; --jv-soft: #f5f7fa; --jv-panel: #f8f9fb;
  --jv-accent: #2f6fde; --jv-accent-ink: #1f55b8; --jv-accent-soft: #eaf1fd; --jv-key: #1e3f8c; --jv-str: #0b7a43; --jv-num: #b3510c;
  --jv-bool: #7a3fc6; --jv-null: #8a93a3; --jv-hit: #fff0a6; --jv-cur: #ffd54d; --jv-sm: 180px;
  box-sizing: border-box; width: 100%; padding: 0 0 56px; background: #fff; color: var(--jv-text); font: 14px/1.5 ${SANS};
  -webkit-text-size-adjust: 100% }
.jv.jv-pane { max-width: 1200px; margin: 0 auto }
.jv *, .jv *::before, .jv *::after { box-sizing: border-box }
.jv [hidden] { display: none !important }
.jv button { font: inherit; color: inherit }
.jv a { color: var(--jv-accent-ink) }
.jv-i { flex: 0 0 auto; display: block }

.jv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 18px 20px 14px }
.jv-name { margin: 0; flex: 1 1 260px; min-width: 0; display: flex; align-items: center; gap: 10px; font-size: 19px; line-height: 1.3; font-weight: 700; color: #141a29; overflow-wrap: anywhere }
.jv-name img, .jv-name .jv-logo { width: 26px; height: 26px; flex: 0 0 auto }
.jv-meta { display: flex; flex-wrap: wrap; gap: 6px }
.jv-pill { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; background: #f0f2f6; color: #4a5366; font-size: 12.5px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums }
.jv-pill.jv-fmt { background: var(--jv-accent-soft); color: var(--jv-accent-ink) }
.jv-pill.jv-fmt-ld { background: #f1eafd; color: #6633b0 }
.jv-pill.jv-pill-big { background: #fdf0e6; color: #9a4609 }
.jv-pill.jv-pill-ld { background: #f1eafd; color: #6633b0 }
.jv-pill.jv-pill-err { background: #fdecec; color: #9f1f1f }

.jv-bar { position: sticky; top: 0; z-index: 4; display: flex; flex-direction: column; gap: 8px; padding: 10px 20px; background: #fff;
  border-top: 1px solid var(--jv-line); border-bottom: 1px solid var(--jv-line); backdrop-filter: saturate(1.4) blur(8px); -webkit-backdrop-filter: saturate(1.4) blur(8px) }
.jv-barrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px }
.jv-grow { flex: 1 1 auto }
.jv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 44px; height: 44px; padding: 0 14px; border: 1px solid #d8dce5;
  border-radius: 11px; background: #fff; color: #2a3243; font-size: 14px; font-weight: 550; cursor: pointer; white-space: nowrap; transition: background .12s, border-color .12s }
.jv-btn:hover { background: var(--jv-soft); border-color: #c8cdd8 }
.jv-btn:active { background: #eef1f6 }
.jv-btn[aria-pressed="true"] { background: var(--jv-accent-soft); border-color: #a9c2f2; color: var(--jv-accent-ink) }
.jv-btn:disabled { opacity: .45; cursor: default; background: #fff }
.jv-btn.jv-sq { padding: 0; width: 44px }
.jv button:focus-visible, .jv a:focus-visible, .jv select:focus-visible, .jv summary:focus-visible { outline: 2.5px solid var(--jv-accent); outline-offset: 2px }

.jv-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px }
.jv-levels { display: inline-flex; align-items: stretch; height: 44px; border: 1px solid #d8dce5; border-radius: 11px; background: #fff; overflow: hidden }
.jv-levlab { display: flex; align-items: center; padding: 0 4px 0 12px; color: #4a5366; font-size: 13px; font-weight: 600; user-select: none; -webkit-user-select: none }
.jv-lev { width: 44px; min-width: 44px; height: 100%; padding: 0; border: 0; background: transparent; color: #2a3243; font-size: 14px; font-weight: 600; cursor: pointer; font-variant-numeric: tabular-nums; transition: background .12s }
.jv-lev + .jv-lev { box-shadow: inset 1px 0 0 #e5e8ee }
.jv-lev:hover { background: var(--jv-soft) }
.jv-lev[aria-pressed="true"] { background: var(--jv-accent-soft); color: var(--jv-accent-ink) }
.jv-lev:disabled { opacity: .45; cursor: default; background: transparent }
.jv .jv-lev:focus-visible, .jv .jv-crumb:focus-visible { outline-offset: -3px }
.jv-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 13px; background: #eef0f4 }
.jv-tab { height: 38px; min-width: 64px; padding: 0 16px; border: 0; border-radius: 10px; background: transparent; color: #4a5366; font-size: 14px; font-weight: 600; cursor: pointer }
.jv-tab:hover { color: #1b2230 }
.jv-tab[aria-selected="true"] { background: #fff; color: #141a29; box-shadow: 0 1px 2px rgba(20, 30, 60, .12), 0 0 0 1px rgba(20, 30, 60, .04) }

.jv-search { flex: 1 1 150px; min-width: 0; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 6px 0 13px; border: 1px solid #d8dce5; border-radius: 11px; background: #fff; transition: border-color .12s, box-shadow .12s }
.jv-search:focus-within { border-color: var(--jv-accent); box-shadow: 0 0 0 3px rgba(47, 111, 222, .16) }
.jv-search > .jv-i { color: #6f7889 }
.jv-q { flex: 1 1 auto; min-width: 0; height: 40px; border: 0; outline: 0; background: transparent; color: var(--jv-text); font: 15px ${SANS} }
.jv-q::placeholder { color: #98a0af }
.jv-q.jv-q-path { font: 14px ${MONO} }
.jv-mode { padding: 2px 8px; border-radius: 6px; background: #f1eafd; color: #6633b0; font-size: 11.5px; font-weight: 700; letter-spacing: .02em; white-space: nowrap }
.jv-count { color: var(--jv-muted); font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums }
.jv-count.jv-none { color: #b4322f }
.jv-clear { display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 8px; background: transparent; color: #7a8394; cursor: pointer }
.jv-clear:hover { background: #f0f2f6; color: #1b2230 }

.jv-pathbar { display: flex; align-items: center; gap: 8px; min-height: 44px }
.jv-pathbar code { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; font: 13px/1.4 ${MONO}; color: #3a4357; white-space: nowrap;
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none }
.jv-pathbar code::-webkit-scrollbar { display: none }
.jv-crumb { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 44px; padding: 0 7px; border: 0; border-radius: 9px; background: none; color: #3a4357; cursor: pointer; white-space: nowrap }
.jv-crumb + .jv-crumb::before { content: '›'; margin-right: 9px; color: #a3aab7; font-weight: 400 }
.jv-crumb:hover { background: var(--jv-soft); color: var(--jv-accent-ink) }
.jv-crumb[aria-current] { font-weight: 600; color: var(--jv-key) }
.jv-cx { display: none }
.jv-crange { flex: 0 0 auto; padding: 0 8px; color: var(--jv-muted) }
.jv-pathbar .jv-btn { height: 40px; font-size: 13px; padding: 0 12px }

.jv-trail { display: flex; align-items: center; gap: 8px; min-height: 44px }
.jv-trailtext { flex: 1 1 auto; min-width: 0; color: #4a5366; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere }
.jv-trailtext b { color: #6633b0; font-weight: 650 }

.jv-schema { margin: 14px 20px 0; border: 1px solid var(--jv-line); border-radius: 12px; background: #fff; overflow: hidden }
.jv-schema > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-height: 46px; padding: 8px 14px; cursor: pointer; list-style: none; user-select: none }
.jv-schema > summary::-webkit-details-marker { display: none }
.jv-schema > summary:hover { background: var(--jv-panel) }
.jv-schema > summary .jv-chev { color: #7a8394; transition: transform .15s }
.jv-schema[open] > summary .jv-chev { transform: rotate(90deg) }
.jv-stitle { font-weight: 650; color: #1b2230 }
.jv-sstats { color: var(--jv-muted); font-size: 13px; font-variant-numeric: tabular-nums }
.jv-sbody { max-height: 52vh; overflow: auto; border-top: 1px solid var(--jv-line); padding: 6px 0 }
.jv-srow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; width: 100%; min-height: 38px; padding: 6px 14px; border: 0; background: none; text-align: left; cursor: pointer }
.jv-srow:hover { background: var(--jv-panel) }
.jv-spath { flex: 1 1 260px; min-width: 0; font: 13px/1.45 ${MONO}; color: #2b3446; overflow-wrap: anywhere }
.jv-stypes { display: flex; flex-wrap: wrap; gap: 5px }
.jv-stype { padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #f0f2f6; color: #4a5366; white-space: nowrap; font-variant-numeric: tabular-nums }
.jv-stype.t-string { background: #e8f6ee; color: #0b6b3b }
.jv-stype.t-number { background: #fdf0e6; color: #9a4609 }
.jv-stype.t-boolean { background: #f3ecfd; color: #6a35b0 }
.jv-stype.t-null { background: #f0f2f6; color: #6f7889 }
.jv-stype.t-object, .jv-stype.t-array { background: #eaf1fd; color: #1f55b8 }
.jv-stype.t-error { background: #fdecec; color: #9f1f1f }
.jv-snote { padding: 8px 14px; color: var(--jv-muted); font-size: 13px }

.jv-view { padding: 10px 20px 0 }
.jv-tree { padding: 4px 0 8px; font: 13.5px/22px ${MONO}; color: var(--jv-text) }
.jv-item { outline: none }
.jv-row { position: relative; display: flex; align-items: flex-start; gap: 2px; min-height: 30px; padding: 4px 8px 4px 2px; border-radius: 8px; scroll-margin-top: var(--jv-sm); scroll-margin-bottom: 24px }
.jv-branch > .jv-row { cursor: pointer }
.jv-row:hover { background: var(--jv-soft) }
.jv-item:focus > .jv-row { background: var(--jv-accent-soft) }
.jv-item:focus-visible > .jv-row { box-shadow: inset 0 0 0 2px #7fa6ee }
.jv-tog { flex: 0 0 22px; height: 22px; display: grid; place-items: center; color: #8a93a3; border-radius: 6px }
.jv-tog .jv-i { transition: transform .12s }
.jv-item[aria-expanded="true"] > .jv-row > .jv-tog .jv-i { transform: rotate(90deg) }
.jv-row:hover > .jv-tog { color: #3a4357 }
.jv-line { flex: 1 1 auto; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere }
.jv-key { color: var(--jv-key); font-weight: 550 }
.jv-key.jv-ld { color: #7a2fb8 }
.jv-idx { color: #8f97a7 }
.jv-colon { color: #a3aab7; margin-right: 8px }
.jv-range { color: #5f687a; font-weight: 550 }
.jv-string { color: var(--jv-str) }
.jv-number { color: var(--jv-num) }
.jv-boolean { color: var(--jv-bool); font-weight: 550 }
.jv-null { color: var(--jv-null); font-style: italic }
.jv-empty { color: #8f97a7 }
.jv-errrow > .jv-row, .jv-errrow > .jv-row:hover { background: #fef5f5; box-shadow: inset 3px 0 0 #d64545 }
.jv-lerr-msg { color: #a3262a; font-weight: 600 }
.jv-lerr-text { display: block; margin-top: 2px; color: #6b5560; white-space: pre-wrap; overflow-wrap: anywhere }
.jv-table td.jv-errcell { white-space: normal; background: #fef5f5; box-shadow: inset 3px 0 0 #d64545 }
.jv-table td.jv-errcell .jv-lerr { position: sticky; left: 12px; display: block; width: max-content; max-width: min(860px, calc(100vw - 110px)) } /* stays in view when the table scrolls sideways */
.jv-link { color: var(--jv-accent-ink); text-decoration: underline; text-decoration-color: rgba(31, 85, 184, .35); text-underline-offset: 2px }
.jv-link:hover { text-decoration-color: currentColor }
.jv-count-chip { display: inline-block; margin-left: 2px; padding: 0 8px; border-radius: 999px; background: #f0f2f6; color: #5f687a; font: 600 11.5px/20px ${SANS}; white-space: nowrap; vertical-align: 1px; font-variant-numeric: tabular-nums }
.jv-prev { margin-left: 8px; color: #9aa1af }
.jv-item[aria-expanded="true"] > .jv-row .jv-prev { display: none }
.jv-chip { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; padding: 0 8px; border-radius: 999px; background: #f0f2f6; color: #5f687a; font: 600 11.5px/20px ${SANS}; white-space: nowrap; vertical-align: 1px }
.jv-chip .jv-i { width: 12px; height: 12px }
.jv-chip.jv-date { background: #ebf3ff; color: #2a5bb0 }
.jv-chip.jv-hint { background: transparent; color: #8f97a7; box-shadow: inset 0 0 0 1px #e1e4ea }
.jv-chip.jv-big { background: #fdf0e6; color: #9a4609; text-transform: uppercase; letter-spacing: .04em; font-size: 10.5px; cursor: help }
.jv-swatch { display: inline-block; width: 14px; height: 14px; margin: 0 6px 0 2px; border-radius: 4px; vertical-align: -2px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .18) }
.jv-badge { display: inline-block; margin: 0 4px 0 2px; padding: 0 9px; border-radius: 7px; background: #f1eafd; color: #6633b0; font: 650 12px/21px ${SANS}; vertical-align: 1px; white-space: nowrap }
.jv-row .jv-badge + .jv-count-chip { margin-left: 4px }
.jv-thumb { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 22px; margin-left: 6px; border: 1px solid #d8dce5; border-radius: 6px; background: #fff; color: #5f687a; cursor: pointer; vertical-align: -5px; padding: 0 }
.jv-thumb:hover, .jv-thumb[aria-expanded="true"] { background: var(--jv-accent-soft); border-color: #a9c2f2; color: var(--jv-accent-ink) }
.jv-ithumb { display: block; max-width: min(260px, 100%); max-height: 180px; margin: 8px 0 4px; border-radius: 8px; border: 1px solid var(--jv-line); background: #fafbfc }
.jv-pop { position: fixed; z-index: 30; padding: 6px; border: 1px solid var(--jv-line); border-radius: 12px; background: #fff; box-shadow: 0 12px 32px rgba(20, 30, 60, .16); pointer-events: none }
.jv-pop img { display: block; max-width: 220px; max-height: 170px; border-radius: 7px; background: #fafbfc }
.jv-more { margin-left: 6px; padding: 0 8px; height: 22px; border: 1px solid #d8dce5; border-radius: 6px; background: #fff; color: var(--jv-accent-ink); font: 600 12px/20px ${SANS}; cursor: pointer; vertical-align: 1px }
.jv-more:hover { background: var(--jv-accent-soft) }
.jv-group { margin-left: 12px; padding-left: 10px; border-left: 1px solid #e7eaf0 }
.jv-item:hover > .jv-group { border-left-color: #d3d8e1 }
.jv-acts { position: absolute; top: 3px; right: 4px; display: none; gap: 4px; padding-left: 22px; background: linear-gradient(to right, rgba(245, 247, 250, 0), var(--jv-soft) 20px) }
.jv-item:focus > .jv-row > .jv-acts { background: linear-gradient(to right, rgba(234, 241, 253, 0), var(--jv-accent-soft) 20px) }
.jv-row:hover > .jv-acts, .jv-item:focus > .jv-row > .jv-acts, .jv-acts:focus-within { display: flex }
.jv-act { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 1px solid #d3d8e1; border-radius: 7px; background: #fff; color: #4a5366; font: 600 12px ${SANS}; cursor: pointer; white-space: nowrap }
.jv-act:hover { color: var(--jv-accent-ink); border-color: #a9c2f2 }
.jv-act[aria-pressed="true"] { background: var(--jv-accent-soft); color: var(--jv-accent-ink); border-color: #a9c2f2 }
.jv-act .jv-i { width: 14px; height: 14px }
mark.jv-mark { background: var(--jv-hit); color: inherit; border-radius: 3px; box-shadow: 0 0 0 1px #efd767 }
.jv-current > .jv-row { background: #fff8d6 !important; box-shadow: inset 3px 0 0 #e0a800 }
.jv-current > .jv-row mark.jv-mark { background: var(--jv-cur) }
.jv-note { padding: 18px 4px; color: var(--jv-muted) }
.jv-inline-table { margin: 4px 0 10px 24px }

.jv-ref.jv-local, .jv-ref.jv-self { color: #6633b0; text-decoration-color: rgba(102, 51, 176, .4) }
.jv-ref[role="link"] { cursor: pointer }
.jv-idtext { color: #4a5366 }
.jv-chip.jv-def { background: #f1eafd; color: #6633b0 }
.jv .jv-refs, .jv .jv-peek, .jv .jv-pclose { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; padding: 0 8px; height: 22px; border: 1px solid #d9c8f5; border-radius: 6px;
  background: #fff; color: #6633b0; font: 600 12px/20px ${SANS}; cursor: pointer; vertical-align: 1px; white-space: nowrap }
.jv-refs .jv-i, .jv-peek .jv-i, .jv-pclose .jv-i { width: 13px; height: 13px }
.jv-refs:hover, .jv-peek[aria-expanded="true"] { background: #f1eafd }
.jv .jv-peek, .jv .jv-pclose { border-color: #d8dce5; color: var(--jv-accent-ink) }
.jv-peek:hover, .jv-pclose:hover { background: var(--jv-accent-soft) }
.jv .jv-peek[aria-expanded="true"] { border-color: #d9c8f5; color: #6633b0 }
.jv-refprev { margin-left: 8px; color: #9aa1af }
.jv-item[aria-expanded="true"] > .jv-row .jv-refprev { display: none }
.jv-flash > .jv-row { animation: jv-flash 1.8s ease-out; box-shadow: inset 3px 0 0 #8a56d8 }
@keyframes jv-flash { 0%, 40% { background: #e2d3fb } 100% { background: rgba(226, 211, 251, 0) } }
.jv-peekbox { margin: 2px 0 8px 24px; border: 1px solid #e1d6f6; border-left: 3px solid #b79aec; border-radius: 10px; background: #fff; overflow: hidden; cursor: default }
.jv-peekhead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 5px 6px 5px 12px; background: #faf7ff; border-bottom: 1px solid #ece4fa; font: 12.5px/1.4 ${SANS}; color: #5f687a }
.jv-peeksrc { min-width: 0; font-weight: 600; overflow-wrap: anywhere }
.jv-peekwhat { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere }
.jv .jv-pclose { margin-left: 0; height: 28px; padding: 0 10px }
.jv-peekbody { padding: 4px 8px }
.jv-peekbody > .jv-tree { padding: 0 }
.jv-peekmsg { padding: 6px 4px; color: var(--jv-muted); font: 13px/1.5 ${SANS}; overflow-wrap: anywhere }
.jv-peekbad .jv-peekmsg { color: #a3262a }
.jv-tip { position: fixed; z-index: 35; max-width: min(520px, calc(100vw - 16px)); padding: 5px 9px; border-radius: 8px; background: #1d2433; color: #fff; font: 12px/1.4 ${MONO}; overflow-wrap: anywhere;
  pointer-events: none; box-shadow: 0 8px 24px rgba(20, 30, 60, .22) }
@media (prefers-reduced-motion: reduce) { .jv-flash > .jv-row { animation: none; background: #efe6fd } }

.jv-results { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 8px }
.jv-rhead { color: var(--jv-muted); font-size: 13.5px; padding: 2px 2px 0 }
.jv-rhead.jv-bad { color: #a3262a }
.jv-res { border: 1px solid var(--jv-line); border-radius: 12px; overflow: hidden }
.jv-res-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 8px 6px 14px; background: var(--jv-panel); border-bottom: 1px solid var(--jv-line) }
.jv-res-top code { flex: 1 1 200px; min-width: 0; font: 13px/1.4 ${MONO}; color: #2b3446; overflow-wrap: anywhere }
.jv-res-top .jv-btn { height: 36px; font-size: 13px; padding: 0 11px }
.jv-res-body { padding: 6px 10px; font: 13.5px/22px ${MONO} }
.jv-res-body > .jv-tree { padding: 0 }

.jv-tablehead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 10px }
.jv-tablehead label { font-weight: 600; color: #3a4357; font-size: 13.5px }
.jv-select { min-width: 0; max-width: 100%; height: 44px; padding: 0 12px; border: 1px solid #d8dce5; border-radius: 11px; background: #fff; font: 13.5px ${MONO}; color: var(--jv-text) }
.jv-tablebox { border: 1px solid var(--jv-line); border-radius: 12px; overflow: hidden; background: #fff }
.jv-tscroll { overflow: auto; max-height: 70vh; overscroll-behavior: contain }
.jv-table { border-collapse: separate; border-spacing: 0; min-width: 100%; font: 13px/1.5 ${MONO} }
.jv-table th { position: sticky; top: 0; z-index: 1; padding: 0; background: var(--jv-panel); border-bottom: 1px solid var(--jv-line); text-align: left; white-space: nowrap }
.jv-table th + th, .jv-table td + td { border-left: 1px solid #eef0f4 }
.jv-sort { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; background: none; font: 650 12.5px ${SANS}; color: #2b3446; cursor: pointer; text-align: left }
.jv-sort:hover { background: #eef1f6 }
.jv-sort .jv-i { color: #a3aab7 }
.jv-sort[data-dir] .jv-i { color: var(--jv-accent) }
.jv-table td { padding: 7px 12px; border-bottom: 1px solid #f0f2f5; vertical-align: top; white-space: nowrap }
.jv-table td.jv-wrap { white-space: normal; min-width: 260px; max-width: 420px; overflow-wrap: anywhere }
.jv-table tr:last-child td { border-bottom: 0 }
.jv-table tbody tr:hover td { background: #fafbfd }
.jv-table td.jv-rowno { color: #a3aab7; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums }
.jv-table td.jv-missing { color: #c3c8d1 }
.jv-table .jv-chip { margin-left: 6px }
.jv-nest { padding: 0 8px; height: 26px; border: 1px solid #d8dce5; border-radius: 7px; background: #fff; color: var(--jv-accent-ink); font: 600 12px ${SANS}; cursor: pointer; white-space: nowrap }
.jv-nest:hover { background: var(--jv-accent-soft) }
.jv-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; border-top: 1px solid var(--jv-line); background: var(--jv-panel) }
.jv-pinfo { flex: 1 1 auto; color: var(--jv-muted); font-size: 13px; font-variant-numeric: tabular-nums }

.jv-rawhead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 10px }
.jv-rawhead .jv-tabs { padding: 3px }
.jv-rawhead .jv-tab { height: 38px; min-width: 0 }
.jv-rawinfo { color: var(--jv-muted); font-size: 13px; font-variant-numeric: tabular-nums }
.jv-raw { padding: 10px 0; border: 1px solid var(--jv-line); border-radius: 12px; background: #fbfcfd; font: 13px/1.6 ${MONO}; color: #2b3446 }
.jv-ln { display: flex }
.jv-ln:hover { background: #f3f5f8 }
.jv-no { flex: 0 0 auto; box-sizing: content-box !important; width: var(--jv-nw, 4ch); padding: 0 14px 0 12px; text-align: right; color: #b3b9c4; user-select: none; -webkit-user-select: none; font-variant-numeric: tabular-nums }
.jv-code { flex: 1 1 auto; min-width: 0; padding-right: 14px; white-space: pre-wrap; overflow-wrap: anywhere }
.jv-code .k { color: var(--jv-key) } .jv-code .s { color: var(--jv-str) } .jv-code .n { color: var(--jv-num) } .jv-code .b { color: var(--jv-bool) } .jv-code .z { color: var(--jv-null) } .jv-code .p { color: #9aa1af }
.jv-rawmore { margin: 10px 0 0 }

.jv-card { margin: 20px; padding: 20px 22px; border: 1px solid var(--jv-line); border-radius: 14px; background: #fff }
.jv-card.jv-err { border-color: #f0cccc; border-left: 4px solid #d64545 }
.jv-card h3 { margin: 0 0 6px; font-size: 17px; color: #14192a }
.jv-card.jv-err h3 { color: #9f1f1f }
.jv-card p { margin: 6px 0 12px; color: #3f4859; overflow-wrap: anywhere }
.jv-loc { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 999px; background: #fdecec; color: #9f1f1f; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums }
.jv-snip { margin: 12px 0 14px; padding: 8px 0; border: 1px solid var(--jv-line); border-radius: 10px; background: #fbfcfd; font: 13px/1.6 ${MONO}; overflow-x: auto }
.jv-snip .jv-code { white-space: pre; overflow-wrap: normal }
.jv-ln.jv-errline, .jv-ln.jv-errline:hover { background: #fdecec }
.jv-ln.jv-errline .jv-no { color: #c24a4a; font-weight: 700 }
.jv-caret { color: #d64545; font-weight: 700 }
.jv-loading { display: flex; align-items: center; gap: 12px; color: var(--jv-muted) }
.jv-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid #d8e2f5; border-top-color: var(--jv-accent); animation: jv-spin .8s linear infinite }
@keyframes jv-spin { to { transform: rotate(360deg) } }
.jv-toast { position: fixed; left: 50%; bottom: 24px; z-index: 40; transform: translate(-50%, 12px); padding: 10px 16px; border-radius: 12px; background: #1d2433; color: #fff; font: 600 14px ${SANS}; box-shadow: 0 10px 30px rgba(20, 30, 60, .25); opacity: 0; transition: opacity .15s, transform .15s; pointer-events: none; max-width: calc(100vw - 32px) }
.jv-toast.jv-on { opacity: 1; transform: translate(-50%, 0) }

@media (max-width: 600px) {
  .jv-head { padding: 14px 14px 12px }
  .jv-name { font-size: 17px }
  .jv-bar { padding: 8px 12px; gap: 6px }
  .jv-barrow { gap: 6px }
  .jv-btn.jv-narrow-sq { padding: 0; width: 44px }
  .jv-btn.jv-narrow-sq .jv-txt { display: none }
  .jv-tab { min-width: 0; padding: 0 12px }
  .jv-tools { gap: 6px }
  .jv-levlab { padding: 0 2px 0 9px; font-size: 12px }
  .jv-schema { margin: 10px 12px 0 }
  .jv-view { padding: 8px 12px 0 }
  .jv-group { margin-left: 10px; padding-left: 6px }
  .jv-tree, .jv-res-body { font-size: 13px }
  .jv-inline-table, .jv-peekbox { margin-left: 8px }
  .jv-row:has(.jv-ref, .jv-peek) > .jv-acts { display: none !important } /* the row's link comes first; Copy is in the bar above */
  .jv-card { margin: 14px 12px; padding: 16px }
  .jv-no { padding: 0 10px 0 8px }
}
@media (pointer: coarse) {
  .jv-row { min-height: 44px; padding-top: 11px; padding-bottom: 11px }
  .jv-acts { top: 6px }
  .jv-act { height: 32px }
  .jv-thumb, .jv-more { height: 30px; min-width: 34px }
  .jv .jv-refs, .jv .jv-peek, .jv .jv-pclose { height: 30px }
  .jv-refs::after, .jv-peek::after, .jv-pclose::after { content: ''; position: absolute; inset: -8px -3px } /* a 46 px touch target */
}
`

// ---------------------------------------------------------------------------------------------
// Small helpers

function el (doc, tag, cls, text) {
  const e = doc.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

const SVGNS = 'http://www.w3.org/2000/svg'
const PATHS = {
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.6-4.6',
  chevron: 'M9 5.5l6.5 6.5L9 18.5',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  expand: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  collapse: 'M12 3v6M12 15v6M8 5l4 4 4-4M8 19l4-4 4 4M5 12h14',
  copy: 'M9 9h10v11H9zM15 9V4H5v11h4',
  path: 'M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16',
  filter: 'M4 5h16l-6.2 7.2V18l-3.6 2v-7.8z',
  table: 'M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 4 4L16 12l4 4M15 8.5h.01',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.2l2.8 1.8',
  sort: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  asc: 'M8 14l4-4 4 4',
  desc: 'M8 10l4 4 4-4',
  tree: 'M5 5h5M5 5v14M5 12h6M5 19h6M13 5h6M14 12h6M14 19h6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  forward: 'M5 12h14M13 6l6 6-6 6',
  target: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  link: 'M9 15l6-6M10.5 6.5l1.2-1.2a4 4 0 0 1 5.7 5.7l-1.2 1.2M13.5 17.5l-1.2 1.2a4 4 0 0 1-5.7-5.7l1.2-1.2',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'
}
function icon (doc, name, size) {
  const s = doc.createElementNS(SVGNS, 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('width', String(size || 16))
  s.setAttribute('height', String(size || 16))
  s.setAttribute('fill', 'none')
  s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '2')
  s.setAttribute('stroke-linecap', 'round')
  s.setAttribute('stroke-linejoin', 'round')
  s.setAttribute('aria-hidden', 'true')
  s.setAttribute('class', 'jv-i')
  const p = doc.createElementNS(SVGNS, 'path')
  p.setAttribute('d', PATHS[name])
  s.appendChild(p)
  return s
}

function button (doc, cls, iconName, text, title, onClick) {
  const b = el(doc, 'button', cls)
  b.type = 'button'
  if (iconName) b.appendChild(icon(doc, iconName, cls.includes('jv-act') ? 14 : 18))
  if (text) b.appendChild(el(doc, 'span', 'jv-txt', text))
  if (title) { b.title = title; if (!text) b.setAttribute('aria-label', title) }
  if (onClick) b.addEventListener('click', onClick)
  return b
}

// The pane's own icon, drawn as inline SVG (a data: image can be blocked by a page's CSP)
function logoSvg (doc, size) {
  const s = doc.createElementNS(SVGNS, 'svg')
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', String(size)], ['height', String(size)], ['fill', 'none'], ['stroke', '#2f6fde'],
    ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['class', 'jv-logo']]) s.setAttribute(k, v)
  const p = doc.createElementNS(SVGNS, 'path')
  p.setAttribute('d', 'M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1')
  const c = doc.createElementNS(SVGNS, 'circle')
  for (const [k, v] of [['cx', '12'], ['cy', '12'], ['r', '1.2'], ['fill', '#2f6fde']]) c.setAttribute(k, v)
  s.append(p, c)
  return s
}

// A number whose source text a JavaScript number cannot hold exactly. It behaves as a number
// (typeOf says 'number', arithmetic uses the nearest double) and prints as its source.
class Atom {}
class BigNum extends Atom {
  constructor (src, num) { super(); this.src = src; this.num = num }
  toString () { return this.src }
  valueOf () { return this.num }
  toJSON () { return HAS_RAW_JSON ? JSON.rawJSON(this.src) : BIG_MARK + this.src }
}
BigNum.prototype.kind = 'number'
// A line of a JSON Lines file that does not parse: it stays in its place among the records
class LineError extends Atom {
  constructor (line, message, text, col) { super(); this.line = line; this.message = message; this.text = text; this.col = col }
  toString () { return 'line ' + this.line + ': ' + this.message + ' ' + this.text }
  toJSON () { return { error: this.message, line: this.line, text: this.text } }
}
LineError.prototype.kind = 'error'
const isBig = v => v instanceof BigNum
const isErr = v => v instanceof LineError
const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : v instanceof Atom ? v.kind : typeof v
const isBranch = v => v !== null && typeof v === 'object' && !(v instanceof Atom)
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Atom)
const fmt = n => n.toLocaleString('en')
const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many)
function countLabel (v, n) {
  if (n === 0) return 'empty'
  return Array.isArray(v) ? plural(n, 'item', 'items') : plural(n, 'key', 'keys')
}
function humanBytes (n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
function humanMs (ms) { return ms < 0.1 ? '<0.1 ms' : ms < 10 ? ms.toFixed(1) + ' ms' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s' }

// JSONPath of a node, from its keys: $.panes[0].name, $['@graph'][1]
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const segCache = new Map()
function seg (k) {
  if (typeof k === 'number') return '[' + k + ']'
  let s = segCache.get(k)
  if (s === undefined) {
    s = IDENT.test(k) ? '.' + k : "['" + k.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']"
    if (segCache.size < 50000) segCache.set(k, s)
  }
  return s
}
function pathOf (segs) { let s = '$'; for (const k of segs) s += seg(k); return s }
const pkey = segs => segs.join('\u0001') // a cheap map key for a path

async function copyText (doc, text) {
  try { await navigator.clipboard.writeText(text); return true } catch (e) {}
  try {
    const ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
    doc.body.appendChild(ta)
    ta.select()
    const ok = doc.execCommand('copy')
    ta.remove()
    return ok
  } catch (e) { return false }
}

// ---------------------------------------------------------------------------------------------
// Parsing, and finding where a parse failed

// Browsers do not all say where JSON.parse failed, so a small scanner finds the place and says
// what was expected there. It only runs when the parse has already failed.
function locateError (text) {
  const n = text.length
  let i = 0
  const fail = (msg, at) => { throw { pos: Math.min(at == null ? i : at, n), msg } } // eslint-disable-line no-throw-literal
  const show = c => c ? (c === '\n' ? 'a line break' : `'${c}'`) : 'the end of the file'
  const ws = () => { for (; i < n; i++) { const c = text.charCodeAt(i); if (c !== 32 && c !== 10 && c !== 13 && c !== 9) break } }
  const ch = () => (i < n ? text[i] : '')
  function str () {
    i++
    for (;;) {
      if (i >= n) fail('Unterminated string: the closing " is missing')
      const c = text.charCodeAt(i)
      if (c === 34) { i++; return }
      if (c === 92) {
        const e = text[i + 1]
        if (e === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.substr(i + 2, 4))) fail('Bad \\u escape in a string'); i += 6 } else if (e && '"\\/bfnrt'.includes(e)) i += 2
        else fail('Bad escape \\' + (e || '') + ' in a string')
      } else if (c < 32) fail('Unescaped control character in a string (a raw line break or tab?)')
      else i++
    }
  }
  function num () {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 512))
    if (!m) fail('Bad number')
    i += m[0].length
  }
  function lit (word) {
    if (text.startsWith(word, i)) i += word.length
    else fail(`Unexpected ${show(ch())}: did you mean ${word}?`)
  }
  function value () {
    ws()
    const c = ch()
    if (c === '{') return obj()
    if (c === '[') return arr()
    if (c === '"') return str()
    if (c === '-' || (c >= '0' && c <= '9')) return num()
    if (c === 't') return lit('true')
    if (c === 'f') return lit('false')
    if (c === 'n') return lit('null')
    if (c === "'") fail('Strings need double quotes, not single quotes')
    fail(c ? `Unexpected ${show(c)}, expected a value` : 'Unexpected end of the file, expected a value')
  }
  function obj () {
    i++; ws()
    if (ch() === '}') { i++; return }
    for (;;) {
      ws()
      const c = ch()
      if (c !== '"') {
        if (c === '}') fail("Trailing comma before '}'")
        fail(c ? `Expected a property name in double quotes, found ${show(c)}` : 'Unexpected end of the file inside an object')
      }
      str(); ws()
      if (ch() !== ':') fail(`Expected ':' after the property name, found ${show(ch())}`)
      i++
      value(); ws()
      if (ch() === ',') { i++; continue }
      if (ch() === '}') { i++; return }
      fail(`Expected ',' or '}' after a property value, found ${show(ch())}`)
    }
  }
  function arr () {
    i++; ws()
    if (ch() === ']') { i++; return }
    for (;;) {
      ws()
      if (ch() === ']') fail("Trailing comma before ']'")
      value(); ws()
      if (ch() === ',') { i++; continue }
      if (ch() === ']') { i++; return }
      fail(`Expected ',' or ']' after an array item, found ${show(ch())}`)
    }
  }
  try {
    value(); ws()
    if (i < n) fail(`Unexpected ${show(ch())} after the end of the JSON value`)
  } catch (e) {
    if (e && typeof e.pos === 'number') return e
    return null // too deep for the scanner (a stack overflow): fall back to the browser's message
  }
  return null
}

function lineCol (text, pos) {
  let line = 1
  let last = -1
  for (let j = text.indexOf('\n'); j !== -1 && j < pos; j = text.indexOf('\n', j + 1)) { line++; last = j }
  return { line, col: pos - last }
}

// Exact big numbers. A number literal is "big" when the nearest double does not print back as the
// same decimal (integers beyond 2^53, more than ~15 significant digits, or out of range like 1e400).
// Only files with a run of 16+ digits/dots or a 3-digit exponent can hold one, so the common case
// costs one regex test. Where JSON.parse gives the reviver the literal's source text (Chrome 114+,
// Firefox 135+) that is used; otherwise big literals are rewritten as marked strings and parsed again.
const HAS_SOURCE = (() => { try { return JSON.parse('[1]', (k, v, c) => k === '0' ? !!c && c.source === '1' : v)[0] === true } catch (e) { return false } })()
const HAS_RAW_JSON = (() => { try { return typeof JSON.rawJSON === 'function' && JSON.stringify([JSON.rawJSON('1')]) === '[1]' } catch (e) { return false } })()
const BIG_MARK = '\u0000big:'
const RE_MAYBE_BIG = /\d[\d.]{15}|[eE][+-]?\d{3}/
function canonNumber (s) { // digits and exponent: "-1.50e3" and "-1500" give the same
  let neg = false
  if (s[0] === '-') { neg = true; s = s.slice(1) }
  let e = 0
  const ei = s.search(/[eE]/)
  if (ei >= 0) { e = +s.slice(ei + 1); s = s.slice(0, ei) }
  const dot = s.indexOf('.')
  if (dot >= 0) { e -= s.length - dot - 1; s = s.slice(0, dot) + s.slice(dot + 1) }
  s = s.replace(/^0+/, '')
  if (!s) return '0'
  const z = /0+$/.exec(s)
  if (z) { e += z[0].length; s = s.slice(0, -z[0].length) }
  return (neg ? '-' : '') + s + 'e' + e
}
function isLossy (src, n) {
  if (src.length < 16 && !/[eE]/.test(src)) return false // 15 significant digits always survive
  if (!isFinite(n)) return true
  return canonNumber(src) !== canonNumber(String(n))
}
function parseExact (text) {
  if (!RE_MAYBE_BIG.test(text)) return { data: JSON.parse(text), bigs: 0 }
  let bigs = 0
  if (HAS_SOURCE) {
    const data = JSON.parse(text, (k, v, c) => {
      if (typeof v === 'number' && c && typeof c.source === 'string' && isLossy(c.source, v)) { bigs++; return new BigNum(c.source, v) }
      return v
    })
    return { data, bigs }
  }
  const data = JSON.parse(text) // throws on bad JSON before the rewrite below can be confused by it
  const TOK = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  let out = ''
  let last = 0
  let m
  while ((m = TOK.exec(text))) {
    const s = m[0]
    if (s.charCodeAt(0) === 34 || !isLossy(s, Number(s))) continue
    out += text.slice(last, m.index) + '"\\u0000big:' + s + '"'
    last = m.index + s.length
    bigs++
  }
  if (!bigs) return { data, bigs }
  out += text.slice(last)
  const exact = JSON.parse(out, (k, v) => typeof v === 'string' && v.charCodeAt(0) === 0 && v.startsWith(BIG_MARK) ? new BigNum(v.slice(BIG_MARK.length), Number(v.slice(BIG_MARK.length))) : v)
  return { data: exact, bigs }
}
// JSON text of a value, big numbers exact
function stringify (v, indent) {
  if (isBig(v)) return v.src
  const s = JSON.stringify(v, null, indent)
  return HAS_RAW_JSON || s.indexOf('\\u0000big:') < 0 ? s : s.replace(/"\\u0000big:([^"]*)"/g, '$1')
}

function parseJSON (text) {
  const t0 = performance.now()
  if (!text.trim()) return { error: { message: 'The file is empty.', pos: null }, ms: 0 }
  try {
    const { data, bigs } = parseExact(text)
    return { data, bigs, ms: performance.now() - t0 }
  } catch (e) {
    const ms = performance.now() - t0
    let loc = locateError(text)
    if (!loc) {
      const m = /position (\d+)/.exec(String(e.message))
      if (m) loc = { pos: +m[1], msg: String(e.message) }
    }
    const error = { message: loc ? loc.msg : String(e.message), browser: String(e.message), pos: loc ? loc.pos : null }
    if (error.pos != null) Object.assign(error, lineCol(text, error.pos))
    return { error, ms }
  }
}

// JSON Lines (NDJSON): one JSON value a line. The file becomes an array of records; blank lines
// are skipped, and a line that does not parse becomes a LineError in its place. With sniff (a
// file that was not announced as JSON Lines and failed as JSON), it only counts when the first
// line is a whole object or array and at least two lines, and half of them, parse.
const RE_NONBLANK = /\S/
function parseLines (text, sniff) {
  const t0 = performance.now()
  const maybeBig = RE_MAYBE_BIG.test(text)
  const n = text.length
  const data = []
  const lineNos = [] // the line each record came from, from 1
  let errors = 0
  let bigs = 0
  let line = 0
  let pos = 0
  for (;;) {
    let end = text.indexOf('\n', pos)
    if (end === -1) end = n
    line++
    let s = text.slice(pos, end)
    pos = end + 1
    if (s.charCodeAt(0) === 0x1e) s = s.slice(1) // application/json-seq: a record separator before each record
    if (RE_NONBLANK.test(s)) {
      if (sniff && !data.length) { const c = s.trimStart()[0]; if (c !== '{' && c !== '[') return null }
      try {
        if (maybeBig) { const r = parseExact(s); bigs += r.bigs; data.push(r.data) } else data.push(JSON.parse(s))
      } catch (e) {
        if (sniff && !data.length) return null
        errors++
        if (s.endsWith('\r')) s = s.slice(0, -1)
        const loc = s.length < 200000 ? locateError(s) : null
        data.push(new LineError(line, (loc ? loc.msg : String(e.message)).replace(/of the file/g, 'of the line'), s, loc ? loc.pos + 1 : null))
      }
      lineNos.push(line)
    }
    if (end === n) break
  }
  if (sniff && (data.length - errors < 2 || errors * 2 > data.length)) return null
  if (!data.length) return { error: { message: 'The file is empty.', pos: null }, ms: 0 }
  return { data, bigs, ms: performance.now() - t0, lines: { count: data.length, errors, lineNos, total: line } }
}

// ---------------------------------------------------------------------------------------------
// Smart previews: what a string or a number looks like

const RE_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const RE_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RE_COLOR_FN = /^(?:rgba?|hsla?)\(\s*-?[\d.]+(?:deg|%)?\s*(?:,\s*|\s+)[\d.]+%?\s*(?:,\s*|\s+)[\d.]+%?\s*(?:(?:,|\/)\s*[\d.]+%?\s*)?\)$/i
const RE_EMAIL = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}$/i
const RE_URL = /^https?:\/\/[^\s"<>]+$/i
const RE_IMG = /\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#][^\s]*)?$/i
const RE_RELIMG = /^(?:\.{1,2}\/)*[\w\-.~%]+(?:\/[\w\-.~%]+)*\.(?:png|jpe?g|gif|webp|svg|avif)$/i
const RE_ID_KEY = /(?:^|_|-)id$|Id$|^id|phone|tel|zip|postal|code|count|size|bytes|length|port|version/i

function classify (s, base) {
  if (s.length > 2048 || s.length < 3) return null
  const c = s.charCodeAt(0)
  if (c >= 48 && c <= 57 && RE_DATE.test(s)) {
    const d = new Date(s.length === 10 ? s + 'T00:00:00Z' : s.replace(' ', 'T'))
    if (!isNaN(d)) return { kind: 'date', date: d, dateOnly: s.length === 10 }
  }
  if ((c === 35 && RE_HEX.test(s)) || ((c === 114 || c === 82 || c === 104 || c === 72) && RE_COLOR_FN.test(s))) return { kind: 'color' }
  if (RE_URL.test(s)) {
    let href
    try { href = new URL(s).href } catch (e) { return null }
    return { kind: 'url', href, image: RE_IMG.test(s) }
  }
  if (RE_RELIMG.test(s) && base) {
    try { return { kind: 'url', href: new URL(s, base).href, image: true, relative: true } } catch (e) { return null }
  }
  if (s.includes('@') && RE_EMAIL.test(s)) return { kind: 'email' }
  return null
}

function unixGuess (n, key) {
  if (!Number.isInteger(n) || (typeof key === 'string' && RE_ID_KEY.test(key))) return null
  if (n >= 1e9 && n <= 4.1e9) return { date: new Date(n * 1000), unit: 'seconds' }
  if (n >= 1e12 && n <= 4.1e12) return { date: new Date(n), unit: 'milliseconds' }
  return null
}

const DATE_FMT = { day: 'numeric', month: 'short', year: 'numeric' }
const TIME_FMT = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
function humanDate (d, dateOnly) {
  try { return dateOnly ? d.toLocaleDateString('en-GB', { ...DATE_FMT, timeZone: 'UTC' }) : d.toLocaleString('en-GB', TIME_FMT) } catch (e) { return d.toISOString() }
}
function relative (d) {
  const s = (d.getTime() - Date.now()) / 1000
  const a = Math.abs(s)
  const units = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [86400 * 30, 'day', 86400], [86400 * 365, 'month', 86400 * 30], [Infinity, 'year', 86400 * 365]]
  for (const [lim, unit, div] of units) {
    if (a < lim) {
      try { return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(s / div), unit) } catch (e) { return '' }
    }
  }
  return ''
}

// ---------------------------------------------------------------------------------------------
// Search, JSONPath and schema: plain walks over the parsed data

function searchData (root, term, cap) {
  const t = term.toLowerCase()
  const hits = []
  const segs = []
  let total = 0
  const has = s => s.toLowerCase().includes(t)
  const visit = (v, key) => {
    let where = 0
    if (typeof key === 'string' && has(key)) where |= 1
    if (v === null) { if ('null'.includes(t)) where |= 2 } else if (typeof v === 'string') { if (has(v)) where |= 2 } else if (!isBranch(v)) { if (String(v).toLowerCase().includes(t)) where |= 2 }
    if (where && segs.length) { total++; if (hits.length < cap) hits.push({ segs: segs.slice(), where }) }
    if (isBranch(v)) {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) { segs.push(i); visit(v[i], i); segs.pop() }
      } else {
        for (const k in v) { segs.push(k); visit(v[k], k); segs.pop() }
      }
    }
  }
  visit(root, undefined)
  return { hits, total }
}

// For the filter: which children of each node lead to a match, and which matched nodes show
// their whole subtree (a key that matched on an object or array).
function matchIndex (hits, root) {
  const anc = new Map()
  const full = new Set()
  for (const h of hits) {
    let k = ''
    for (let j = 0; j < h.segs.length; j++) {
      let set = anc.get(k)
      if (!set) { set = new Set(); anc.set(k, set) }
      set.add(h.segs[j])
      k = j === 0 ? String(h.segs[0]) : k + '\u0001' + h.segs[j]
    }
    if (h.where & 1) {
      let v = root
      for (const s of h.segs) v = v[s]
      if (isBranch(v)) full.add(pkey(h.segs))
    }
  }
  return { anc, full }
}

// A small JSONPath: $, .name, ['name'], ["a","b"], [0], [-1], [*], .*, [1:3], and .. before any of them.
function compilePath (src) {
  const s = src.trim()
  if (s[0] !== '$') throw new Error('A path starts with $')
  const steps = []
  let i = 1
  while (i < s.length) {
    let desc = false
    if (s.startsWith('..', i)) { desc = true; i += 2 } else if (s[i] === '.') i++
    else if (s[i] !== '[') throw new Error(`Unexpected '${s[i]}' at character ${i + 1}`)
    if (i >= s.length) throw new Error('The path ends after a dot')
    if (s[i] === '[') {
      let j = i + 1
      let q = null
      for (; j < s.length; j++) {
        const c = s[j]
        if (q) { if (c === '\\') j++; else if (c === q) q = null } else if (c === '"' || c === "'") q = c
        else if (c === ']') break
      }
      if (j >= s.length) throw new Error(`Missing ']' for the '[' at character ${i + 1}`)
      steps.push({ desc, sel: bracket(s.slice(i + 1, j).trim(), i) })
      i = j + 1
    } else if (s[i] === '*') {
      i++
      steps.push({ desc, sel: { all: true } })
    } else {
      const m = /^[^.[\]\s]+/.exec(s.slice(i))
      if (!m) throw new Error(`Expected a name at character ${i + 1}`)
      i += m[0].length
      steps.push({ desc, sel: { items: [{ name: m[0] }] } })
    }
  }
  return steps
}
function bracket (inner, at) {
  if (inner === '*') return { all: true }
  const sl = /^(-?\d*)\s*:\s*(-?\d*)(?:\s*:\s*(-?\d+))?$/.exec(inner)
  if (sl) return { slice: [sl[1] === '' ? null : +sl[1], sl[2] === '' ? null : +sl[2], sl[3] ? +sl[3] : 1] }
  const items = []
  const re = /\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+))\s*(,|$)/y
  let m
  let last = 0
  while (last < inner.length && (m = re.exec(inner))) {
    if (m[3] != null) items.push({ index: +m[3] })
    else items.push({ name: (m[1] != null ? m[1] : m[2]).replace(/\\(.)/g, '$1') })
    last = re.lastIndex
    if (!m[4]) break
  }
  if (!items.length || last < inner.length) throw new Error(`Cannot read [${inner}] at character ${at + 1}`)
  return { items }
}
function runPath (root, steps, cap) {
  let cur = [{ v: root, p: [] }]
  let capped = false
  for (const st of steps) {
    const next = []
    let full = false // this step reached the cap
    const apply = (node) => {
      const v = node.v
      if (!isBranch(v)) return
      const sel = st.sel
      const push = (k) => { if (next.length < cap) next.push({ v: v[k], p: node.p.concat([k]) }); else full = true }
      if (sel.all) {
        if (Array.isArray(v)) for (let i = 0; i < v.length && !full; i++) push(i)
        else for (const k in v) { if (full) break; push(k) }
      } else if (sel.slice) {
        if (!Array.isArray(v)) return
        const len = v.length
        let [a, b, step] = sel.slice
        if (step <= 0) step = 1
        a = a == null ? 0 : a < 0 ? Math.max(0, len + a) : Math.min(a, len)
        b = b == null ? len : b < 0 ? Math.max(0, len + b) : Math.min(b, len)
        for (let i = a; i < b && !full; i += step) push(i)
      } else {
        for (const it of sel.items) {
          if (it.index != null) {
            if (!Array.isArray(v)) continue
            const i = it.index < 0 ? v.length + it.index : it.index
            if (i >= 0 && i < v.length) push(i)
          } else if (!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, it.name)) push(it.name)
        }
      }
    }
    const walk = (node) => {
      apply(node)
      const v = node.v
      if (!isBranch(v) || full) return
      if (Array.isArray(v)) { for (let i = 0; i < v.length && !full; i++) if (isBranch(v[i])) walk({ v: v[i], p: node.p.concat([i]) }) } else { for (const k in v) { if (full) break; if (isBranch(v[k])) walk({ v: v[k], p: node.p.concat([k]) }) } }
    }
    for (const node of cur) { if (st.desc) walk(node); else apply(node); if (full) break }
    if (full) capped = true
    cur = next
  }
  return { results: cur, capped }
}

function inferSchema (root) {
  const paths = new Map()
  let maxDepth = 0
  let keys = 0
  let values = 0
  const visit = (v, p, d) => {
    values++
    if (d > maxDepth) maxDepth = d
    const t = typeOf(v)
    let e = paths.get(p)
    if (!e) { e = { path: p, depth: d, types: {}, min: Infinity, max: -Infinity }; paths.set(p, e) }
    e.types[t] = (e.types[t] || 0) + 1
    if (t === 'array') {
      if (v.length < e.min) e.min = v.length
      if (v.length > e.max) e.max = v.length
      const cp = p + '[*]'
      for (let i = 0; i < v.length; i++) visit(v[i], cp, d + 1)
    } else if (t === 'object') {
      for (const k in v) { keys++; visit(v[k], p + seg(k), d + 1) }
    }
  }
  visit(root, '$', 0)
  return { paths: [...paths.values()], maxDepth, keys, values }
}

// Arrays worth a table: mostly objects. Looked for near the top of the document only.
function isTableable (v) {
  if (!Array.isArray(v) || !v.length) return false
  const n = Math.min(v.length, 50)
  let objs = 0
  for (let i = 0; i < n; i++) if (isPlainObject(v[i])) objs++
  return objs > 0 && objs * 2 >= n
}
function findTables (root) {
  const out = []
  const queue = [{ v: root, p: [], d: 0 }]
  let seen = 0
  while (queue.length && seen < 4000 && out.length < 40) {
    const { v, p, d } = queue.shift()
    seen++
    if (isTableable(v)) out.push({ segs: p, value: v })
    if (d >= 4 || !isBranch(v)) continue
    if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 3); i++) if (isBranch(v[i])) queue.push({ v: v[i], p: p.concat([i]), d: d + 1 }) } else for (const k in v) if (isBranch(v[k])) queue.push({ v: v[k], p: p.concat([k]), d: d + 1 })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// JSON-LD links. One walk of the document finds the nodes it defines (an object with an @id and
// at least one other key) and the places that point at a node (an object that is only an @id, or
// a string under a term the inline @context types as @id). Ids are resolved against @base, or the
// document's own URL, so "#alex", "people/alex.jsonld#me" and a full URL all compare as full
// URLs. Only the @context written in the file is read: remote contexts are never fetched. A few
// well-known ones (ActivityStreams, schema.org, security, DID, credentials) are recognised by their
// URL, and a small built-in table says which of their terms are @id, @type or hold ids.

// Well-known contexts, by URL (without the scheme or a trailing slash): which terms are aliases of
// @id and @type, and which hold ids ("@type": "@id"). Small on purpose; nothing is fetched.
const LD_KEYS = ['controller', 'verificationMethod', 'authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation']
const LD_AS = { id: ['id'], type: ['type'], refs: ['actor', 'object', 'target', 'attributedTo', 'inReplyTo', 'to', 'bto', 'cc', 'bcc', 'audience', 'url', 'href', 'icon', 'image', 'attachment', 'tag',
  'followers', 'following', 'inbox', 'outbox', 'liked', 'likes', 'shares', 'replies', 'first', 'last', 'next', 'prev', 'current', 'partOf', 'items', 'orderedItems', 'sharedInbox'] }
const LD_SCHEMA = { id: ['id'], type: ['type'], refs: [] } // its url, image and sameAs are web pages and pictures: left as ordinary links
const LD_SEC = { id: ['id'], type: ['type'], refs: LD_KEYS.concat(['creator', 'owner', 'publicKey']) }
const LD_DID = { id: ['id'], type: ['type'], refs: LD_KEYS.concat(['alsoKnownAs', 'serviceEndpoint']) }
const LD_VC = { id: ['id'], type: ['type'], refs: ['issuer', 'holder', 'credentialSubject', 'credentialSchema', 'credentialStatus', 'verificationMethod'] }
const KNOWN_CONTEXTS = {
  'www.w3.org/ns/activitystreams': LD_AS,
  'schema.org': LD_SCHEMA,
  'w3id.org/security/v1': LD_SEC,
  'w3id.org/security/v2': LD_SEC,
  'www.w3.org/ns/did/v1': LD_DID,
  'www.w3.org/2018/credentials/v1': LD_VC,
  'www.w3.org/ns/credentials/v2': LD_VC
}
function knownContext (url) {
  const m = /^https?:\/\/([^?#]*?)\/?(?:#.*)?$/i.exec(url)
  return m && Object.prototype.hasOwnProperty.call(KNOWN_CONTEXTS, m[1]) ? KNOWN_CONTEXTS[m[1]] : null
}

const RE_HTTP = /^https?:\/\//i
const RE_PREFIX = /^([^:/?#\s]+):(?!\/\/)(.*)$/
function docOf (iri) { const i = iri.indexOf('#'); return i < 0 ? iri : iri.slice(0, i) }
function absUrl (s, base) { try { return new URL(s, base).href } catch (e) { return null } }
function getAt (data, segs) { let v = data; for (const k of segs) { if (!isBranch(v)) return undefined; v = v[k] } return v }
// A short name for an id: "#alex" inside this document, "alex.jsonld#me" for another one
function shortIri (iri, here) {
  if (iri.startsWith('_:')) return iri
  const d = docOf(iri)
  const frag = iri.slice(d.length)
  if (d === here) return frag || 'this document'
  let tail = d
  try {
    const u = new URL(d)
    const parts = u.pathname.split('/').filter(Boolean)
    tail = parts.length && RE_HTTP.test(d) ? decodeURIComponent(parts[parts.length - 1]) : d
    if (!parts.length) tail = u.host || d
  } catch (e) {}
  return tail + frag
}

function ldIndex (data, docUrl) {
  const t0 = performance.now()
  const X = {
    base: docUrl,
    doc: docOf(docUrl),
    idKeys: new Set(['@id']), // "@id" and its aliases ("id": "@id")
    typeKeys: new Set(['@type']), // "@type" and its aliases
    refKeys: new Set(), // terms whose string values are ids ({"@type": "@id"})
    prefixes: new Map(), // "schema" -> "https://schema.org/"
    defs: new Map(), // full id -> [{ segs, idSegs }]: where the node is defined
    refs: new Map(), // full id -> [segs]: the strings that point at it
    role: new Map(), // path of an id string -> 'def' | 'ref'
    links: 0,
    local: 0
  }
  const top = isPlainObject(data) ? data : Array.isArray(data) && isPlainObject(data[0]) ? data[0] : null
  if (top && top['@context'] != null) {
    for (const c of [].concat(top['@context'])) {
      const known = typeof c === 'string' ? knownContext(c) : null
      if (known) { // a remote context we know by its URL: its aliases, from the built-in table
        for (const k of known.id) X.idKeys.add(k)
        for (const k of known.type) X.typeKeys.add(k)
        for (const k of known.refs) X.refKeys.add(k)
      }
      if (!isPlainObject(c)) continue
      if (typeof c['@base'] === 'string') X.base = absUrl(c['@base'], X.base) || X.base
      for (const k in c) {
        const d = c[k]
        if (k[0] === '@') continue
        if (d === '@id' || (isPlainObject(d) && d['@id'] === '@id')) X.idKeys.add(k)
        else if (d === '@type' || (isPlainObject(d) && d['@id'] === '@type')) X.typeKeys.add(k)
        else if (typeof d === 'string') { if (/^[a-z][a-z0-9+.-]*:.*[/#:]$/i.test(d)) X.prefixes.set(k, d) } else if (isPlainObject(d) && d['@type'] === '@id') X.refKeys.add(k)
      }
    }
  }
  X.resolve = (s) => {
    if (typeof s !== 'string' || s.length > 2048) return null
    if (s.startsWith('_:')) return s
    const m = X.prefixes.size ? RE_PREFIX.exec(s) : null
    if (m && X.prefixes.has(m[1])) s = X.prefixes.get(m[1]) + m[2]
    return absUrl(s, X.base)
  }
  const path = []
  const add = (map, iri, entry) => { const a = map.get(iri); if (a) a.push(entry); else map.set(iri, [entry]) }
  const refAt = (s, segs) => {
    const iri = X.resolve(s)
    if (!iri) return
    X.role.set(pkey(segs), 'ref')
    add(X.refs, iri, segs)
    X.links++
  }
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      const ids = X.refKeys.has(key)
      for (let i = 0; i < v.length; i++) {
        const c = v[i]
        if (isBranch(c)) { path.push(i); walk(c, key); path.pop() } else if (ids && typeof c === 'string') refAt(c, path.concat([i]))
      }
      return
    }
    let idKey = null
    let n = 0
    for (const k in v) { if (k !== '@context') n++; if (idKey === null && X.idKeys.has(k) && typeof v[k] === 'string') idKey = k }
    if (idKey !== null) {
      const idSegs = path.concat([idKey])
      if (n > 1) {
        const iri = X.resolve(v[idKey])
        if (iri) { X.role.set(pkey(idSegs), 'def'); add(X.defs, iri, { segs: path.slice(), idSegs }) }
      } else refAt(v[idKey], idSegs)
    }
    for (const k in v) {
      if (k === '@context') continue // term definitions are not nodes
      const c = v[k]
      if (isBranch(c)) { path.push(k); walk(c, k); path.pop() } else if (typeof c === 'string' && k !== idKey && X.refKeys.has(k)) refAt(c, path.concat([k]))
    }
  }
  if (isBranch(data)) walk(data, null)
  for (const [iri, list] of X.refs) if (X.defs.has(iri)) X.local += list.length
  X.ms = performance.now() - t0
  return X
}

// The one key of an object that is only a reference ({"@id": "#alex"}), or null
function soleRef (V, v, segs) {
  if (!V.ldx || !isPlainObject(v)) return null
  let key = null
  for (const k in v) { if (key !== null) return null; key = k }
  return key !== null && typeof v[key] === 'string' && V.ldx.role.get(pkey(segs.concat([key]))) === 'ref' ? key : null
}

// Fetch a linked document for "peek": once, on a click, with a short Accept header
async function fetchPeek (fetchFn, url) {
  let res, text
  try { res = await fetchFn(url, { headers: { accept: PEEK_ACCEPT } }) } catch (e) {
    return { error: 'Could not fetch it: the server did not answer, or it does not let this page read it (CORS).' }
  }
  if (!res.ok) return { error: 'Could not fetch it: the server answered ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '.' }
  try { text = (await res.text()).replace(/^﻿/, '') } catch (e) { return { error: 'Could not read it: ' + String((e && e.message) || e) } }
  const parsed = parseJSON(text)
  if (parsed.error) return { error: 'It is not JSON' + (parsed.error.line ? ' (line ' + fmt(parsed.error.line) + ', column ' + fmt(parsed.error.col) + ')' : '') + '.' }
  return { data: parsed.data, ldx: ldIndex(parsed.data, url), bytes: text.length }
}

// How a link to another document is followed: the SolidOS outliner, else the host's own
// context.navigate, else (false) the link's href.
function hostGo (context, doc, store, url) {
  if (!RE_HTTP.test(url)) return false
  try {
    const outliner = typeof context.getOutliner === 'function' && context.getOutliner(doc)
    if (outliner && typeof outliner.GotoSubject === 'function') {
      const term = store && typeof store.sym === 'function' ? store.sym(url)
        : { termType: 'NamedNode', value: url, uri: url, doc () { const d = docOf(url); return { termType: 'NamedNode', value: d, uri: d, doc () { return this } } } }
      outliner.GotoSubject(term, true, undefined, true, undefined)
      return true
    }
  } catch (e) {}
  try { if (typeof context.navigate === 'function') { context.navigate(url); return true } } catch (e) {}
  return false
}

// ---------------------------------------------------------------------------------------------
// The pane

function knownType (subject, store) {
  if (!store) return null
  try {
    const doc = subject.doc ? subject.doc() : subject
    const h = store.fetcher && store.fetcher.getHeader && store.fetcher.getHeader(doc, 'content-type')
    if (h && h.length) return String(h[0])
  } catch (e) {}
  try {
    const types = store.each(subject, store.sym('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), null, subject.doc ? subject.doc() : undefined)
    for (const t of types) {
      const m = /\/media-types\/([a-z]+\/[^#]+)/i.exec(t.uri || '')
      if (m) return m[1]
    }
  } catch (e) {}
  return null
}
const RE_EXT = /\.(json|jsonld|jsonl|ndjson)$/i
const RE_LINES_EXT = /\.(jsonl|ndjson)$/i
const RE_LINES_TYPE = /^application\/(?:jsonl|x-ndjson|ndjson|json-seq|x-jsonlines|jsonlines)\s*(?:;|$)/i
const RE_TYPE = /^application\/(?:(?:ld\+)?json|jsonl|x-ndjson|ndjson|json-seq|x-jsonlines|jsonlines)\s*(?:;|$)/i
function applies (subject, store) {
  const uri = subject && subject.uri
  if (!uri || uri.endsWith('/')) return false
  if (RE_EXT.test(uri.split(/[?#]/)[0])) return true
  const t = knownType(subject, store)
  return !!t && RE_TYPE.test(t)
}

const pane = {
  name: 'json-viewer',
  icon: ICON,
  label (subject, context) {
    const store = context && context.session && context.session.store
    return applies(subject, store) ? 'JSON' : null
  },
  shouldGetFocus (subject) {
    return !!(subject && subject.uri && RE_EXT.test(subject.uri.split(/[?#]/)[0]))
  },
  render (subject, context) {
    const doc = context.dom
    const store = context.session && context.session.store
    const fetchFn = (store && store.fetcher && store.fetcher._fetch) || ((u, o) => fetch(u, o))
    const t0 = performance.now()
    const given = context.source && typeof context.source.text === 'string' ? context.source
      : typeof context.jsonText === 'string' ? { text: context.jsonText } : null
    const root = el(doc, 'div', 'jv json-pane')
    const cssText = context.css === false ? null : typeof context.css === 'string' ? context.css : CSS
    let outer = root
    if (context.shadow && root.attachShadow) {
      outer = el(doc, 'div', 'jv-host')
      const shadow = outer.attachShadow({ mode: 'open' })
      if (cssText && !adoptCss(doc, shadow, cssText)) root.appendChild(el(doc, 'style', null, cssText))
      shadow.appendChild(root)
    } else if (cssText) root.appendChild(el(doc, 'style', null, cssText))
    const uri = (given && given.url) || subject.uri
    const name = (() => { try { return decodeURIComponent(uri.split(/[?#]/)[0].replace(/\/$/, '').split('/').pop()) || uri } catch (e) { return uri } })()

    const head = el(doc, 'header', 'jv-head')
    const h = el(doc, 'h2', 'jv-name')
    h.append(logoSvg(doc, 26), el(doc, 'span', null, name))
    h.title = uri
    const meta = el(doc, 'div', 'jv-meta')
    head.append(h, meta)
    root.appendChild(head)
    const pill = (text, cls, title) => { const p = el(doc, 'span', 'jv-pill' + (cls ? ' ' + cls : ''), text); if (title) p.title = title; meta.appendChild(p); return p }

    const body = el(doc, 'div', 'jv-body')
    root.appendChild(body)
    const loading = el(doc, 'div', 'jv-card jv-loading')
    loading.append(el(doc, 'span', 'jv-spin'), el(doc, 'span', null, 'Loading ' + name + '…'))
    body.appendChild(loading)

    const errorCard = (title, lines, extra) => {
      const card = el(doc, 'div', 'jv-card jv-err')
      card.setAttribute('role', 'alert')
      card.appendChild(el(doc, 'h3', null, title))
      for (const l of lines) card.appendChild(typeof l === 'string' ? el(doc, 'p', null, l) : l)
      if (extra) card.appendChild(extra)
      const open = el(doc, 'a', 'jv-btn', 'Open the file')
      open.href = uri; open.target = '_blank'; open.rel = 'noopener noreferrer'
      card.appendChild(open)
      body.replaceChildren(card)
    }

    ;(async () => {
      let ctype, text, bytes
      if (given) { // the host already has the text: no second request
        text = given.text.replace(/^﻿/, '')
        ctype = String(given.contentType || '').split(';')[0].trim().toLowerCase()
        bytes = typeof given.bytes === 'number' ? given.bytes : utf8Length(text)
      } else {
        let res, buf
        try {
          res = await fetchFn(uri, { headers: { accept: ACCEPT } })
        } catch (e) {
          return errorCard('Could not load the file', [String((e && e.message) || e), 'The server did not answer, or it does not let this page read the file (CORS).'])
        }
        if (!res.ok) {
          return errorCard('Could not load the file', ['The server answered ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '.', uri])
        }
        try { buf = await res.arrayBuffer() } catch (e) { return errorCard('Could not read the file', [String((e && e.message) || e)]) }
        ctype = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '')
        bytes = buf.byteLength
      }
      pill(humanBytes(bytes), null, fmt(bytes) + ' bytes')
      // JSON Lines by name or type; or by content, when the file fails as JSON but its lines parse
      const announced = RE_LINES_EXT.test(uri.split(/[?#]/)[0]) || RE_LINES_TYPE.test(ctype)
      let parsed = announced ? parseLines(text, false) : parseJSON(text)
      if (announced && parsed.lines && parsed.lines.errors === parsed.lines.count) { // not one line parses: perhaps it is one JSON document after all
        const whole = parseJSON(text)
        if (!whole.error) parsed = whole
      } else if (!announced && parsed.error && text.includes('\n')) {
        const t1 = performance.now()
        const lined = parseLines(text, true)
        if (lined && !lined.error) { lined.ms = parsed.ms + performance.now() - t1; parsed = lined }
      }
      if (parsed.error) {
        meta.insertBefore(el(doc, 'span', 'jv-pill jv-fmt', 'JSON'), meta.firstChild)
        return showParseError(parsed.error, text)
      }
      const data = parsed.data
      const lines = parsed.lines || null
      const ld = lines ? false : ctype === 'application/ld+json' || /\.jsonld$/i.test(uri.split(/[?#]/)[0]) || (isPlainObject(data) && ('@context' in data || '@graph' in data)) || (Array.isArray(data) && isPlainObject(data[0]) && '@context' in data[0])
      meta.insertBefore(el(doc, 'span', 'jv-pill jv-fmt' + (ld ? ' jv-fmt-ld' : ''), lines ? 'JSON Lines' : ld ? 'JSON-LD' : 'JSON'), meta.firstChild)
      if (lines) {
        pill(plural(lines.count, 'line', 'lines') + (lines.errors ? ' · ' + plural(lines.errors, 'error', 'errors') : ''), lines.errors ? 'jv-pill-err' : null,
          plural(lines.count, 'record', 'records') + ', one a line' + (lines.errors ? '; ' + plural(lines.errors, 'line does', 'lines do') + ' not parse and ' + (lines.errors === 1 ? 'is' : 'are') + ' shown in place' : '') +
          (lines.total > lines.count ? '; blank lines are skipped' : ''))
        root.dataset.lines = String(lines.count)
        root.dataset.lineErrors = String(lines.errors)
      } else if (isBranch(data)) pill((Array.isArray(data) ? 'Array · ' : 'Object · ') + countLabel(data, Array.isArray(data) ? data.length : Object.keys(data).length))
      const ldx = ld ? ldIndex(data, absUrl(uri, doc.baseURI) || uri) : null
      if (ldx && (ldx.defs.size || ldx.links)) {
        pill(plural(ldx.defs.size, 'node', 'nodes') + ' · ' + plural(ldx.links, 'link', 'links'), 'jv-pill-ld',
          plural(ldx.defs.size, 'node has', 'nodes have') + ' an @id; ' + plural(ldx.links, 'reference', 'references') + ' to an @id, ' + fmt(ldx.local) + ' to a node in this document and ' + fmt(ldx.links - ldx.local) + ' elsewhere')
        root.dataset.ldNodes = String(ldx.defs.size)
        root.dataset.ldLinks = String(ldx.links)
      }
      pill('parsed in ' + humanMs(parsed.ms), null, 'Parsed once, in the browser')
      if (parsed.bigs) pill(plural(parsed.bigs, 'big number', 'big numbers'), 'jv-pill-big', 'Numbers too long for a JavaScript number, kept exactly as written')
      root.dataset.bigs = String(parsed.bigs || 0)
      root.dataset.parseMs = parsed.ms.toFixed(1)
      root.dataset.bytes = String(bytes)
      const host = { peek: context.peek !== false, fetch: fetchFn, go: url => hostGo(context, doc, store, url) }
      viewer(doc, root, body, { data, text, uri, ld, ldx, lines, host, bytes, images: context.imagePreviews !== false })
      const raf = globalThis.requestAnimationFrame || (f => setTimeout(f, 16))
      raf(() => { root.dataset.firstRenderMs = (performance.now() - t0).toFixed(1); root.classList.add('jv-ready') })
    })().catch(e => errorCard('The viewer failed', [String((e && e.stack) || e)]))

    function showParseError (err, text) {
      const lines = [err.message]
      const extra = el(doc, 'div')
      if (err.line) {
        const loc = el(doc, 'span', 'jv-loc', 'Line ' + fmt(err.line) + ', column ' + fmt(err.col))
        extra.appendChild(loc)
        extra.appendChild(snippet(doc, text, err.line, err.col))
      }
      if (err.browser && err.browser !== err.message) {
        const p = el(doc, 'p', null, 'The browser says: ' + err.browser)
        p.style.fontSize = '13px'
        extra.appendChild(p)
      }
      errorCard('This file is not valid JSON', lines, extra)
      root.dataset.errorLine = String(err.line || '')
      root.dataset.errorCol = String(err.col || '')
    }

    return outer
  }
}
pane.css = CSS

// Styles for a shadow root as a constructed stylesheet; false if the browser cannot
function adoptCss (doc, shadow, cssText) {
  try {
    const Sheet = (doc.defaultView && doc.defaultView.CSSStyleSheet) || globalThis.CSSStyleSheet
    if (!Sheet || !('adoptedStyleSheets' in shadow)) return false
    const sheet = new Sheet()
    sheet.replaceSync(cssText)
    shadow.adoptedStyleSheets = [sheet]
    return shadow.adoptedStyleSheets.length === 1
  } catch (e) { return false }
}

function utf8Length (s) {
  if (!/[^\x00-\x7f]/.test(s)) return s.length // eslint-disable-line no-control-regex
  try { return new TextEncoder().encode(s).length } catch (e) { return s.length }
}

function snippet (doc, text, line, col) {
  const box = el(doc, 'div', 'jv-snip')
  box.setAttribute('aria-label', 'The text around the error')
  const first = Math.max(1, line - 3)
  let pos = 0
  for (let l = 1; l < first; l++) { pos = text.indexOf('\n', pos) + 1 }
  const WIDTH = 110
  const start = Math.max(0, col - 1 - Math.floor(WIDTH / 2))
  const width = String(line + 2).length
  box.style.setProperty('--jv-nw', (width + 1) + 'ch')
  for (let l = first; l <= line + 2 && pos <= text.length; l++) {
    let end = text.indexOf('\n', pos)
    if (end === -1) end = text.length
    let s = text.slice(pos, end).replace(/\r$/, '').replace(/\t/g, ' ')
    let shift = 0
    if (s.length > WIDTH) {
      const cut = s.slice(start, start + WIDTH)
      s = (start > 0 ? '…' : '') + cut + (start + WIDTH < s.length ? '…' : '')
      shift = start > 0 ? 1 - start : 0
    }
    const row = el(doc, 'div', 'jv-ln' + (l === line ? ' jv-errline' : ''))
    row.append(el(doc, 'span', 'jv-no', String(l)), el(doc, 'span', 'jv-code', s || ' '))
    box.appendChild(row)
    if (l === line) {
      const caret = el(doc, 'div', 'jv-ln')
      caret.append(el(doc, 'span', 'jv-no', ''), el(doc, 'span', 'jv-code jv-caret', ' '.repeat(Math.max(0, col - 1 + shift)) + '^'))
      box.appendChild(caret)
    }
    pos = end + 1
  }
  return box
}

// ---------------------------------------------------------------------------------------------
// The viewer: toolbar, schema panel and the three views

function viewer (doc, root, body, file) {
  const { data, text, uri, ld } = file
  const big = file.bytes > 2e6
  const V = {
    doc,
    data,
    text,
    base: uri,
    ld,
    images: file.images !== false,
    ldx: file.ldx || null,
    lines: file.lines || null,
    host: file.host || { peek: false, fetch: null, go: () => false },
    state: { mode: '', term: '', hits: null, total: 0, idx: -1, filter: false },
    match: null,
    current: null,
    focusedTree: null
  }
  V.main = V // a peeked document gets a viewer state of its own, which points back here
  const win = doc.defaultView || globalThis

  // --- toast and copy
  const toast = el(doc, 'div', 'jv-toast')
  toast.setAttribute('role', 'status')
  root.appendChild(toast)
  let toastTimer = 0
  V.toast = (msg) => {
    toast.textContent = msg
    toast.classList.add('jv-on')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('jv-on'), 1600)
  }
  V.copy = async (textToCopy, what) => {
    const ok = await copyText(doc, textToCopy)
    V.toast(ok ? 'Copied ' + what : 'Could not copy')
  }
  V.copyValue = (v) => V.copy(typeof v === 'string' ? v : isErr(v) ? v.text : stringify(v, 2), isErr(v) ? 'the line as written' : typeof v === 'string' || !isBranch(v) ? 'the value' : (Array.isArray(v) ? 'the array' : 'the object'))
  V.copyPath = (segs) => V.copy(pathOf(segs), pathOf(segs))

  // --- image preview popover (hover), shared by every thumbnail button
  const pop = el(doc, 'div', 'jv-pop')
  pop.hidden = true
  const popImg = el(doc, 'img')
  popImg.alt = ''
  pop.appendChild(popImg)
  root.appendChild(pop)
  V.showPop = (btn, href) => {
    popImg.src = href
    pop.hidden = false
    const r = btn.getBoundingClientRect()
    const vw = doc.documentElement.clientWidth
    const w = 234
    pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px'
    const below = r.bottom + 8
    pop.style.top = (below + 190 > (globalThis.innerHeight || 800) ? Math.max(8, r.top - 190) : below) + 'px'
  }
  V.hidePop = () => { pop.hidden = true }
  globalThis.addEventListener('scroll', V.hidePop, { passive: true })

  // --- sticky toolbar
  const bar = el(doc, 'div', 'jv-bar')
  const row1 = el(doc, 'div', 'jv-barrow')
  const tabs = el(doc, 'div', 'jv-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'View')
  const tables = findTables(data)
  const tabDefs = [['tree', 'Tree'], ['table', 'Table'], ['raw', 'Raw']].filter(([id]) => id !== 'table' || tables.length)
  const tabBtns = {}
  for (const [id, label] of tabDefs) {
    const b = el(doc, 'button', 'jv-tab', label)
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.id = 'jv-tab-' + id + '-' + Math.random().toString(36).slice(2, 7)
    b.addEventListener('click', () => show(id))
    tabBtns[id] = b
    tabs.appendChild(b)
  }
  tabs.addEventListener('keydown', e => {
    const ids = tabDefs.map(t => t[0])
    const i = ids.indexOf(V.view)
    let j = -1
    if (e.key === 'ArrowRight') j = (i + 1) % ids.length
    else if (e.key === 'ArrowLeft') j = (i - 1 + ids.length) % ids.length
    if (j >= 0) { e.preventDefault(); show(ids[j]); tabBtns[ids[j]].focus() }
  })
  const expandBtn = button(doc, 'jv-btn jv-narrow-sq', 'expand', 'Expand all', 'Expand all', () => {
    show('tree')
    const r = mainTree.expandAll(LIMITS.expandAll)
    markLevel(0)
    if (r.limited) V.toast('Opened the first ' + fmt(LIMITS.expandAll) + ' rows')
  })
  const collapseBtn = button(doc, 'jv-btn jv-narrow-sq', 'collapse', 'Collapse all', 'Collapse all', () => { show('tree'); mainTree.collapseAll(); markLevel(0) })
  // Level 1-4: open the tree down to that depth, close anything deeper
  const levels = el(doc, 'div', 'jv-levels')
  levels.setAttribute('role', 'group')
  levels.setAttribute('aria-label', 'Open the tree to a level')
  levels.appendChild(el(doc, 'span', 'jv-levlab', 'Level'))
  const levelBtns = [1, 2, 3, 4].map(n => {
    const b = el(doc, 'button', 'jv-lev', String(n))
    b.type = 'button'
    b.title = 'Level ' + n + ': open the tree ' + (n === 1 ? 'to its first level only' : n + ' levels deep') + ' and close anything deeper (Alt+' + n + ')'
    b.setAttribute('aria-label', 'Level ' + n)
    b.setAttribute('aria-keyshortcuts', 'Alt+' + n)
    b.setAttribute('aria-pressed', 'false')
    b.addEventListener('click', () => setLevel(n))
    levels.appendChild(b)
    return b
  })
  function markLevel (n) {
    levelBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === n)))
    if (n) root.dataset.level = String(n); else delete root.dataset.level
  }
  V.levelOff = () => { if (root.dataset.level) markLevel(0) }
  function setLevel (n) {
    if (V.state.mode === 'query') return
    show('tree')
    const r = mainTree.toLevel(n, LIMITS.levelRows)
    markLevel(n)
    root.dataset.levelRows = String(r.rows)
    if (r.limited) V.toast('Level ' + n + ': showing the first ' + fmt(r.rows) + ' rows')
  }
  const copyAllBtn = button(doc, 'jv-btn jv-narrow-sq', 'copy', 'Copy all', 'Copy the whole file', () => V.copy(text, 'the whole file (' + humanBytes(file.bytes) + ')'))
  const tools = el(doc, 'div', 'jv-tools')
  tools.append(levels, expandBtn, collapseBtn, copyAllBtn)
  row1.append(tabs, el(doc, 'span', 'jv-grow'), tools)

  const row2 = el(doc, 'div', 'jv-barrow')
  const search = el(doc, 'div', 'jv-search')
  search.addEventListener('click', e => { if (e.target === search) q.focus() })
  const q = el(doc, 'input', 'jv-q')
  q.type = 'text'
  q.spellcheck = false
  q.autocomplete = 'off'
  q.setAttribute('autocapitalize', 'off')
  q.placeholder = 'Search, or type a $.path'
  q.setAttribute('aria-label', 'Search keys and values, or type a JSONPath starting with $')
  q.setAttribute('aria-keyshortcuts', '/')
  const modeChip = el(doc, 'span', 'jv-mode', 'JSONPath')
  modeChip.hidden = true
  const count = el(doc, 'span', 'jv-count')
  count.setAttribute('aria-live', 'polite')
  const clear = button(doc, 'jv-clear', 'close', null, 'Clear the search', () => { q.value = ''; onInput(true); q.focus() })
  clear.hidden = true
  search.append(icon(doc, 'search', 19), q, modeChip, count, clear)
  const prevBtn = button(doc, 'jv-btn jv-sq', 'up', null, 'Previous match (Shift+Enter)', () => go(-1))
  const nextBtn = button(doc, 'jv-btn jv-sq', 'down', null, 'Next match (Enter)', () => go(1))
  const filterBtn = button(doc, 'jv-btn jv-narrow-sq', 'filter', 'Filter', 'Hide branches without matches', () => {
    V.state.filter = !V.state.filter
    filterBtn.setAttribute('aria-pressed', String(V.state.filter))
    runSearch(true)
  })
  filterBtn.setAttribute('aria-pressed', 'false')
  row2.append(search, prevBtn, nextBtn, filterBtn)

  const pathbar = el(doc, 'div', 'jv-pathbar')
  const pathCode = el(doc, 'code')
  pathCode.setAttribute('role', 'group')
  pathCode.setAttribute('aria-label', 'Path of the selected row: each part jumps to it')
  const copyPathBtn = button(doc, 'jv-btn jv-narrow-sq', 'path', 'Copy path', 'Copy the JSONPath of the selected row', () => { if (V.current) V.copyPath(V.current.segs) })
  const copyValBtn = button(doc, 'jv-btn jv-narrow-sq', 'copy', 'Copy value', 'Copy the value of the selected row', () => { if (V.current) V.copyValue(V.current.value) })
  pathbar.append(pathCode, copyPathBtn, copyValBtn)

  // the trail of @id jumps: shown from the first jump on
  const trailRow = el(doc, 'div', 'jv-trail')
  trailRow.hidden = true
  const backBtn = button(doc, 'jv-btn jv-sq jv-back', 'back', null, 'Back to where you were (Alt+Left)', () => trailGo(-1))
  const fwdBtn = button(doc, 'jv-btn jv-sq jv-fwd', 'forward', null, 'Forward (Alt+Right)', () => trailGo(1))
  backBtn.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft')
  fwdBtn.setAttribute('aria-keyshortcuts', 'Alt+ArrowRight')
  const trailText = el(doc, 'span', 'jv-trailtext')
  trailText.setAttribute('aria-live', 'polite')
  const stepBtn = button(doc, 'jv-btn jv-narrow-sq jv-step', 'down', 'Next reference', 'The next place that points to this node', () => { const e = trail[ti]; if (e && e.ref) V.ldStep(e.ref) })
  stepBtn.hidden = true
  trailRow.append(backBtn, fwdBtn, trailText, stepBtn)
  bar.append(row1, row2, trailRow, pathbar)

  // --- schema panel
  const schema = el(doc, 'details', 'jv-schema')
  const sum = el(doc, 'summary')
  const sstats = el(doc, 'span', 'jv-sstats')
  sum.append(icon(doc, 'chevron', 16), el(doc, 'span', 'jv-stitle', 'Schema'), sstats)
  sum.firstChild.classList.add('jv-chev')
  const sbody = el(doc, 'div', 'jv-sbody')
  schema.append(sum, sbody)
  let schemaInfo = null
  const schemaStats = () => {
    if (!schemaInfo) {
      const t = performance.now()
      schemaInfo = inferSchema(data)
      schemaInfo.ms = performance.now() - t
    }
    const s = schemaInfo
    sstats.textContent = plural(s.paths.length, 'path', 'paths') + ' · depth ' + s.maxDepth + ' · ' + plural(s.keys, 'key', 'keys') + ' · ' + plural(s.values, 'value', 'values')
  }
  if (!big) schemaStats()
  else sstats.textContent = 'inferred types of every path (opens on demand)'
  let schemaBuilt = false
  schema.addEventListener('toggle', () => {
    if (!schema.open || schemaBuilt) return
    schemaBuilt = true
    schemaStats()
    const shown = schemaInfo.paths.slice(0, 400)
    for (const p of shown) {
      const r = el(doc, 'button', 'jv-srow')
      r.type = 'button'
      r.title = 'Run ' + p.path
      const sp = el(doc, 'span', 'jv-spath', p.path)
      sp.style.paddingLeft = Math.min(p.depth, 8) * 10 + 'px'
      const types = el(doc, 'span', 'jv-stypes')
      for (const t of Object.keys(p.types)) {
        let label = t + ' ' + fmt(p.types[t]) + '×'
        if (t === 'array') label += p.min === p.max ? ' · ' + plural(p.min, 'item', 'items') : ' · ' + fmt(p.min) + '–' + fmt(p.max) + ' items'
        types.appendChild(el(doc, 'span', 'jv-stype t-' + t, label))
      }
      r.append(sp, types)
      r.addEventListener('click', () => { q.value = p.path; onInput(true); show('tree') })
      sbody.appendChild(r)
    }
    if (schemaInfo.paths.length > shown.length) sbody.appendChild(el(doc, 'div', 'jv-snote', '… and ' + fmt(schemaInfo.paths.length - shown.length) + ' more paths'))
    sbody.appendChild(el(doc, 'div', 'jv-snote', 'Click a path to query it. Inferred in ' + humanMs(schemaInfo.ms) + '.'))
  })

  // --- views
  const views = {}
  for (const [id] of tabDefs) {
    const v = el(doc, 'div', 'jv-view')
    v.setAttribute('role', 'tabpanel')
    v.setAttribute('aria-labelledby', tabBtns[id].id)
    v.hidden = true
    views[id] = v
  }
  body.replaceChildren(bar, schema, ...Object.values(views))

  const mainTree = makeTree(V, data, [], { label: 'JSON tree', autoRows: LIMITS.autoRows })
  V.mainTree = mainTree
  const results = el(doc, 'div', 'jv-results')
  results.hidden = true
  views.tree.append(mainTree.el, results)

  let tableBuilt = false
  let rawBuilt = false
  function show (id) {
    if (!views[id]) id = 'tree'
    V.view = id
    for (const k of Object.keys(views)) {
      views[k].hidden = k !== id
      tabBtns[k].setAttribute('aria-selected', String(k === id))
      tabBtns[k].tabIndex = k === id ? 0 : -1
    }
    expandBtn.disabled = collapseBtn.disabled = id !== 'tree' || V.state.mode === 'query'
    for (const b of levelBtns) b.disabled = expandBtn.disabled
    filterBtn.disabled = V.state.mode === 'query'
    pathbar.hidden = id !== 'tree' || V.state.mode === 'query'
    if (id === 'table' && !tableBuilt) { tableBuilt = true; buildTableView() }
    if (id === 'raw' && !rawBuilt) { rawBuilt = true; views.raw.appendChild(makeRaw(V)) }
    syncHeight()
  }
  V.show = show

  function buildTableView () {
    const box = views.table
    const headRow = el(doc, 'div', 'jv-tablehead')
    const holder = el(doc, 'div')
    const pick = (t) => holder.replaceChildren(makeTable(V, t.value, t.segs))
    if (tables.length > 1) {
      const lab = el(doc, 'label', null, 'Array')
      const sel = el(doc, 'select', 'jv-select')
      sel.id = 'jv-tsel-' + Math.random().toString(36).slice(2, 7)
      lab.htmlFor = sel.id
      tables.forEach((t, i) => {
        const o = el(doc, 'option', null, pathOf(t.segs) + '  (' + plural(t.value.length, 'row', 'rows') + ')')
        o.value = String(i)
        sel.appendChild(o)
      })
      sel.addEventListener('change', () => pick(tables[+sel.value]))
      headRow.append(lab, sel)
    } else {
      headRow.appendChild(el(doc, 'span', 'jv-rawinfo', pathOf(tables[0].segs) + ' · ' + plural(tables[0].value.length, 'row', 'rows')))
    }
    box.append(headRow, holder)
    pick(tables[0])
  }

  // The selected row: path bar and copy buttons
  // The bar is there from the start, with $ alone: were it to appear on the first click, the rows
  // would move down under the pointer between the press and the release.
  const noRow = { kind: 'none', segs: [] }
  V.setCurrent = (node) => {
    V.current = node === noRow ? null : node
    // The path as crumbs: $ › panes › 0 › name. The punctuation of the JSONPath is there but not
    // drawn, so the text of the bar is still the path ($.panes[0].name).
    const segs = node.segs
    const frag = doc.createDocumentFragment()
    for (let i = 0; i <= segs.length; i++) {
      const b = el(doc, 'button', 'jv-crumb')
      b.type = 'button'
      if (i === 0) {
        b.textContent = '$'
        b.title = 'The top of the file' + (V.lines ? ': ' + plural(V.lines.count, 'line', 'lines') : '')
      } else {
        const k = segs[i - 1]
        const sg = seg(k)
        const pre = typeof k === 'number' ? '[' : sg[0] === '.' ? '.' : "['"
        const post = typeof k === 'number' ? ']' : sg[0] === '.' ? '' : "']"
        b.append(el(doc, 'span', 'jv-cx', pre), sg.slice(pre.length, sg.length - post.length))
        if (post) b.appendChild(el(doc, 'span', 'jv-cx', post))
        b.title = 'Go to ' + pathOf(segs.slice(0, i))
      }
      if (i === segs.length) b.setAttribute('aria-current', 'location')
      b.addEventListener('click', () => crumbGo(segs.slice(0, i)))
      frag.appendChild(b)
    }
    if (node.kind === 'bucket') frag.appendChild(el(doc, 'span', 'jv-crange', '  ' + rangeLabel(node)))
    pathCode.replaceChildren(frag)
    pathCode.dataset.path = pathOf(segs)
    copyValBtn.disabled = node.kind !== 'value'
    copyPathBtn.disabled = node === noRow
    pathbar.hidden = V.view !== 'tree' || V.state.mode === 'query'
    pathCode.scrollLeft = pathCode.scrollWidth // a long path: its end is what is selected
    syncHeight()
  }
  function crumbGo (segs) {
    if (segs.length) return V.showInTree(segs)
    const first = mainTree.firstItem() // $: the top of the tree
    if (!first) return
    mainTree.focus(first)
    first.firstChild.scrollIntoView({ block: 'center' })
  }

  // Keep rows clear of the sticky toolbar when they scroll into view
  function syncHeight () { root.style.setProperty('--jv-sm', (bar.offsetHeight + 12) + 'px') }
  globalThis.addEventListener('resize', syncHeight, { passive: true })

  // --- search, filter and path query
  let timer = 0
  function onInput (now) {
    clearTimeout(timer)
    const value = q.value
    clear.hidden = !value
    const isPath = value.trim().startsWith('$')
    modeChip.hidden = !isPath
    q.classList.toggle('jv-q-path', isPath)
    if (now === true) return apply()
    timer = setTimeout(apply, big ? 350 : 140)
  }
  function apply () {
    const value = q.value.trim()
    if (value.startsWith('$')) { V.state.mode = 'query'; V.state.term = ''; runQuery(value) } else {
      const was = V.state.mode
      V.state.mode = value ? 'search' : ''
      V.state.term = value
      if (was === 'query') { results.hidden = true; mainTree.el.hidden = false }
      runSearch(false)
    }
    show(V.state.mode ? 'tree' : V.view || 'tree')
  }
  q.addEventListener('input', onInput)
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (pendingApply()) apply(); else go(e.shiftKey ? -1 : 1) } else if (e.key === 'Escape') {
      e.preventDefault()
      if (q.value) { q.value = ''; onInput(true) } else q.blur()
    } else if (e.key === 'ArrowDown' && V.state.mode !== 'query') {
      e.preventDefault()
      const it = (V.current && V.current.el && V.current.el.isConnected) ? V.current.el : mainTree.firstItem()
      if (it) mainTree.focus(it)
    }
  })
  let applied = ''
  const pendingApply = () => q.value.trim() !== applied

  function runSearch (rebuildOnly) {
    applied = q.value.trim()
    const term = V.state.term
    const st = V.state
    if (!rebuildOnly || st.hits === null) {
      if (term && st.mode === 'search') {
        const r = searchData(data, term, LIMITS.matches)
        st.hits = r.hits
        st.total = r.total
      } else { st.hits = null; st.total = 0 }
    }
    st.idx = -1
    V.match = st.filter && st.hits ? matchIndex(st.hits, data) : null
    setCurrentHit(null)
    if (st.filter || rebuildOnly) mainTree.rebuild()
    else repaint()
    updateCount()
    if (st.hits && st.hits.length) go(1)
    else if (st.filter && st.hits) mainTree.empty('No keys or values match “' + term + '”.')
  }
  function repaint () { for (const s of root.querySelectorAll('.jv-hl')) paint(V, s) }
  V.repaint = repaint

  function updateCount () {
    const st = V.state
    count.classList.remove('jv-none')
    if (st.mode !== 'search') { count.textContent = ''; prevBtn.disabled = nextBtn.disabled = true; return }
    if (!st.total) { count.textContent = 'No matches'; count.classList.add('jv-none'); prevBtn.disabled = nextBtn.disabled = true; return }
    const capped = st.total > st.hits.length ? ' (' + fmt(st.hits.length) + ' shown)' : ''
    count.textContent = (st.idx >= 0 ? fmt(st.idx + 1) + ' of ' : '') + fmt(st.total) + capped
    prevBtn.disabled = nextBtn.disabled = false
  }
  function setCurrentHit (item) {
    const old = root.querySelector('.jv-current')
    if (old) old.classList.remove('jv-current')
    if (item) item.classList.add('jv-current')
  }
  function go (step) {
    const st = V.state
    if (st.mode !== 'search' || !st.hits || !st.hits.length) return
    if (V.view !== 'tree') show('tree')
    st.idx = st.idx < 0 ? (step < 0 ? st.hits.length - 1 : 0) : (st.idx + step + st.hits.length) % st.hits.length
    const hit = st.hits[st.idx]
    const node = mainTree.reveal(hit.segs)
    updateCount()
    if (!node) return
    if (hit.where & 2 && typeof node.value === 'string') {
      const at = node.value.toLowerCase().indexOf(st.term.toLowerCase())
      const more = node.el.querySelector(':scope > .jv-row .jv-more')
      if (more && at + st.term.length > LIMITS.string && more.dataset.state === 'short') more.click()
    }
    setCurrentHit(node.el)
    mainTree.setActive(node.el)
    node.el.firstChild.scrollIntoView({ block: 'center' })
  }

  function runQuery (src) {
    applied = src
    V.state.hits = null
    V.match = null
    setCurrentHit(null)
    if (V.state.filter) mainTree.rebuild() // drop a search filter
    repaint()
    updateCount()
    mainTree.el.hidden = true
    results.hidden = false
    results.replaceChildren()
    let steps
    try { steps = compilePath(src) } catch (e) {
      results.appendChild(el(doc, 'div', 'jv-rhead jv-bad', e.message + '. Try $.key, $..name, $.list[0] or $.list[*].name.'))
      count.textContent = ''
      return
    }
    const t = performance.now()
    const { results: found, capped } = runPath(data, steps, 5000)
    const ms = performance.now() - t
    count.textContent = (capped ? fmt(found.length) + '+' : fmt(found.length)) + (found.length === 1 ? ' result' : ' results')
    count.classList.toggle('jv-none', !found.length)
    results.appendChild(el(doc, 'div', 'jv-rhead', found.length
      ? (capped ? 'The first ' : '') + plural(found.length, 'result', 'results') + ' for ' + src + ', in ' + humanMs(ms) + '.'
      : 'Nothing matches ' + src + '.'))
    let shown = 0
    const more = button(doc, 'jv-btn', null, 'Show more', null, () => page())
    function page () {
      const end = Math.min(found.length, shown + LIMITS.results)
      const frag = doc.createDocumentFragment()
      for (; shown < end; shown++) frag.appendChild(resultCard(found[shown]))
      more.remove()
      results.appendChild(frag)
      if (shown < found.length) { more.lastChild.textContent = 'Show ' + fmt(Math.min(LIMITS.results, found.length - shown)) + ' more (' + fmt(found.length - shown) + ' left)'; results.appendChild(more) }
    }
    page()
  }
  function resultCard (r) {
    const card = el(doc, 'div', 'jv-res')
    const top = el(doc, 'div', 'jv-res-top')
    top.append(el(doc, 'code', null, pathOf(r.p)),
      button(doc, 'jv-btn', 'tree', 'Show in tree', 'Show this node in the tree', () => V.showInTree(r.p)),
      button(doc, 'jv-btn jv-sq', 'path', null, 'Copy the path', () => V.copyPath(r.p)),
      button(doc, 'jv-btn jv-sq', 'copy', null, 'Copy the value', () => V.copyValue(r.v)))
    const b = el(doc, 'div', 'jv-res-body')
    if (isBranch(r.v) && (Array.isArray(r.v) ? r.v.length : Object.keys(r.v).length)) {
      b.appendChild(makeTree(V, r.v, r.p, { label: pathOf(r.p), autoRows: 12, mini: true }).el)
    } else {
      const line = el(doc, 'div', 'jv-line')
      line.appendChild(isBranch(r.v) ? el(doc, 'span', 'jv-empty', Array.isArray(r.v) ? '[]' : '{}') : valueEl(V, r.v, r.p[r.p.length - 1], r.p.length > 1 ? r.p[r.p.length - 2] : null, 'tree', r.p))
      b.appendChild(line)
    }
    card.append(top, b)
    return card
  }

  V.showInTree = (segs) => {
    if (V.state.mode === 'query') { q.value = ''; onInput(true) }
    show('tree')
    const node = mainTree.reveal(segs)
    if (node) {
      mainTree.focus(node.el)
      node.el.firstChild.scrollIntoView({ block: 'center' })
    }
  }

  // --- JSON-LD: follow an @id in place, and a trail to come back along
  const ldx = V.ldx
  const here = ldx ? ldx.doc : docOf(uri)
  const trail = [] // { view, segs | null, y, label, ref }
  let ti = -1
  const mark = (segs) => ({ view: V.view, segs: segs || null, y: win.scrollY || 0 })
  const sameSpot = (a, b) => !!a && !!b && a.view === b.view && (a.segs && b.segs ? pkey(a.segs) === pkey(b.segs) : !a.segs && !b.segs && Math.abs(a.y - b.y) < 2)
  function record (from, to) {
    if (!sameSpot(trail[ti], from)) { trail.length = ti + 1; trail.push(from); ti++ }
    trail.length = ti + 1
    trail.push(to)
    ti++
    syncTrail()
  }
  function syncTrail () {
    const e = trail[ti]
    trailRow.hidden = !trail.length
    backBtn.disabled = ti <= 0
    fwdBtn.disabled = ti >= trail.length - 1
    trailText.replaceChildren()
    if (e) {
      if (e.name) trailText.append(el(doc, 'b', null, e.name), ' · ' + e.label)
      else trailText.append(e.view !== 'tree' ? 'Back in the ' + e.view + ' view' : e.segs ? 'Back at ' + pathOf(e.segs) : 'Back where you were')
    }
    stepBtn.hidden = !(e && e.ref && ldx.refs.get(e.ref).length > 1)
    syncHeight()
  }
  let flashTimer = 0
  function flash (item) {
    const old = root.querySelector('.jv-flash')
    if (old) old.classList.remove('jv-flash')
    void item.offsetWidth // restart the animation on the same row
    item.classList.add('jv-flash')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => item.classList.remove('jv-flash'), 1800)
  }
  V.flash = flash
  // Open the tree at segs: ancestors expanded, the row focused, in view and flashed
  function goSegs (segs, open, quiet) {
    if (V.state.mode === 'query') { q.value = ''; onInput(true) }
    show('tree')
    if (!quiet && trailRow.hidden) { trailRow.hidden = false; syncHeight() } // before scrolling: the toolbar is about to grow
    let node = mainTree.reveal(segs)
    if (!node && V.state.filter) { filterBtn.click(); node = mainTree.reveal(segs) } // the filter hid it
    if (!node) return null
    if (open) mainTree.open(node)
    if (quiet) { mainTree.setActive(node.el); V.setCurrent(node) } else mainTree.focus(node.el)
    node.el.firstChild.scrollIntoView({ block: open && node.branch ? 'start' : 'center' }) // a definition: its properties below it
    flash(node.el)
    return node
  }
  function trailGo (step) {
    const e = trail[ti + step]
    if (!e) return false
    ti += step
    if (e.view === 'tree' && e.segs) goSegs(e.segs, false)
    else { show(e.view); win.scrollTo(0, e.y) }
    syncTrail()
    return true
  }
  // from: { segs } when the link sits in the main tree; anything else comes back by scroll position
  V.ldGoto = (iri, from) => {
    const defs = ldx && ldx.defs.get(iri)
    if (!defs) return false
    const origin = mark(from && from.segs)
    const target = defs[0].segs.length ? defs[0].segs : defs[0].idSegs // a document that is one node: its @id row
    if (!goSegs(target, true)) return false
    const n = (ldx.refs.get(iri) || []).length
    record(origin, { view: 'tree', segs: target, y: 0, name: shortIri(iri, here), label: 'defined here' + (n ? ', ' + plural(n, 'reference', 'references') : '') })
    return true
  }
  // Step through the places that point to a node, one more each time
  const stepAt = new Map()
  V.ldStep = (iri, from) => {
    const list = ldx && ldx.refs.get(iri)
    if (!list || !list.length) return false
    const origin = from && from.segs ? mark(from.segs) : trail[ti] || mark(null)
    const i = ((stepAt.has(iri) ? stepAt.get(iri) : -1) + 1) % list.length
    if (!goSegs(list[i], false)) return false
    stepAt.set(iri, i)
    record(origin, { view: 'tree', segs: list[i], y: 0, name: shortIri(iri, here), label: 'reference ' + fmt(i + 1) + ' of ' + fmt(list.length), ref: iri })
    return true
  }
  // Linked documents fetched for "peek": one request a document, however often it is opened
  const peeks = new Map()
  V.peekDoc = (url) => {
    let p = peeks.get(url)
    if (!p) {
      p = fetchPeek(V.host.fetch, url)
      peeks.set(url, p)
      p.then(r => { if (r.error) peeks.delete(url) }) // a failure may be tried again
    }
    return p
  }
  // The full URL of a link, shown when the keyboard lands on it (the mouse gets it as the title)
  const tip = el(doc, 'div', 'jv-tip')
  tip.hidden = true
  tip.setAttribute('aria-hidden', 'true')
  root.appendChild(tip)
  let tipAt = 0
  const hideTip = () => { tip.hidden = true }
  root.addEventListener('focusin', e => {
    const a = e.target
    if (!a || !a.__jvIri || !a.classList.contains('jv-ref')) return
    try { if (!a.matches(':focus-visible')) return } catch (err) {}
    tip.textContent = a.__jvIri
    tip.hidden = false
    tipAt = performance.now()
    const r = a.getBoundingClientRect()
    const vw = doc.documentElement.clientWidth
    tip.style.left = Math.max(8, Math.min(r.left, vw - tip.offsetWidth - 8)) + 'px'
    const below = r.bottom + 6
    tip.style.top = (below + tip.offsetHeight > (win.innerHeight || 800) ? Math.max(8, r.top - tip.offsetHeight - 6) : below) + 'px'
  })
  root.addEventListener('focusout', hideTip)
  win.addEventListener('scroll', () => { if (performance.now() - tipAt > 250) hideTip() }, { passive: true }) // not the scroll that brought the link into view

  // --- keys anywhere in the pane: / focuses the search, Esc clears it, Alt+Left / Alt+Right walk the trail, Alt+1 … Alt+4 set the level
  const onKey = (e) => {
    if (!root.isConnected) { doc.removeEventListener('keydown', onKey); return }
    const t = (e.composedPath && e.composedPath()[0]) || e.target // inside a shadow root, the real target
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // only when there is somewhere to go in the trail; otherwise the browser keeps its own Back
      if (!typing && trail.length && (root.contains(t) || t === doc.body || t === doc.documentElement) && trailGo(e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault()
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-4]$/.test(e.code || '')) { // Alt+1 … Alt+4: open the tree to that level
      if (!typing && V.state.mode !== 'query' && (root.contains(t) || t === doc.body || t === doc.documentElement)) { e.preventDefault(); setLevel(+e.code.slice(5)) }
      return
    }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); q.focus(); q.select() } else if (e.key === 'Escape' && !typing && root.contains(t) && q.value) { q.value = ''; onInput(true) }
  }
  doc.addEventListener('keydown', onKey)

  // Opened at a node's own URL (…/alex.jsonld#me): show that node
  if (ldx && uri.includes('#')) {
    const defs = ldx.defs.get(absUrl(uri, doc.baseURI) || uri)
    if (defs && defs[0].segs.length) { show('tree'); goSegs(defs[0].segs, true, true) }
  }

  if (!V.current) V.setCurrent(noRow)
  show('tree')
  updateCount()
  requestAnimationFrame(syncHeight)
}

// ---------------------------------------------------------------------------------------------
// Values: a primitive, with its smart preview

function paint (V, span) {
  const text = span.__jvText
  const term = V.state.mode === 'search' ? V.state.term : ''
  if (!term) { if (span.firstElementChild || span.textContent !== text) span.textContent = text; return }
  const lower = text.toLowerCase()
  const t = term.toLowerCase()
  let at = lower.indexOf(t)
  if (at < 0 || lower.length !== text.length) { span.textContent = text; return }
  const doc = V.doc
  span.textContent = ''
  let from = 0
  while (at >= 0) {
    if (at > from) span.appendChild(doc.createTextNode(text.slice(from, at)))
    span.appendChild(el(doc, 'mark', 'jv-mark', text.slice(at, at + t.length)))
    from = at + t.length
    at = lower.indexOf(t, from)
  }
  if (from < text.length) span.appendChild(doc.createTextNode(text.slice(from)))
}
function hl (V, span, text) {
  span.classList.add('jv-hl')
  span.__jvText = text
  paint(V, span)
  return span
}

// key: the value's own key; parentKey: its array's key (so items of "@type": [...] are types too);
// segs: the value's path in its document, which says whether a string is an @id that can be followed
function valueEl (V, v, key, parentKey, place, segs) {
  const doc = V.doc
  const t = typeOf(v)
  if (t === 'string') return stringEl(V, v, key, parentKey, place, segs)
  if (t === 'error') return errorEl(V, v)
  const wrap = el(doc, 'span', 'jv-val')
  const s = hl(V, el(doc, 'span', 'jv-' + t), t === 'null' ? 'null' : String(v))
  wrap.appendChild(s)
  if (t === 'number' && isBig(v)) {
    const c = el(doc, 'span', 'jv-chip jv-big', 'big')
    c.title = 'Shown exactly as written. A plain JavaScript number would read ' + String(v.num)
    wrap.appendChild(c)
  } else if (t === 'number') {
    const g = unixGuess(v, key)
    if (g && !isNaN(g.date)) {
      const c = el(doc, 'span', 'jv-chip jv-hint')
      c.append(icon(doc, 'clock', 12), el(doc, 'span', null, '≈ ' + humanDate(g.date)))
      c.title = 'If this is a Unix time in ' + g.unit + ': ' + g.date.toISOString() + ' (' + relative(g.date) + ')'
      wrap.appendChild(c)
    }
  }
  return wrap
}

// A line of a JSON Lines file that did not parse: where, why, and the start of what it says
function errorEl (V, v) {
  const doc = V.doc
  const wrap = el(doc, 'span', 'jv-val jv-lerr')
  wrap.title = 'Line ' + fmt(v.line) + (v.col ? ', column ' + fmt(v.col) : '') + ' does not parse. The other lines are not affected.'
  wrap.append(hl(V, el(doc, 'span', 'jv-lerr-msg'), 'line ' + fmt(v.line) + ': ' + v.message),
    hl(V, el(doc, 'span', 'jv-lerr-text'), v.text.length > LIMITS.errText ? v.text.slice(0, LIMITS.errText) + '…' : v.text))
  return wrap
}

function stringEl (V, s, key, parentKey, place, segs) {
  const doc = V.doc
  const wrap = el(doc, 'span', 'jv-val jv-string')
  const ldKey = V.ld ? (typeof key === 'string' ? key : parentKey) : null
  if (ldKey !== null && (V.ldx ? V.ldx.typeKeys.has(ldKey) : ldKey === '@type')) {
    const b = hl(V, el(doc, 'span', 'jv-badge'), s)
    b.title = '@type ' + s
    wrap.appendChild(b)
    return wrap
  }
  const role = V.ld && V.ldx && segs ? V.ldx.role.get(pkey(segs)) : undefined
  if (role) return idEl(V, s, role, place, segs)
  const limit = place === 'cell' ? LIMITS.cell : LIMITS.string
  let info = null
  if (ldKey === '@id') {
    const href = absUrl(s, V.base) // an @id the index does not cover (inside @context): a link only if it is http(s)
    if (href && RE_HTTP.test(href)) info = { kind: 'url', href, image: false, id: true }
  }
  if (!info) info = classify(s, V.base)
  const q1 = el(doc, 'span', 'jv-quote', '"')
  wrap.appendChild(q1)
  if (info && (info.kind === 'url' || info.kind === 'email')) {
    const a = hl(V, el(doc, 'a', 'jv-link'), s)
    a.href = info.kind === 'email' ? 'mailto:' + s : info.href
    if (info.kind === 'url') { a.target = '_blank'; a.rel = 'noopener noreferrer' }
    a.title = info.kind === 'email' ? 'Write to ' + s : (info.id ? '@id ' : '') + info.href + ' (opens in a new tab)'
    wrap.append(a, el(doc, 'span', 'jv-quote', '"'))
    if (info.kind === 'url' && info.image && V.images) wrap.appendChild(thumbButton(V, info.href, place))
    return wrap
  }
  if (info && info.kind === 'color') {
    const sw = el(doc, 'span', 'jv-swatch')
    sw.style.background = s
    sw.title = 'Colour ' + s
    wrap.insertBefore(sw, q1)
  }
  const textSpan = el(doc, 'span', 'jv-s')
  wrap.appendChild(textSpan)
  wrap.appendChild(el(doc, 'span', 'jv-quote', '"'))
  if (s.length > limit + 40) {
    const more = el(doc, 'button', 'jv-more')
    more.type = 'button'
    more.dataset.state = 'short'
    const set = (full) => {
      hl(V, textSpan, full ? s : s.slice(0, limit) + '…')
      more.dataset.state = full ? 'full' : 'short'
      more.textContent = full ? 'less' : 'more · ' + fmt(s.length) + ' chars'
    }
    more.addEventListener('click', e => { e.stopPropagation(); set(more.dataset.state === 'short') })
    set(false)
    wrap.appendChild(more)
  } else hl(V, textSpan, s)
  if (info && info.kind === 'date') {
    const c = el(doc, 'span', 'jv-chip jv-date')
    c.append(icon(doc, 'clock', 12), el(doc, 'span', null, humanDate(info.date, info.dateOnly)))
    const rel = relative(info.date)
    c.title = (rel ? rel + ' · ' : '') + (info.dateOnly ? info.date.toDateString() : info.date.toString())
    wrap.appendChild(c)
  }
  return wrap
}

// An @id that the index knows: the id of a node defined here, or a reference to a node.
//   defined in this document  -> a link that jumps to the definition in the tree;
//   another document (http)   -> a link the host opens in place, with "peek" beside it;
//   anything else             -> plain text (other schemes are never navigated to).
// Every link keeps a real href, so Ctrl / Cmd / middle click and "copy link" work as usual.
function idEl (V, s, role, place, segs) {
  const doc = V.doc
  const main = V.main
  const inMain = main === V
  const mx = main.ldx
  const wrap = el(doc, 'span', 'jv-val jv-string')
  const iri = V.ldx.resolve(s)
  const defined = !!(iri && mx && mx.defs.has(iri))
  const isDef = role === 'def' && inMain && defined
  const http = !!iri && RE_HTTP.test(iri)
  const sameDoc = !!iri && !!mx && (docOf(iri) === mx.doc || docOf(iri) === docOf(mx.base))
  wrap.appendChild(el(doc, 'span', 'jv-quote', '"'))
  const plain = (e) => !e.defaultPrevented && !e.button && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
  const from = () => inMain && place !== 'cell' ? { segs } : null

  if (s === '') { // "@id": "" is the document itself: said in words, with no empty link
    wrap.appendChild(el(doc, 'span', 'jv-quote', '"'))
    const note = el(doc, 'span', 'jv-chip jv-hint jv-thisdoc', 'this document')
    note.title = 'An empty @id is the document itself' + (iri ? ': ' + iri : '')
    wrap.appendChild(note)
    return wrap
  }

  if (!defined && !(http && !sameDoc)) { // nothing to follow
    const t = hl(V, el(doc, 'span', 'jv-s jv-idtext'), s)
    t.title = !iri ? '@id ' + s : sameDoc ? 'No node in this document has the @id ' + iri : '@id ' + iri
    wrap.append(t, el(doc, 'span', 'jv-quote', '"'))
    return wrap
  }

  const a = hl(V, el(doc, 'a', 'jv-link jv-ref ' + (isDef ? 'jv-self' : defined ? 'jv-local' : 'jv-xdoc')), s)
  a.__jvIri = iri
  if (http || /^file:/i.test(iri)) a.href = iri
  else { // an id with no address (a blank node, a urn:) that is defined here: a link by role only
    a.tabIndex = 0
    a.setAttribute('role', 'link')
    a.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); a.click() } })
  }
  wrap.append(a, el(doc, 'span', 'jv-quote', '"'))

  if (isDef) {
    const item = () => a.closest('.jv-item')
    a.title = '@id ' + iri + ' · this node is defined here'
    a.addEventListener('click', e => {
      if (!plain(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (place === 'cell' || !item()) main.ldGoto(iri, null) // from the table: show the node in the tree
      else main.flash(item())
    })
    if (place !== 'cell') {
      const chip = el(doc, 'span', 'jv-chip jv-def')
      chip.append(icon(doc, 'target', 12), el(doc, 'span', null, 'defined here'))
      chip.title = 'This node is defined here: ' + iri
      wrap.appendChild(chip)
      const n = (mx.refs.get(iri) || []).length
      if (n) {
        const node = segs.length > 1 ? segs.slice(0, -1) : segs
        const b = button(doc, 'jv-refs', 'link', plural(n, 'reference', 'references'), (n === 1 ? 'One place points' : fmt(n) + ' places point') + ' to this node. Click to go to ' + (n === 1 ? 'it' : 'the next one'),
          e => { e.stopPropagation(); main.ldStep(iri, { segs: node }) })
        wrap.appendChild(b)
      }
    }
    return wrap
  }

  if (defined) {
    a.title = '@id ' + iri + ' · defined in this document: click to jump to it'
    a.addEventListener('click', e => {
      if (!plain(e)) return
      e.preventDefault()
      e.stopPropagation()
      main.ldGoto(iri, from())
    })
    return wrap
  }

  a.title = '@id ' + iri + ' · another document: click to open it here, Ctrl-click for a new tab'
  a.addEventListener('click', e => {
    if (!plain(e)) return
    e.stopPropagation()
    if (main.host.go(iri)) e.preventDefault() // otherwise the href is followed, in this tab
  })
  if (RE_IMG.test(iri)) { if (V.images && place !== 'prev') wrap.appendChild(thumbButton(V, iri, place)) } // a picture: its preview, not a peek
  else if (main.host.peek && main.host.fetch && place === 'tree' && role === 'ref') wrap.appendChild(peekButton(V, iri, s, wrap))
  return wrap
}

// "peek": fetch the other document (on this click, never before) and show the node under the link
function peekButton (V, iri, s, wrap) {
  const doc = V.doc
  const main = V.main
  const url = docOf(iri)
  const b = button(doc, 'jv-peek', 'eye', 'peek', 'Peek: fetch ' + url + ' and show this node here')
  b.setAttribute('aria-expanded', 'false')
  let box = null
  const close = () => { if (box) box.remove(); box = null; b.setAttribute('aria-expanded', 'false') }
  b.addEventListener('click', e => {
    e.stopPropagation()
    if (box) return close()
    box = el(doc, 'div', 'jv-peekbox')
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', 'Peek at ' + iri)
    const head = el(doc, 'div', 'jv-peekhead')
    const src = el(doc, 'a', 'jv-peeksrc', shortIri(url, ''))
    src.href = url
    src.target = '_blank'
    src.rel = 'noopener noreferrer'
    src.title = url + ' (opens in a new tab)'
    const what = el(doc, 'span', 'jv-peekwhat', 'fetching…')
    what.setAttribute('aria-live', 'polite')
    head.append(el(doc, 'span', null, 'from'), src, what, button(doc, 'jv-pclose', 'close', 'close', 'Close the peek', ev => { ev.stopPropagation(); close(); b.focus() }))
    const body = el(doc, 'div', 'jv-peekbody')
    body.appendChild(el(doc, 'div', 'jv-peekmsg', 'Fetching ' + url + ' …'))
    box.append(head, body)
    ;(b.closest('.jv-item') || b.closest('.jv-res-body') || wrap.parentNode).appendChild(box)
    b.setAttribute('aria-expanded', 'true')
    const mine = box
    main.peekDoc(url).then(r => {
      if (box !== mine) return // closed meanwhile
      if (r.error) {
        box.classList.add('jv-peekbad')
        what.textContent = ''
        body.replaceChildren(el(doc, 'div', 'jv-peekmsg', r.error))
        body.firstChild.setAttribute('role', 'alert')
        return
      }
      const defs = r.ldx.defs.get(iri)
      const at = defs ? defs[0].segs : []
      what.textContent = defs ? '· node ' + shortIri(iri, url) : iri === url ? '· the whole document' : '· no node there has this @id: the whole document'
      // the other document's own state: its ids resolve against its URL, its paths are its own
      const PV = Object.create(main)
      PV.base = url
      PV.ld = true
      PV.ldx = r.ldx
      PV.setCurrent = () => {}
      PV.showInTree = () => main.toast('That value is in the other document')
      body.replaceChildren(makeTree(PV, getAt(r.data, at), at, { label: 'Peek at ' + iri, autoRows: 30, mini: true }).el)
    })
  })
  return b
}

// A small button beside an image link: hover shows a floating preview, a click opens it inline.
function thumbButton (V, href, place) {
  const doc = V.doc
  const b = el(doc, 'button', 'jv-thumb')
  b.type = 'button'
  b.title = 'Preview the image'
  b.setAttribute('aria-label', 'Preview the image')
  b.setAttribute('aria-expanded', 'false')
  b.appendChild(icon(doc, 'image', 15))
  let img = null
  b.addEventListener('mouseenter', () => { if (!img) V.showPop(b, href) })
  b.addEventListener('mouseleave', V.hidePop)
  b.addEventListener('click', e => {
    e.stopPropagation()
    V.hidePop()
    if (img) { img.remove(); img = null; b.setAttribute('aria-expanded', 'false'); return }
    img = el(doc, 'img', 'jv-ithumb')
    img.alt = 'Preview of ' + href
    img.loading = 'lazy'
    img.src = href
    img.addEventListener('error', () => { img.alt = 'The image did not load'; img.style.minHeight = '40px' })
    b.parentNode.appendChild(img)
    b.setAttribute('aria-expanded', 'true')
  })
  return b
}

function previewText (v) {
  const max = LIMITS.preview
  const prim = x => x === null ? 'null' : typeof x === 'string' ? '"' + (x.length > 24 ? x.slice(0, 24) + '…' : x) + '"' : isBranch(x) ? (Array.isArray(x) ? '[…]' : '{…}') : String(x)
  let out = ''
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const part = (i ? ', ' : '') + prim(v[i])
      if (out.length + part.length > max) return '[' + out + ', …]'
      out += part
    }
    return '[' + out + ']'
  }
  let first = true
  for (const k in v) {
    const part = (first ? '' : ', ') + k + ': ' + prim(v[k])
    if (out.length + part.length > max) return '{' + out + (first ? '…' : ', …') + '}'
    out += part
    first = false
  }
  return '{' + out + '}'
}

function rangeLabel (b) {
  const entries = b.owner.entries
  const a = entries[b.from]
  const z = entries[b.to - 1]
  return Array.isArray(b.owner.value) ? '[' + fmt(a) + ' … ' + fmt(z) + ']' : a + ' … ' + z
}

// ---------------------------------------------------------------------------------------------
// The tree: lazy, with ranges for big containers, and ARIA tree keyboard navigation

function makeTree (V, value, segs, opts) {
  const doc = V.doc
  const tree = el(doc, 'div', 'jv-tree')
  tree.setAttribute('role', 'tree')
  tree.setAttribute('aria-label', opts.label || 'JSON tree')
  const T = { el: tree, root: null, active: null }
  const B = LIMITS.bucket
  const EMPTY = new Set()

  function newRoot () {
    return { kind: 'value', key: undefined, value, segs, level: 0, expanded: true, group: tree, children: null, el: null, owner: null, full: false }
  }
  const filtering = () => !opts.mini && V.state.filter && V.match
  function entriesOf (node) {
    if (node.entries) return node.entries
    const v = node.value
    const set = filtering() && !node.full ? (V.match.anc.get(pkey(node.segs)) || EMPTY) : null
    let keys
    if (Array.isArray(v)) {
      if (set) keys = [...set].filter(k => typeof k === 'number').sort((a, b) => a - b)
      else { keys = new Array(v.length); for (let i = 0; i < v.length; i++) keys[i] = i }
    } else {
      keys = Object.keys(v)
      if (set) keys = keys.filter(k => set.has(k))
    }
    node.entries = keys
    return keys
  }
  function sizeOf (node) {
    if (node.size == null) node.size = Array.isArray(node.value) ? node.value.length : Object.keys(node.value).length
    return node.size
  }
  function child (owner, k, level) {
    const s = owner.segs.concat([k])
    const n = { kind: 'value', key: k, value: owner.value[k], segs: s, level, owner, expanded: false, group: null, children: null, el: null }
    n.full = !!(owner.full || (filtering() && V.match.full.has(pkey(s))))
    return n
  }
  function bucketSize (count) { let size = B; while (count / size > B) size *= B; return size }
  function childrenSpec (node) {
    const owner = node.kind === 'bucket' ? node.owner : node
    const entries = entriesOf(owner)
    const from = node.kind === 'bucket' ? node.from : 0
    const to = node.kind === 'bucket' ? node.to : entries.length
    const count = to - from
    const out = []
    if (count <= B) {
      for (let i = from; i < to; i++) out.push(child(owner, entries[i], node.level + 1))
      return out
    }
    const size = bucketSize(count)
    for (let s = from; s < to; s += size) {
      out.push({ kind: 'bucket', owner, from: s, to: Math.min(s + size, to), level: node.level + 1, segs: owner.segs, expanded: false, group: null, children: null, el: null, branch: true })
    }
    return out
  }
  function childCount (node) {
    const n = node.kind === 'bucket' ? node.to - node.from : entriesOf(node).length
    return n <= B ? n : Math.ceil(n / bucketSize(n))
  }

  function renderItem (node) {
    const item = el(doc, 'div', 'jv-item')
    item.setAttribute('role', 'treeitem')
    item.setAttribute('aria-level', String(node.level))
    item.tabIndex = -1
    item.__jv = node
    node.el = item
    const row = el(doc, 'div', 'jv-row')
    const tog = el(doc, 'span', 'jv-tog')
    tog.setAttribute('aria-hidden', 'true')
    const line = el(doc, 'div', 'jv-line')
    row.append(tog, line)
    item.appendChild(row)
    const v = node.value
    if (node.kind === 'bucket') {
      node.branch = true
      line.append(el(doc, 'span', 'jv-range', rangeLabel(node)), el(doc, 'span', 'jv-count-chip', plural(node.to - node.from, Array.isArray(node.owner.value) ? 'item' : 'key', Array.isArray(node.owner.value) ? 'items' : 'keys')))
    } else {
      node.branch = isBranch(v) && sizeOf(node) > 0
      if (typeof node.key === 'number') {
        const ix = el(doc, 'span', 'jv-idx', String(node.key))
        if (V.lines && V === V.main && !opts.mini && node.segs.length === 1) ix.title = 'Record ' + fmt(node.key) + ', line ' + fmt(V.lines.lineNos[node.key])
        line.append(ix, el(doc, 'span', 'jv-colon', ':'))
        if (isErr(v)) item.classList.add('jv-errrow')
      }
      else if (typeof node.key === 'string') {
        const k = hl(V, el(doc, 'span', 'jv-key' + (V.ld && (node.key[0] === '@' || (V.ldx && (V.ldx.idKeys.has(node.key) || V.ldx.typeKeys.has(node.key)))) ? ' jv-ld' : '')), node.key)
        line.append(k, el(doc, 'span', 'jv-colon', ':'))
      }
      if (isBranch(v)) {
        const n = sizeOf(node)
        if (V.ld && isPlainObject(v)) {
          let tk = '@type'
          if (v[tk] == null && V.ldx) for (const k of V.ldx.typeKeys) if (v[k] != null) { tk = k; break }
          if (v[tk] != null) for (const ty of [].concat(v[tk]).slice(0, 4)) if (typeof ty === 'string') { const b = el(doc, 'span', 'jv-badge', ty); b.title = '@type ' + ty; line.appendChild(b) }
        }
        if (n === 0) line.appendChild(el(doc, 'span', 'jv-empty', Array.isArray(v) ? '[ ]' : '{ }'))
        else {
          line.appendChild(el(doc, 'span', 'jv-count-chip', countLabel(v, n)))
          const rk = n === 1 && V.ld ? soleRef(V, v, node.segs) : null
          if (rk !== null) { // only a reference: the link itself, while the row is closed
            const p = el(doc, 'span', 'jv-refprev', '→ ')
            p.appendChild(idEl(V, v[rk], 'ref', 'prev', node.segs.concat([rk])))
            line.appendChild(p)
          } else line.appendChild(el(doc, 'span', 'jv-prev', previewText(v)))
        }
      } else {
        line.appendChild(valueEl(V, v, node.key, node.owner && typeof node.owner.key === 'string' ? node.owner.key : null, 'tree', node.segs))
      }
      // row actions: copy value, copy path, and a table for arrays of objects
      const acts = el(doc, 'div', 'jv-acts')
      acts.append(button(doc, 'jv-act', 'copy', 'Copy', 'Copy the value', e => { e.stopPropagation(); V.copyValue(node.value) }),
        button(doc, 'jv-act', 'path', 'Path', 'Copy the path ' + pathOf(node.segs), e => { e.stopPropagation(); V.copyPath(node.segs) }))
      if (isTableable(v)) {
        const tb = button(doc, 'jv-act jv-act-table', 'table', 'Table', 'View as a table', e => { e.stopPropagation(); setTable(node, !node.tableOn); T.focus(item) })
        tb.setAttribute('aria-pressed', 'false')
        node.tableBtn = tb
        acts.appendChild(tb)
      }
      row.appendChild(acts)
    }
    if (node.branch) {
      tog.appendChild(icon(doc, 'chevron', 14))
      item.classList.add('jv-branch')
      item.setAttribute('aria-expanded', 'false')
    }
    return item
  }

  function expand (node) {
    if (!node.branch || node === T.root) return 0
    if (node.tableOn) setTable(node, false)
    if (node.expanded) return 0
    let added = 0
    if (!node.group) {
      node.children = childrenSpec(node)
      const g = el(doc, 'div', 'jv-group')
      g.setAttribute('role', 'group')
      const frag = doc.createDocumentFragment()
      for (const c of node.children) frag.appendChild(renderItem(c))
      g.appendChild(frag)
      node.el.appendChild(g)
      node.group = g
      added = node.children.length
    } else added = node.children.length
    node.group.hidden = false
    node.expanded = true
    node.el.setAttribute('aria-expanded', 'true')
    return added
  }
  function collapse (node) {
    if (!node.expanded || node === T.root) return
    if (node.group) node.group.hidden = true
    node.expanded = false
    node.el.setAttribute('aria-expanded', 'false')
  }
  const byHand = () => { if (!opts.mini && V.levelOff) V.levelOff() } // the tree no longer sits at a level
  function toggle (node) { byHand(); if (node.tableOn) { setTable(node, false); return } if (node.expanded) collapse(node); else expand(node) }

  function setTable (node, on) {
    if (on === !!node.tableOn) return
    node.tableOn = on
    node.tableBtn.setAttribute('aria-pressed', String(on))
    if (on) {
      if (node.group) node.group.hidden = true
      node.tableEl = el(doc, 'div', 'jv-inline-table')
      node.tableEl.appendChild(makeTable(V, node.value, node.segs))
      node.el.appendChild(node.tableEl)
      node.el.setAttribute('aria-expanded', 'true')
      node.expanded = false
    } else {
      if (node.tableEl) node.tableEl.remove()
      node.tableEl = null
      node.el.setAttribute('aria-expanded', 'false')
    }
  }

  function autoExpand (budget, onlyMatches) {
    let rows = T.root.children.length
    const queue = T.root.children.slice()
    while (queue.length) {
      const n = queue.shift()
      if (!n.branch || (n.kind === 'bucket' && !onlyMatches)) continue
      const c = childCount(n)
      if (rows + c > budget) { if (onlyMatches) continue; else break }
      rows += expand(n)
      for (const ch of n.children) queue.push(ch)
    }
  }

  T.rebuild = () => {
    byHand()
    T.root = newRoot()
    tree.replaceChildren()
    T.active = null
    if (!isBranch(value)) {
      const leaf = { kind: 'value', key: undefined, value, segs, level: 1, owner: null, expanded: false, group: null, children: null, el: null }
      T.root.children = [leaf]
      tree.appendChild(renderItem(leaf))
    } else {
      T.root.children = childrenSpec(T.root)
      const frag = doc.createDocumentFragment()
      for (const c of T.root.children) frag.appendChild(renderItem(c))
      tree.appendChild(frag)
      if (!T.root.children.length) tree.appendChild(el(doc, 'div', 'jv-note', Array.isArray(value) ? 'An empty array.' : 'An empty object.'))
      if (filtering()) autoExpand(LIMITS.filterRows, true)
      else autoExpand(opts.autoRows || LIMITS.autoRows, false)
    }
    const first = T.firstItem()
    if (first) setActive(first)
  }
  T.empty = (msg) => { tree.replaceChildren(el(doc, 'div', 'jv-note', msg)) }

  // Walk down to the node at segs, opening every node (and range) on the way
  T.reveal = (target) => {
    let node = T.root
    for (let j = segs.length; j < target.length; j++) {
      node = childFor(node, target[j])
      if (!node) return null
    }
    return node === T.root ? null : node
  }
  function childFor (node, key) {
    let cur = node
    for (let guard = 0; guard < 12; guard++) {
      if (cur !== T.root) expand(cur)
      const kids = cur.children
      if (!kids || !kids.length) return null
      if (kids[0].kind === 'bucket') {
        const entries = entriesOf(node)
        const pos = Array.isArray(node.value) && entries.length === node.value.length ? key : entries.indexOf(key)
        if (pos < 0) return null
        cur = kids.find(b => pos >= b.from && pos < b.to)
        if (!cur) return null
        continue
      }
      return kids.find(c => c.key === key) || null
    }
    return null
  }

  T.open = (node) => { expand(node) }
  // A peeked document is a tree inside this one: its rows are its own
  const owns = (item) => !!item && item.closest('.jv-tree') === tree

  T.expandAll = (budget) => {
    let rows = tree.querySelectorAll('.jv-item').length
    const queue = T.root.children.slice()
    let limited = false
    while (queue.length) {
      const n = queue.shift()
      if (!n.branch) continue
      if (!n.expanded) {
        if (rows + childCount(n) > budget) { limited = true; continue }
        rows += expand(n)
      }
      for (const c of n.children || []) queue.push(c)
    }
    return { limited }
  }
  T.collapseAll = () => {
    const walk = (n) => { if (n.children) for (const c of n.children) walk(c); if (n.tableOn) setTable(n, false); collapse(n) }
    for (const c of T.root.children) walk(c)
    const a = T.active
    if (a && !visible(a)) setActive(topOf(a))
  }
  // Open everything down to a depth and close anything deeper, in document order. A node of depth d
  // (the top rows are 1) is open when d < depth. Ranges are passed through: one is opened only when
  // the rows in it are to be opened too. No more than budget rows are shown: after that nothing new
  // opens, so the first part of the file is at the level and the rest stays closed.
  T.toLevel = (depth, budget) => {
    let rows = T.root.children.length
    let limited = false
    const base = segs.length
    const walk = (list) => {
      for (const n of list) {
        if (!n.branch) continue
        const range = n.kind === 'bucket'
        const want = (range ? n.owner.segs.length - base + 1 : n.segs.length - base) < depth
        if (want && (!n.expanded || n.tableOn)) {
          if (limited || rows + childCount(n) > budget) limited = true
          else expand(n)
        } else if (!want && !range) {
          if (n.tableOn) setTable(n, false)
          collapse(n)
        }
        if (n.expanded) { rows += n.children.length; walk(n.children) }
      }
    }
    walk(T.root.children)
    const a = T.active
    if (a && !visible(a)) { setActive(topOf(a)); if (!opts.mini) V.setCurrent(T.active.__jv) }
    return { limited, rows }
  }

  // --- focus and keys
  function visible (item) { for (let p = parentItem(item); p; p = parentItem(p)) if (p.getAttribute('aria-expanded') !== 'true' || !p.__jv.expanded) return false; return true }
  function topOf (item) { let top = item; for (let p = parentItem(item); p; p = parentItem(p)) if (!p.__jv.expanded) top = p; return top }
  function parentItem (item) { const g = item.parentElement; return g && g.classList.contains('jv-group') ? g.parentElement : null }
  function openGroup (item) { const n = item.__jv; return n.expanded && n.group && !n.group.hidden ? n.group : null }
  function nextVisible (item) {
    const g = openGroup(item)
    if (g && g.firstElementChild) return g.firstElementChild
    for (let cur = item; cur; cur = parentItem(cur)) if (cur.nextElementSibling && cur.nextElementSibling.__jv) return cur.nextElementSibling
    return null
  }
  function lastVisible (item) { let cur = item; for (;;) { const g = openGroup(cur); if (!g || !g.lastElementChild) return cur; cur = g.lastElementChild } }
  function prevVisible (item) { const p = item.previousElementSibling; if (p && p.__jv) return lastVisible(p); return parentItem(item) }
  T.firstItem = () => { const f = tree.firstElementChild; return f && f.__jv ? f : null }

  function setActive (item) {
    if (T.active && T.active !== item) T.active.tabIndex = -1
    T.active = item
    item.tabIndex = 0
  }
  T.setActive = setActive
  T.focus = (item) => {
    if (!item) return
    setActive(item)
    item.focus({ preventScroll: true })
    item.firstChild.scrollIntoView({ block: 'nearest' })
    V.setCurrent(item.__jv)
  }
  tree.addEventListener('focusin', e => {
    const item = e.target.closest && e.target.closest('.jv-item')
    if (item === e.target && owns(item)) { setActive(item); V.setCurrent(item.__jv) }
  })
  tree.addEventListener('click', e => {
    const t = e.target
    if (t.closest('a, button, .jv-inline-table, .jv-ithumb')) return
    const item = t.closest('.jv-item')
    if (!owns(item)) return
    const sel = doc.getSelection && doc.getSelection()
    if (sel && !sel.isCollapsed && item.contains(sel.anchorNode)) return // selecting text, not clicking
    T.focus(item)
    if (item.__jv.branch) toggle(item.__jv)
  })
  tree.addEventListener('keydown', e => {
    const item = e.target
    if (!item.__jv || e.altKey || e.metaKey || !owns(item)) return
    const node = item.__jv
    let next = null
    switch (e.key) {
      case 'ArrowDown': next = nextVisible(item); break
      case 'ArrowUp': next = prevVisible(item); break
      case 'ArrowRight':
        if (node.branch && !node.expanded && !node.tableOn) { byHand(); expand(node) } else if (openGroup(item)) next = openGroup(item).firstElementChild
        break
      case 'ArrowLeft':
        if (node.tableOn) setTable(node, false)
        else if (node.expanded) { byHand(); collapse(node) } else next = parentItem(item)
        break
      case 'Home': next = T.firstItem(); break
      case 'End': next = tree.lastElementChild && tree.lastElementChild.__jv ? lastVisible(tree.lastElementChild) : null; break
      case 'Enter': case ' ': {
        const ref = e.key === 'Enter' && !node.branch ? item.querySelector(':scope > .jv-row a.jv-ref') : null
        if (ref) ref.click() // a row that is a reference: follow it
        else if (node.branch) toggle(node)
        break
      }
      case 'c': case 'C':
        if (!(e.ctrlKey || e.metaKey)) return
        if (String(doc.getSelection && doc.getSelection()).length) return
        if (node.kind !== 'bucket') V.copyValue(node.value)
        break
      default: return
    }
    e.preventDefault()
    if (next) T.focus(next)
  })

  T.rebuild()
  return T
}

// ---------------------------------------------------------------------------------------------
// The table: union of keys as columns, sortable, a page at a time

const collator = (() => { try { return new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) } catch (e) { return null } })()
const RANK = { number: 0, string: 1, boolean: 2, null: 3, array: 4, object: 5, error: 6 }
function compareCells (a, b) {
  const ta = typeOf(a)
  const tb = typeOf(b)
  if (ta !== tb) return RANK[ta] - RANK[tb]
  if (ta === 'number') {
    const d = a - b
    if (d || !(isBig(a) || isBig(b))) return d
    const x = String(a); const y = String(b) // equal as doubles: compare big integers exactly
    if (/^-?\d+$/.test(x) && /^-?\d+$/.test(y)) { const bx = BigInt(x); const by = BigInt(y); return bx < by ? -1 : bx > by ? 1 : 0 }
    return 0
  }
  if (ta === 'string') return collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0)
  if (ta === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0)
  if (ta === 'array') return a.length - b.length
  if (ta === 'object') return Object.keys(a).length - Object.keys(b).length
  return 0
}

function makeTable (V, arr, segs) {
  const doc = V.doc
  const box = el(doc, 'div', 'jv-tablebox')
  const cols = []
  const seen = new Set()
  let prims = false
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i]
    if (isPlainObject(r)) { for (const k in r) if (!seen.has(k) && cols.length < 200) { seen.add(k); cols.push(k) } } else if (!isErr(r)) prims = true
  }
  const VALUE = { value: true } // the column for items that are not objects
  const columns = prims ? [VALUE, ...cols] : cols
  const scroll = el(doc, 'div', 'jv-tscroll')
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  scroll.setAttribute('aria-label', 'Table of ' + pathOf(segs))
  const table = el(doc, 'table', 'jv-table')
  const thead = el(doc, 'thead')
  const htr = el(doc, 'tr')
  const tbody = el(doc, 'tbody')
  let order = null
  let sortCol = -1
  let dir = 1
  let page = 0
  const pages = Math.max(1, Math.ceil(arr.length / LIMITS.tablePage))
  const cell = (r, c) => isErr(r) ? undefined : c === VALUE ? (isPlainObject(r) ? undefined : r) : (isPlainObject(r) && Object.prototype.hasOwnProperty.call(r, c) ? r[c] : undefined)

  const no = el(doc, 'th')
  no.appendChild(el(doc, 'span', 'jv-sort', '#'))
  no.firstChild.style.cursor = 'default'
  htr.appendChild(no)
  const ths = columns.map((c, ci) => {
    const th = el(doc, 'th')
    th.setAttribute('aria-sort', 'none')
    const b = el(doc, 'button', 'jv-sort')
    b.type = 'button'
    b.append(el(doc, 'span', null, c === VALUE ? '(value)' : c), icon(doc, 'sort', 14))
    b.title = 'Sort by ' + (c === VALUE ? 'value' : c)
    b.addEventListener('click', () => sortBy(ci))
    th.appendChild(b)
    htr.appendChild(th)
    return th
  })
  thead.appendChild(htr)
  table.append(thead, tbody)
  scroll.appendChild(table)

  const pager = el(doc, 'div', 'jv-pager')
  const info = el(doc, 'span', 'jv-pinfo')
  const prev = button(doc, 'jv-btn', 'up', 'Previous', 'Previous page', () => { page--; draw(); scroll.scrollTop = 0 })
  const next = button(doc, 'jv-btn', 'down', 'Next', 'Next page', () => { page++; draw(); scroll.scrollTop = 0 })
  prev.firstChild.style.transform = 'rotate(-90deg)'
  next.firstChild.style.transform = 'rotate(-90deg)'
  pager.append(info, prev, next)
  box.append(scroll, pager)

  function sortBy (ci) {
    if (sortCol === ci) { if (dir === 1) dir = -1; else { sortCol = -1; dir = 1 } } else { sortCol = ci; dir = 1 }
    ths.forEach((th, i) => {
      const b = th.firstChild
      const on = i === sortCol
      th.setAttribute('aria-sort', on ? (dir === 1 ? 'ascending' : 'descending') : 'none')
      if (on) b.dataset.dir = dir === 1 ? 'asc' : 'desc'; else delete b.dataset.dir
      b.replaceChild(icon(doc, on ? (dir === 1 ? 'asc' : 'desc') : 'sort', 14), b.lastChild)
    })
    if (sortCol < 0) order = null
    else {
      const c = columns[sortCol]
      order = new Array(arr.length)
      for (let i = 0; i < arr.length; i++) order[i] = i
      order.sort((a, b) => {
        const x = cell(arr[a], c)
        const y = cell(arr[b], c)
        if (x === undefined || y === undefined) return x === y ? a - b : x === undefined ? 1 : -1 // missing last, either way
        return dir * compareCells(x, y) || a - b
      })
    }
    page = 0
    draw()
  }

  function draw () {
    const start = page * LIMITS.tablePage
    const end = Math.min(arr.length, start + LIMITS.tablePage)
    const frag = doc.createDocumentFragment()
    for (let p = start; p < end; p++) {
      const i = order ? order[p] : p
      const r = arr[i]
      const tr = el(doc, 'tr')
      tr.appendChild(el(doc, 'td', 'jv-rowno', String(i)))
      if (isErr(r)) { // a line that did not parse: one cell across the row
        const td = el(doc, 'td', 'jv-errcell')
        td.colSpan = Math.max(1, columns.length)
        td.appendChild(errorEl(V, r))
        tr.appendChild(td)
        frag.appendChild(tr)
        continue
      }
      for (const c of columns) {
        const v = cell(r, c)
        const td = el(doc, 'td')
        const at = segs.concat(c === VALUE ? [i] : [i, c])
        const rk = v !== undefined && V.ld ? soleRef(V, v, at) : null
        if (v === undefined) { td.className = 'jv-missing'; td.textContent = '—' } else if (rk !== null) {
          td.appendChild(idEl(V, v[rk], 'ref', 'cell', at.concat([rk]))) // {"@id": …}: the link itself
        } else if (isBranch(v)) {
          const n = Array.isArray(v) ? v.length : Object.keys(v).length
          const b = el(doc, 'button', 'jv-nest', (Array.isArray(v) ? '[ ' : '{ ') + countLabel(v, n) + (Array.isArray(v) ? ' ]' : ' }'))
          b.type = 'button'
          b.title = 'Show ' + pathOf(segs.concat(c === VALUE ? [i] : [i, c])) + ' in the tree'
          b.addEventListener('click', () => V.showInTree(segs.concat(c === VALUE ? [i] : [i, c])))
          td.appendChild(b)
        } else {
          if (typeof v === 'string' && v.length > 48) td.className = 'jv-wrap'
          td.appendChild(valueEl(V, v, c === VALUE ? i : c, null, 'cell', at))
        }
        tr.appendChild(td)
      }
      frag.appendChild(tr)
    }
    tbody.replaceChildren(frag)
    info.textContent = arr.length ? 'Rows ' + fmt(start + 1) + '–' + fmt(end) + ' of ' + fmt(arr.length) + ' · ' + plural(columns.length, 'column', 'columns') : 'No rows'
    prev.disabled = page <= 0
    next.disabled = page >= pages - 1
    prev.hidden = next.hidden = pages <= 1
  }
  draw()
  return box
}

// ---------------------------------------------------------------------------------------------
// Raw text: numbered, coloured, pretty-printed or as it came, a page of lines at a time

const RAW_TOKENS = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g
function rawLine (doc, no, line) {
  const row = el(doc, 'div', 'jv-ln')
  row.appendChild(el(doc, 'span', 'jv-no', String(no)))
  const code = el(doc, 'span', 'jv-code')
  let s = line
  let rest = 0
  if (s.length > LIMITS.rawLine) { rest = s.length - LIMITS.rawLine; s = s.slice(0, LIMITS.rawLine) }
  let last = 0
  RAW_TOKENS.lastIndex = 0
  let m
  while ((m = RAW_TOKENS.exec(s))) {
    if (m.index > last) code.appendChild(doc.createTextNode(s.slice(last, m.index)))
    if (m[1] != null) {
      code.appendChild(el(doc, 'span', m[2] ? 'k' : 's', m[1]))
      if (m[2]) code.appendChild(el(doc, 'span', 'p', m[2]))
    } else if (m[3] != null) code.appendChild(el(doc, 'span', 'n', m[3]))
    else if (m[4] != null) code.appendChild(el(doc, 'span', 'b', m[4]))
    else if (m[5] != null) code.appendChild(el(doc, 'span', 'z', m[5]))
    else code.appendChild(el(doc, 'span', 'p', m[6]))
    last = m.index + m[0].length
  }
  if (last < s.length) code.appendChild(doc.createTextNode(s.slice(last)))
  if (!line) code.textContent = ' '
  if (rest) {
    const more = el(doc, 'button', 'jv-more', '… ' + fmt(rest) + ' more characters')
    more.type = 'button'
    more.addEventListener('click', () => { more.remove(); code.appendChild(doc.createTextNode(line.slice(LIMITS.rawLine))) })
    code.appendChild(more)
  }
  row.appendChild(code)
  return row
}

function makeRaw (V) {
  const doc = V.doc
  const box = el(doc, 'div')
  const head = el(doc, 'div', 'jv-rawhead')
  const seg = el(doc, 'div', 'jv-tabs')
  seg.setAttribute('role', 'radiogroup')
  seg.setAttribute('aria-label', 'Text')
  const info = el(doc, 'span', 'jv-rawinfo')
  head.append(seg, info)
  const lines = el(doc, 'div', 'jv-raw')
  lines.setAttribute('role', 'region')
  lines.setAttribute('aria-label', 'Raw JSON')
  const more = button(doc, 'jv-btn jv-rawmore', 'down', 'Show more lines', null, () => page())
  box.append(head, lines)
  const L = V.lines
  let bad = null
  if (L && L.errors) { bad = new Map(); for (const r of V.data) if (isErr(r)) bad.set(r.line, r.message) }
  if (L) seg.hidden = true // one record a line is the format: no pretty-printing
  let mode = L ? 'original' : 'pretty'
  let text = ''
  let pos = 0
  let no = 0
  let total = 0
  const modes = {}
  for (const [id, label] of [['pretty', 'Pretty'], ['original', 'Original']]) {
    const b = el(doc, 'button', 'jv-tab', label)
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.addEventListener('click', () => { mode = id; start() })
    modes[id] = b
    seg.appendChild(b)
  }
  function start () {
    for (const id of Object.keys(modes)) modes[id].setAttribute('aria-checked', String(id === mode))
    text = mode === 'pretty' ? (V.pretty || (V.pretty = stringify(V.data, 2))) : V.text
    pos = 0
    no = 0
    total = 1
    for (let j = text.indexOf('\n'); j !== -1; j = text.indexOf('\n', j + 1)) total++
    lines.style.setProperty('--jv-nw', (String(total).length + 1) + 'ch')
    lines.replaceChildren()
    info.textContent = plural(total, 'line', 'lines') + ' · ' + humanBytes(text.length) + (mode === 'pretty' ? ' · two-space indent' : ' · as served') +
      (L ? ' · ' + plural(L.count, 'record', 'records') + (L.errors ? ' · ' + plural(L.errors, 'line does', 'lines do') + ' not parse' : '') : '')
    page()
  }
  function page () {
    const frag = doc.createDocumentFragment()
    for (let c = 0; c < LIMITS.rawPage && pos <= text.length; c++) {
      let end = text.indexOf('\n', pos)
      if (end === -1) end = text.length
      let line = text.slice(pos, end)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      const row = rawLine(doc, ++no, line)
      if (bad && bad.has(no)) { row.classList.add('jv-errline'); row.title = 'Line ' + fmt(no) + ': ' + bad.get(no) }
      frag.appendChild(row)
      pos = end + 1
    }
    lines.appendChild(frag)
    more.remove()
    if (pos <= text.length) {
      more.lastChild.textContent = 'Show ' + fmt(Math.min(LIMITS.rawPage, total - no)) + ' more lines (' + fmt(total - no) + ' left)'
      box.appendChild(more)
    }
  }
  start()
  return box
}

export default pane
