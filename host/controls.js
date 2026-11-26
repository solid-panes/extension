// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/controls.js — the host's own controls: the pane tabs at the top, and in the corner the
// "Open in SolidOS" link and the Viewer / Raw switch.
// Owns: how the controls look (one look for both: a grey pill with a white chip on the chosen
// button; every button is 44 px high) and their keyboard handling. Each is in a shadow root.
// Must not: show or hide panes, keep state, or read settings; a control only reports what was
// chosen through the callback it is given (content.js acts on it). Nothing is requested: the
// SolidOS link is only a link.
(() => {
  const H = globalThis.SOLID_PANE_HOST
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
    H.styles.adopt(root, PILL_CSS)
    return { host, root }
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

  // The pane tabs: icon and label for each pane that fits; arrows, Home and End move between them.
  // Returns { host, mark(i) }; onChoose(i) is called when a tab is picked.
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

  // The corner: the SolidOS link and a small Viewer / Raw switch. want: { link, rawSwitch }.
  // onMode('viewer' | 'raw') is called when the switch is used. null when there is nothing to show.
  function corner (onMode, want) {
    const link = want.link ? solidosLink() : null
    if (!link && !want.rawSwitch) return null
    const { host, root } = pillRoot('jsonviewer-toggle')
    const dock = document.createElement('div')
    dock.className = 'dock'
    if (link) dock.append(link)
    if (want.rawSwitch) {
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
          onMode(id)
        })
        buttons[id] = b
        box.append(b)
      }
      dock.append(box)
    }
    root.append(dock)
    return host
  }

  H.controls = { tabBar, corner }
})()
