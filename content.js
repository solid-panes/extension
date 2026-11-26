// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// content.js — a small pane host. It runs at document_start on every page and does nothing unless
// the page is a JSON, JSON Lines or Markdown response. Then it takes the text the browser already
// has (no second request), asks the bundled SolidOS panes (pane-list.js) which of them fit, and
// draws the first in place of the page; when more than one fits there is a tab bar. A Viewer / Raw
// switch goes back to the page as the browser showed it. The pane files are unchanged copies; all
// the adapting is here. The host makes no network requests and sends nothing anywhere: a pane that
// fetches the page's own address is answered from the text on the page, and any other fetch is
// refused.
(() => {
  // JSONView's content-type test: application/json and any +json (ld+json, activity+json, ...)
  const RE_JSON_TYPE = /^application\/([\w!#$&.\-^+]+\+)?json($|;)/i
  // JSON Lines / NDJSON, where the browser shows such a response as text at all
  const RE_LINES_TYPE = /^application\/(jsonl|x-ndjson|ndjson|json-seq|x-jsonlines|jsonlines)($|;)/i
  const RE_MD_TYPE = /^text\/(x-)?markdown($|;)/i
  const RE_MD_PATH = /\.(md|markdown)$/i
  const type = String(document.contentType || '')
  const jsonType = RE_JSON_TYPE.test(type) || RE_LINES_TYPE.test(type)
  const mdType = RE_MD_TYPE.test(type)
  const plainType = /^text\/plain($|;)/i.test(type)
  if (!jsonType && !mdType && !plainType) return
  if (window.top !== window && !jsonType && !mdType) return // a framed text file: leave it alone

  const api = globalThis.browser || globalThis.chrome
  const html = document.documentElement
  const hide = jsonType || mdType // hide such a page at once so the raw text does not flash; plain text waits until it is known to be wanted
  if (hide && html) html.style.visibility = 'hidden'
  const show = () => { if (html) html.style.visibility = '' }

  const DEFAULTS = { enabled: true, maxMB: 50, panes: {}, chosen: {}, solidosLink: true }
  const settings = api.storage.local.get(DEFAULTS).catch(() => DEFAULTS)
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

    // What sort of page is it?
    let kind = 'json'
    if (!jsonType) {
      if (mdType || RE_MD_PATH.test(location.pathname)) kind = 'markdown' // text/markdown, or a text file called .md (raw.githubusercontent.com)
      else { // text/plain: only a body that is really JSON, or JSON Lines
        const c = text.trimStart()[0]
        if (c !== '{' && c !== '[') return show()
        try { JSON.parse(text) } catch (e) { if (!isLines(text)) return show() }
      }
    }

    // Which bundled panes may be asked: the right kind, not switched off, and the page has the text they need
    const off = opts.panes || {}
    const wanted = (globalThis.SOLID_PANE_LIST || []).filter(p => p.kind === kind && off[p.name] !== false && (!p.needs || text.includes(p.needs)))
    if (!wanted.length) return show()

    const { subject, context } = shim(text, kind)
    const fits = []
    for (const p of wanted) {
      try {
        const { default: pane } = await import(api.runtime.getURL(p.file))
        let label = null
        try { label = pane.label(subject, context) } catch (e) {}
        if (!label && p.trustKind) label = p.title
        if (label) fits.push({ info: p, pane, label: String(label), el: null })
      } catch (e) { console.warn('Pane host: ' + p.file, e) }
    }
    if (!fits.length) return show()

    // Keep the browser's own page, for Raw
    const raw = document.createElement('div')
    raw.append(...document.body.childNodes)
    raw.hidden = true
    document.body.style.margin = '0'
    document.body.append(raw)

    const combo = fits.map(f => f.info.name).join('+')
    const chosen = Object.assign({}, opts.chosen)
    let active = Math.max(0, fits.findIndex(f => f.info.name === chosen[combo]))
    let mode = 'viewer'
    const update = () => {
      if (tabs) tabs.host.hidden = mode === 'raw'
      fits.forEach((f, i) => { if (f.el) f.el.hidden = mode === 'raw' || i !== active })
      raw.hidden = mode !== 'raw'
    }
    const select = (i, remember) => {
      active = i
      if (!fits[i].el) { // drawn the first time it is chosen, and kept, so switching back is instant
        try { fits[i].el = mount(fits[i], subject, context) } catch (e) { fits[i].el = failed(fits[i], e) }
        fits[i].el.id = 'pane-' + fits[i].info.name
        if (tabs) { fits[i].el.setAttribute('role', 'tabpanel'); fits[i].el.setAttribute('aria-label', fits[i].label) }
        document.body.insertBefore(fits[i].el, raw)
      }
      if (tabs) tabs.mark(i)
      update()
      if (remember) { chosen[combo] = fits[i].info.name; api.storage.local.set({ chosen }).catch(() => {}) }
    }
    const tabs = fits.length > 1 ? tabBar(fits, i => select(i, true)) : null
    if (tabs) document.body.insertBefore(tabs.host, raw)
    select(active, false)
    document.body.append(toggle(m => { mode = m; update() }, opts.solidosLink !== false))
    show()
  })().catch(e => { show(); console.warn('Pane host:', e) })

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

  // ---- The shim: one subject and one context for every pane ------------------------------------
  // Only what the three bundled panes call is here.
  function shim (text, kind) {
    const here = location.href.split('#')[0]
    const term = uri => ({ termType: 'NamedNode', value: uri, uri, doc () { return term(uri.split('#')[0]) } })
    const subject = term(here)

    // The page's own address is answered from the text on the page (fragment and cache options
    // ignored); every other address is refused, so nothing is requested.
    const pageFetch = (input, init) => {
      let url = ''
      try { url = new URL(typeof input === 'string' ? input : (input && (input.url || input.href || input.value)) || String(input), location.href).href } catch (e) {}
      if (url && url.split('#')[0] === here) {
        const head = init && String(init.method || '').toUpperCase() === 'HEAD'
        return Promise.resolve(new Response(head ? null : text, { status: 200, headers: { 'Content-Type': type || 'text/plain' } }))
      }
      return Promise.reject(new TypeError('The extension makes no network requests; not fetched: ' + (url || input)))
    }
    // A pane that calls fetch() by name gets the same answer. This is the content script's own
    // global (extensions run in a world of their own): the page's fetch is not touched.
    try { globalThis.fetch = pageFetch } catch (e) {}

    // What a store would hold after reading the page: for a JSON object, one statement for each
    // top-level key, expanded with the document's own inline @context (a remote context is not
    // fetched). The Mindstr pane's label() looks for its nodes and connections predicates here.
    const statements = [{ subject, predicate: term('urn:x-pane-host:read'), object: { termType: 'Literal', value: kind }, why: subject, graph: subject }]
    if (kind === 'json' && text.includes('@context')) {
      try {
        for (const iri of keyIris(JSON.parse(text))) statements.push({ subject, predicate: term(iri), object: { termType: 'Literal', value: '' }, why: subject, graph: subject })
      } catch (e) {}
    }
    const same = (a, b) => a == null || (a.value || a) === b.value
    const store = {
      sym: term,
      each: () => [], // no folder listing, no types: nothing is known beyond the page
      any: () => undefined,
      statementsMatching: (s, p, o, doc) => !doc || (doc.value || doc.uri) === here ? statements.filter(st => same(s, st.subject) && same(p, st.predicate) && same(o, st.object)) : [],
      fetcher: {
        _fetch: pageFetch,
        load: () => Promise.reject(new Error('The extension makes no network requests'))
      }
    }
    const go = url => location.assign(url) // a normal page load; if it is a kind the extension knows, it is taken over in turn
    const context = {
      dom: document,
      session: { store },
      getOutliner: () => ({ GotoSubject: node => go(typeof node === 'string' ? node : node.value || node.uri) }),
      navigate: go,
      // the JSON pane's own hooks
      shadow: true, // styles as a constructed sheet inside a shadow root: page CSP cannot block them
      source: { text, contentType: type, url: location.href },
      imagePreviews: false, // no picture loads, even on hover
      peek: false // no "peek" at a linked document: that would be a request
    }
    return { subject, context }
  }

  // The full names of an object's top-level keys, from its inline @context: @vocab, terms and prefixes.
  function keyIris (data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return []
    let vocab = ''
    const terms = {}
    for (const c of [].concat(data['@context'] || [])) {
      if (!c || typeof c !== 'object') continue
      for (const k of Object.keys(c)) {
        const v = c[k]
        const id = typeof v === 'string' ? v : v && typeof v['@id'] === 'string' ? v['@id'] : null
        if (k === '@vocab') vocab = id || ''
        else if (k[0] !== '@' && id) terms[k] = id
      }
    }
    const out = []
    for (const k of Object.keys(data)) {
      if (k[0] === '@') continue
      let id = terms[k] || k
      const m = /^([^:/?#]+):(?!\/\/)(.*)$/.exec(id)
      if (m && terms[m[1]]) id = terms[m[1]] + m[2]
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(id)) id = vocab ? vocab + id : null
      if (id) out.push(id)
    }
    return out
  }

  // ---- Drawing a pane --------------------------------------------------------------------------
  const sheet = css => { const s = new CSSStyleSheet(); s.replaceSync(css); return s }
  // CSS from a pane goes in as it is, except that anything it would load (url(...) that is not
  // data: or a #fragment, @import) is taken out: styles must not cause requests.
  const quiet = css => String(css).replace(/@import[^;]*;/gi, '').replace(/url\(\s*(['"]?)(?!data:|#)[^)]*\)/gi, 'none')
  const HOST_CSS = ':host{display:block;background:#fff;color:#1d1d1f;color-scheme:light;overflow-x:auto;overflow-wrap:break-word}:host([hidden]){display:none}'

  function mount (fit, subject, context) {
    const view = fit.pane.render(subject, context)
    if (view.shadowRoot) return view // the pane drew in a shadow root of its own (the JSON pane, context.shadow)
    // Otherwise it goes in one of ours. A pane puts its CSS in a <style> element, which a strict
    // page Content-Security-Policy blocks; so each <style> is lifted into a constructed stylesheet
    // (which the policy allows) before the pane is in the page, and any added later too.
    const host = document.createElement('div')
    host.className = 'pane-host'
    host.dataset.pane = fit.info.name
    const root = host.attachShadow({ mode: 'open' })
    const sheets = [sheet(HOST_CSS)]
    const lift = () => {
      let found = false
      for (const st of [...(view.matches('style') ? [view] : []), ...view.querySelectorAll('style')]) {
        sheets.push(sheet(quiet(st.textContent)))
        st.remove()
        found = true
      }
      if (found || !root.adoptedStyleSheets.length) root.adoptedStyleSheets = sheets.slice()
    }
    lift()
    root.append(view)
    new MutationObserver(lift).observe(view, { childList: true, subtree: true })
    return host
  }

  function failed (fit, e) {
    const p = document.createElement('p')
    p.textContent = fit.label + ' could not be drawn: ' + String((e && e.message) || e)
    p.style.cssText = 'margin:24px 16px;font:15px/1.5 system-ui,sans-serif;color:#a1263a'
    return p
  }

  // A pane's icon is a data: URI holding an SVG. An <img> with it would be blocked by a strict page
  // policy, so the SVG is rebuilt as elements: shapes and their plain attributes only.
  function iconOf (pane) {
    try {
      const uri = String(pane.icon || '')
      if (!/^data:image\/svg\+xml[;,]/i.test(uri)) return null
      const body = uri.slice(uri.indexOf(',') + 1)
      const src = new DOMParser().parseFromString(/;base64,/i.test(uri.slice(0, uri.indexOf(',') + 1)) ? atob(body) : decodeURIComponent(body), 'image/svg+xml').documentElement
      if (!src || src.localName !== 'svg') return null
      const copy = from => {
        if (!/^(svg|g|path|rect|circle|ellipse|line|polyline|polygon)$/.test(from.localName)) return null
        const to = document.createElementNS('http://www.w3.org/2000/svg', from.localName)
        for (const a of from.attributes) if (/^(viewBox|d|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|points|transform|fill|stroke|opacity|fill-rule|clip-rule|(fill|stroke)-[a-z]+)$/.test(a.name) && !/url\(/i.test(a.value)) to.setAttribute(a.name, a.value)
        for (const c of from.children) { const k = copy(c); if (k) to.appendChild(k) }
        return to
      }
      const svg = copy(src)
      svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true')
      return svg
    } catch (e) { return null }
  }

  // ---- The controls: pane tabs at the top; Open in SolidOS and Viewer / Raw in the corner ---------------------
  // One look for both: a grey pill with a white chip on the chosen button. Every button is 44 px high.
  const PILL_CSS = ':host{display:block;color-scheme:light}:host([hidden]){display:none}' +
    '.t{display:inline-flex;max-width:100%;height:44px;padding:0 1px;border-radius:13px;background:#eef0f4;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}' +
    '.dock{position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;max-width:calc(100% - 24px)}' +
    '.dock>*{box-shadow:0 1px 3px rgba(20,30,60,.18)}' +
    'a{display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:none;box-sizing:border-box;height:44px;min-width:44px;padding:0 14px;border-radius:13px;background:#eef0f4;color:#4a5366;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;text-decoration:none;white-space:nowrap}' +
    'a:hover{color:#141a29}a:focus-visible{outline:2.5px solid #2f6fde;outline-offset:2px}' +
    '@media (max-width:560px){a{padding:0}a span{display:none}}' +
    '.strip{padding:8px 12px 0;background:#fff;overflow-x:auto}' +
    'button{position:relative;z-index:0;display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:none;height:44px;min-width:64px;padding:0 16px;border:0;border-radius:13px;background:transparent;color:#4a5366;font:inherit;white-space:nowrap;cursor:pointer}' +
    'button::before{content:"";position:absolute;z-index:-1;inset:4px 3px;border-radius:9px}' +
    'button[aria-pressed="true"],button[aria-selected="true"]{color:#141a29}' +
    'button[aria-pressed="true"]::before,button[aria-selected="true"]::before{background:#fff;box-shadow:0 1px 2px rgba(20,30,60,.12)}' +
    'button:focus-visible{outline:2.5px solid #2f6fde;outline-offset:-2px}' +
    'svg{flex:none;display:block}'
  function pillRoot (cls) {
    const host = document.createElement('div')
    host.className = cls
    const root = host.attachShadow({ mode: 'open' })
    try { root.adoptedStyleSheets = [sheet(PILL_CSS)] } catch (e) { const st = document.createElement('style'); st.textContent = PILL_CSS; root.append(st) }
    return { host, root }
  }

  // The pane tabs: icon and label for each pane that fits; arrows, Home and End move between them
  function tabBar (fits, onChoose) {
    const { host, root } = pillRoot('jsonviewer-tabs')
    const strip = document.createElement('div')
    strip.className = 'strip'
    const box = document.createElement('div')
    box.className = 't'
    box.setAttribute('role', 'tablist')
    box.setAttribute('aria-label', 'Show as')
    const buttons = fits.map((f, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.dataset.pane = f.info.name
      b.setAttribute('aria-controls', 'pane-' + f.info.name)
      const icon = iconOf(f.pane)
      if (icon) b.append(icon)
      const span = document.createElement('span')
      span.textContent = f.label
      b.append(span)
      b.addEventListener('click', () => onChoose(i))
      b.addEventListener('keydown', e => {
        const n = fits.length
        const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
        if (to < 0 || e.altKey || e.ctrlKey || e.metaKey) return
        e.preventDefault()
        onChoose(to)
        buttons[to].focus()
      })
      box.append(b)
      return b
    })
    strip.append(box)
    root.append(strip)
    const mark = at => buttons.forEach((b, i) => { b.setAttribute('aria-selected', String(i === at)); b.tabIndex = i === at ? 0 : -1 })
    return { host, mark }
  }

  // "Open in SolidOS": a plain link to the SolidOS data browser with this page's address. Only a
  // link: nothing is requested unless it is clicked. Not for file: or other non-web addresses.
  function solidosLink () {
    if (!/^https?:$/.test(location.protocol)) return null
    const a = document.createElement('a')
    a.className = 'solidos'
    a.href = 'https://solidos.org/docs/browser/?uri=' + encodeURIComponent(location.href)
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.title = 'Open this address in the SolidOS data browser, which loads panes from your tool index'
    a.setAttribute('aria-label', 'Open in SolidOS')
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '16'], ['height', '16'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v)
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4')
    svg.append(path)
    const span = document.createElement('span')
    span.textContent = 'Open in SolidOS'
    a.append(span, svg)
    addEventListener('hashchange', () => { a.href = 'https://solidos.org/docs/browser/?uri=' + encodeURIComponent(location.href) })
    return a
  }

  // The corner: the SolidOS link and a small Viewer / Raw switch
  function toggle (onChange, withLink) {
    const { host, root } = pillRoot('jsonviewer-toggle')
    const dock = document.createElement('div')
    dock.className = 'dock'
    const link = withLink ? solidosLink() : null
    if (link) dock.append(link)
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
    dock.append(box)
    root.append(dock)
    return host
  }
})()
