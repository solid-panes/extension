// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// content.js — runs at document_start on every page and does nothing unless the page is a JSON
// or JSON Lines response. Then it takes the text the browser already has (no second request), clears the page
// and draws json-pane.js (the same file as the SolidOS pane, unchanged) in its place, with a
// Viewer / Raw toggle. It makes no network requests and sends nothing anywhere.
(() => {
  // JSONView's content-type test: application/json and any +json (ld+json, activity+json, ...)
  const RE_JSON_TYPE = /^application\/([\w!#$&.\-^+]+\+)?json($|;)/i
  // JSON Lines / NDJSON, where the browser shows such a response as text at all
  const RE_LINES_TYPE = /^application\/(jsonl|x-ndjson|ndjson|json-seq|x-jsonlines|jsonlines)($|;)/i
  const type = String(document.contentType || '')
  const jsonType = RE_JSON_TYPE.test(type) || RE_LINES_TYPE.test(type)
  const plainType = /^text\/plain($|;)/i.test(type)
  if (!jsonType && !plainType) return
  if (window.top !== window && !jsonType) return // a framed text file: leave it alone

  const api = globalThis.browser || globalThis.chrome
  const html = document.documentElement
  const hide = jsonType // hide a JSON page at once so the raw text does not flash; plain text waits until it is known to be JSON
  if (hide && html) html.style.visibility = 'hidden'
  const show = () => { if (html) html.style.visibility = '' }

  const settings = api.storage.local.get({ enabled: true, maxMB: 50 }).catch(() => ({ enabled: true, maxMB: 50 }))
  const ready = new Promise(resolve => {
    if (document.readyState !== 'loading') resolve()
    else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
  })

  // JSON Formatter's page test: the body is one visible <pre> and nothing like prose around it
  // (Chrome's own "Pretty-print" container is ignored).
  function onlyPre () {
    const body = document.body
    if (!body) return null
    let pre = null
    for (const el of body.children) {
      if (el.classList.contains('json-formatter-container')) continue
      if (el.tagName === 'PRE' && !pre) { pre = el; continue }
      if (/^(PRE|P|H[1-6]|UL|OL|TABLE|FORM|ARTICLE|MAIN|SECTION)$/.test(el.tagName)) return null
      if (el.tagName !== 'DIV' && el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT') return null
    }
    return pre
  }

  ;(async () => {
    const [opts] = await Promise.all([settings, ready])
    const pre = onlyPre()
    if (!opts.enabled || !pre) return show()
    const text = pre.textContent
    if (text.length > Math.max(0.1, Number(opts.maxMB) || 50) * 1048576) return show()
    if (plainType) { // text/plain: only a body that is really JSON, or JSON Lines
      const c = text.trimStart()[0]
      if (c !== '{' && c !== '[') return show()
      try { JSON.parse(text) } catch (e) { if (!isLines(text)) return show() }
    }
    const { default: pane } = await import(api.runtime.getURL('json-pane.js'))

    // The shim: everything the pane needs from a host.
    const context = {
      dom: document,
      shadow: true, // styles as a constructed sheet inside a shadow root: page CSP cannot block them
      source: { text, contentType: type, url: location.href },
      imagePreviews: false, // no picture loads, even on hover: the extension makes no requests
      peek: false, // no "peek" at a linked document: that would be a request
      navigate: url => location.assign(url), // a link to another document: the browser goes there, as for any link
      session: { store: null }
    }
    const view = pane.render({ uri: location.href, doc () { return this } }, context)

    // Keep the browser's own page, for Raw
    const raw = document.createElement('div')
    raw.append(...document.body.childNodes)
    raw.hidden = true
    const bar = toggle(mode => { view.hidden = mode === 'raw'; raw.hidden = mode !== 'raw' })
    document.body.style.margin = '0'
    document.body.append(bar, view, raw)
    show()
  })().catch(e => { show(); console.warn('JSON viewer:', e) })

  // JSON Lines in a text/plain page: several lines, and every one that is not blank parses on its
  // own. (A page served as JSON or JSON Lines needs no such test: the pane shows a bad line in place.)
  function isLines (text) {
    let n = 0
    for (const line of text.split('\n')) {
      if (!/\S/.test(line)) continue
      try { JSON.parse(line) } catch (e) { return false }
      n++
    }
    return n >= 2
  }

  // A small fixed Viewer / Raw switch, in its own shadow root
  function toggle (onChange) {
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    const css = '.t{position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:2px;padding:3px;border-radius:12px;background:#eef0f4;' +
      'box-shadow:0 1px 3px rgba(20,30,60,.18);font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}' +
      'button{height:34px;min-width:64px;padding:0 14px;border:0;border-radius:9px;background:transparent;color:#4a5366;font:inherit;cursor:pointer}' +
      'button[aria-pressed="true"]{background:#fff;color:#141a29;box-shadow:0 1px 2px rgba(20,30,60,.12)}' +
      'button:focus-visible{outline:2.5px solid #2f6fde;outline-offset:2px}'
    try { const s = new CSSStyleSheet(); s.replaceSync(css); root.adoptedStyleSheets = [s] } catch (e) { const st = document.createElement('style'); st.textContent = css; root.append(st) }
    const box = document.createElement('div')
    box.className = 't'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', 'Show')
    const buttons = {}
    for (const [id, label] of [['viewer', 'Viewer'], ['raw', 'Raw']]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.dataset.mode = id
      b.setAttribute('aria-pressed', String(id === 'viewer'))
      b.addEventListener('click', () => {
        for (const k in buttons) buttons[k].setAttribute('aria-pressed', String(k === id))
        onChange(id)
      })
      buttons[id] = b
      box.append(b)
    }
    root.append(box)
    host.className = 'jsonviewer-toggle'
    return host
  }
})()
