# Solid JSON Viewer (browser extension) 0.0.1

Opens JSON and JSON-LD responses in a viewer: a lazy tree, a sortable table, numbered raw text, search, a JSONPath box, a schema panel, exact big numbers, and JSON-LD `@type` badges and `@id` links. A **Viewer / Raw** switch in the bottom right corner goes back to the page as the browser showed it.

The viewer is [json-pane.js](https://solid-panes.github.io/json/), the same file the SolidOS data browser loads, copied in unchanged. A few lines in `content.js` give it the page's text instead of letting it fetch.

## Privacy

**No network requests, no data collected.**

- The extension fetches nothing. It reads the text the browser has already loaded and draws it on the same page.
- Picture previews are switched off, so hovering over an image link loads nothing. Links open only when you click them.
- No analytics, no remote code, no remote fonts. The only permission is `storage`, which keeps your two settings in this browser.
- The code is plain, unbundled JavaScript: what is in this folder is what runs.

## Install (unpacked)

### Chrome, Edge, Brave and other Chromium browsers

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder: `/home/melvin/scratch/2026-11-26-json-ext`.
4. To view local files, open the extension's **Details** and turn on **Allow access to file URLs**.

### Firefox 140 or later

1. Open `about:config` and set `devtools.jsonview.enabled` to `false`. Otherwise Firefox's own JSON viewer takes the page first.
2. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose `manifest.json` in this folder. A temporary add-on is removed when Firefox restarts.
3. Firefox treats `<all_urls>` as optional for Manifest V3 add-ons. If JSON pages are not taken over, open the add-on's **Permissions** tab in `about:addons` and allow it on all sites.

## Options

Right-click the toolbar icon (or open the extension's details) and choose **Options**:

- **Show JSON pages in the viewer**: on or off.
- **Largest file to open, in MB** (default 50). Bigger files are left as the browser shows them.

## What it opens

- Any response whose `Content-Type` is `application/json` or ends in `+json` (`application/ld+json`, `application/activity+json`, …), using JSONView's test `^application/([\w!#$&.\-^+]+\+)?json($|;)`.
- `text/plain` responses whose body is a single `<pre>` holding valid JSON (JSON Formatter's test, plus a parse).
- Nothing else. HTML pages, and text files that are not JSON, are left alone. An invalid JSON response gets an error card with the line and column.

## How it works

- `content.js` runs at `document_start` on every page and returns at once unless the content type matches. For a JSON page it hides the page (so the raw text does not flash), waits for the body, takes the text of the single `<pre>`, loads `json-pane.js` from the extension with `import()`, and draws it in place of the page. The original page is kept for **Raw**.
- The viewer is drawn inside a shadow root and styled with a constructed stylesheet. A strict page `Content-Security-Policy` (for example `default-src 'none'`) blocks `<style>` elements, but not this.
- `json-pane.js` is listed in `web_accessible_resources` so the content script can import it; a page can therefore tell the extension is installed.

## Files

| File | What |
|---|---|
| `manifest.json` | One Manifest V3 file for Chromium and Firefox (`browser_specific_settings.gecko`: id, `strict_min_version` 140.0, `data_collection_permissions` `["none"]`) |
| `content.js` | Detection, the shim, the Viewer / Raw switch |
| `json-pane.js` | The pane, copied unchanged by `node tools/copy-pane.mjs [path]` |
| `options.html`, `options.js`, `options.css` | The options page |
| `icons/` | `icon.svg` and the PNGs drawn from it by `node tools/make-icons.mjs` |

## Not done yet

- Firefox: rewriting the `Content-Type` header so the extension wins over Firefox's built-in viewer without the `about:config` change. It needs the `webRequest` and `webRequestBlocking` permissions, host permissions and a background script, so it is left out of 0.0.1 to keep the only permission `storage`.
- Tested in Chromium only (headless, unpacked). Not yet loaded in Firefox, and not yet run through `web-ext lint`.
- Response headers view and a `json` console global.

## Licence

[AGPL-3.0-or-later](LICENSE), copyright Melvin Carvalho.
