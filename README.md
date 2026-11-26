# Solid JSON Viewer (browser extension) 0.0.3

A small **pane host** for the browser: it opens JSON, Markdown and mind map pages with the same panes the SolidOS data browser uses, bundled inside the extension.

- **JSON, JSON-LD and JSON Lines**: a lazy tree, a sortable table, numbered raw text, search, a JSONPath box, a schema panel, exact big numbers, Level 1–4, breadcrumbs, and JSON-LD `@type` badges and `@id` links.
- **Markdown notes**: a clean page with headings, lists, task boxes, tables, code and `[[links]]` to the note beside it.
- **Mindstr mind maps**: the map drawn from its JSON-LD, with pan and zoom; a node that links to another map opens it.

When more than one pane fits a page (a mind map is also JSON) there is a **tab bar** at the top, and the last choice is remembered. In the bottom right corner a **Viewer / Raw** switch goes back to the page as the browser showed it, and **Open in SolidOS** opens the same address in the [SolidOS data browser](https://solidos.org/docs/browser/).

Landing page: **https://solid-panes.github.io/extension/**

## The panes

Each pane is the file from its own repository, copied in byte for byte. All the adapting to a browser page is in `content.js`.

| Pane | File | Opens | Licence | Source |
|---|---|---|---|---|
| Mind map | `mindstr-pane.js` | A JSON page that is a Mindstr map: its top level has `nodes` and `connections` in the `https://mindstr.org/ns#` vocabulary (the pane's own test) | AGPL-3.0-or-later | https://github.com/solid-panes/mindstr |
| Notes | `notes-pane.js` | Markdown pages | MIT (`notes-pane.LICENSE`) | https://github.com/solid-panes/notes |
| JSON | `json-pane.js` | Any JSON or JSON Lines page | AGPL-3.0-or-later | https://github.com/solid-panes/json |

`panes.json` records the commit and SHA-256 of each copy. The order above is the order of the tabs: the most specific pane first. Each pane can be switched off in the options.

## Privacy

**No network requests, no data collected.**

Exactly what that means:

- **The extension requests nothing.** It reads the text the browser has already loaded and draws it on the same page. A pane that asks for the page's own address is answered from that text; a pane that asks for any other address is refused with an error, and nothing is sent. This covers `fetch`, which is the only way the three bundled panes ask for anything.
  - JSON pane: given the text directly. Its picture previews and its "peek" at a linked document are switched off.
  - Notes pane: its read of the note is answered from the page. Its read of the folder listing (for previous / next) and its check that a `[[link]]` exists are refused, so there is no previous / next, and a `[[name]]` link points at `name.md` beside the note without being checked.
  - Mind map pane: its read of the map is answered from the page.
- **Pictures in Markdown are not loaded.** The Notes pane does not draw pictures: `![a tree](https://example.org/tree.png)` is shown as `!` and a link with the text "a tree". The picture is requested only if you click the link, as with any link.
- **Links are ordinary links.** A link in a note, a node that opens another map and a link to another JSON document all load the new page in the normal way (`location.assign` or the link itself), and the extension then draws that page if it is a kind it knows. Links to other sites from a mind map open in a new tab. **Open in SolidOS** is a link to `https://solidos.org/docs/browser/?uri=` followed by the page's address: that site sees the address only if you click it. The link can be switched off in the options.
- **Styles load nothing.** The panes' CSS names no fonts or pictures to fetch, and the host takes out any `url(...)` or `@import` before it uses a pane's CSS.
- No analytics, no remote code, no remote fonts. The only permission is `storage`, which keeps your settings (on/off, largest file, panes switched off, the link, the last tab chosen) in this browser.
- The code is plain, unbundled JavaScript: what is in this folder is what runs.

## Install (unpacked)

Not in the Chrome or Firefox stores yet. Get the folder first: `git clone https://github.com/solid-panes/extension`, or download and unzip https://github.com/solid-panes/extension/archive/refs/heads/gh-pages.zip.

### Chrome, Edge, Brave and other Chromium browsers

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose that folder (the one with `manifest.json` in it).
4. To view local files, open the extension's **Details** and turn on **Allow access to file URLs**.

### Firefox 140 or later

1. Open `about:config` and set `devtools.jsonview.enabled` to `false`. Otherwise Firefox's own JSON viewer takes the page first.
2. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose `manifest.json` in this folder. A temporary add-on is removed when Firefox restarts.
3. Firefox treats `<all_urls>` as optional for Manifest V3 add-ons. If pages are not taken over, open the add-on's **Permissions** tab in `about:addons` and allow it on all sites.

## Options

Right-click the toolbar icon (or open the extension's details) and choose **Options**:

- **Show JSON, Markdown and mind map pages in the viewer**: on or off, for everything.
- **Largest file to open, in MB** (default 50). Bigger files are left as the browser shows them.
- **Show the "Open in SolidOS" link** (default on).
- **Panes**: the bundled panes, each with its licence, its source and an on/off switch. A pane switched off is never offered; a page with no pane left is shown as the browser shows it.

## What it opens

- **JSON**: any response whose `Content-Type` is `application/json` or ends in `+json` (`application/ld+json`, `application/activity+json`, …), using JSONView's test `^application/([\w!#$&.\-^+]+\+)?json($|;)`.
- **JSON as text**: `text/plain` responses whose body is a single `<pre>` holding valid JSON (JSON Formatter's test, plus a parse), or JSON Lines: several lines, each of which parses on its own.
- **JSON Lines**: `application/jsonl`, `application/x-ndjson`, `application/ndjson`, `application/json-seq`, `application/x-jsonlines`, where the browser shows them as a page (Chromium downloads content types it does not know, and a download never reaches an extension). A JSON Lines file served as `application/json` is taken over like any JSON page, and the viewer reads it line by line; there a line that does not parse is an error row in place.
- **Markdown**: `text/markdown` or `text/x-markdown`, or a `text/plain` page whose address ends in `.md` or `.markdown` (this is how raw.githubusercontent.com serves them).
- **Mind maps**: a JSON page that the Mind map pane accepts. The host hands the pane's own `label()` the names of the document's top-level keys, expanded with the document's inline `@context`; the pane says yes when `nodes` and `connections` are both in the Mindstr vocabulary. Such a page gets two tabs, Mind map and JSON.
- Nothing else. HTML pages, and text files that are neither JSON nor called `.md`, are left alone. An invalid JSON response gets an error card with the line and column.

## How it works

- `content.js` runs at `document_start` on every page and returns at once unless the content type matches. For a page it knows, it hides the page (so the raw text does not flash), waits for the body, takes the text of the single `<pre>`, loads the panes that could fit from the extension with `import()`, and asks each one's `label(subject, context)`. The first that fits is drawn in place of the page; the others are drawn when their tab is first chosen, and kept, so switching back is instant. The original page is kept for **Raw**.
- **The shim** gives every pane the same `subject` (`uri`, `value`, `doc()`) and `context`: `dom`; `session.store` with `sym`, `each`, `any`, `statementsMatching` and `fetcher._fetch` / `fetcher.load` (only what the three panes call); `getOutliner().GotoSubject` and `navigate`, both of which are `location.assign`; and the JSON pane's hooks `source`, `shadow`, `imagePreviews: false`, `peek: false`. The content script's own `fetch` is replaced by the same answer-from-the-page function, for a pane that calls `fetch` by name; the page's `fetch` is a different object and is not touched.
- **Styles under a strict page policy.** Every pane is drawn inside a shadow root. A pane puts its CSS in a `<style>` element, which a strict `Content-Security-Policy` (for example `default-src 'none'`) blocks; so before the pane goes into the page the host moves each `<style>` into a constructed stylesheet, which the policy allows, and watches for any added later. (The JSON pane does this for itself.) The tab icons are the panes' own SVG icons rebuilt as elements, since an `<img>` with a `data:` address would be blocked too.
- The three pane files are listed in `web_accessible_resources` so the content script can import them; a page can therefore tell the extension is installed.

## Files

| File | What |
|---|---|
| `manifest.json` | One Manifest V3 file for Chromium and Firefox (`browser_specific_settings.gecko`: id, `strict_min_version` 140.0, `data_collection_permissions` `["none"]`) |
| `content.js` | The host: detection, the shim, the tab bar, the Viewer / Raw switch |
| `pane-list.js` | The bundled panes, in order: name, file, what each opens, licence, source |
| `json-pane.js`, `notes-pane.js`, `mindstr-pane.js` | The panes, copied unchanged by `node tools/copy-pane.mjs` |
| `panes.json`, `notes-pane.LICENSE` | Written by the same tool: where each pane came from (repository, commit, SHA-256), and the Notes pane's MIT licence |
| `options.html`, `options.js`, `options.css` | The options page |
| `icons/` | `icon.svg` and the PNGs drawn from it by `node tools/make-icons.mjs` |

Not part of the extension (nothing in `manifest.json` refers to them; leave them out of a store package): `index.html` and `og.png` (the landing page and its share picture, served by GitHub Pages), `.nojekyll`, and the rest of `tools/` (`og.html`, `og.mjs`, `og-sample.json`, `og-emblem.svg`, `atkinson.woff2`; `node tools/og.mjs` redraws `og.png`).

## Changes

### 0.0.3

- A pane host: three panes bundled (JSON, Notes, Mind map), the right one chosen by the page.
- Markdown pages open in the Notes pane; Mindstr maps open in the Mind map pane, with JSON as a second tab.
- A tab bar when more than one pane fits; arrow keys move between tabs; the last choice is remembered.
- Options: a **Panes** list with an on/off switch for each.
- **Open in SolidOS**: a link beside the Viewer / Raw switch that opens the same address in the SolidOS data browser. It is only a link; it can be switched off.
- The Viewer / Raw buttons are 44 px high.
- Permissions unchanged: `storage` only. Still no network requests.

### 0.0.2

- JSON Lines / NDJSON: taken over by content type, or as `text/plain` when every line parses; shown as an array of records, with the table across records and the raw lines numbered. In a file served as JSON or JSON Lines, a bad line is an error row (`line 17: …`) and the header counts them (`12 lines · 1 error`).
- From the pane: **Level 1–4** (open the tree to a depth; <kbd>Alt</kbd>+<kbd>1</kbd> … <kbd>4</kbd> where the browser does not keep those keys for its tabs), **breadcrumbs** for the selected row (`$ › panes › 0 › name`, each one a jump), an empty `@id` shown as `""` · this document, and `id` / `type` and id-typed terms recognised for ActivityStreams, schema.org, security, DID and credentials contexts by their URL (nothing is fetched).
- Fixed, from the pane: the first click on a row could land on another row, because the path bar appeared under the pointer; a JSONPath such as `$.items[*].name` stopped after one result once a step reached 5,000 nodes.
- Permissions unchanged: `storage` only.

### 0.0.1

- First version: JSON and JSON-LD pages, Viewer / Raw switch, options.

## Not done yet

- Firefox: rewriting the `Content-Type` header so the extension wins over Firefox's built-in viewer without the `about:config` change. It needs the `webRequest` and `webRequestBlocking` permissions, host permissions and a background script, so it is left out to keep the only permission `storage`.
- Tested in Chromium only (headless, unpacked). Not yet loaded in Firefox, and not yet run through `web-ext lint`.
- Notes: previous / next and checked `[[links]]` need a folder listing, which would be a request, so they are not there.
- Response headers view and a `json` console global.

## Licence

The extension is [AGPL-3.0-or-later](LICENSE), copyright Melvin Carvalho. The bundled panes keep their own licences: `json-pane.js` and `mindstr-pane.js` are AGPL-3.0-or-later, `notes-pane.js` is MIT (see `notes-pane.LICENSE`).
