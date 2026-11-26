// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Melvin Carvalho
//
// mindstr-pane.js — a read-only viewer for Mindstr mind maps.
// Applies to a document whose JSON-LD uses the Mindstr vocabulary (https://mindstr.org/ns#) with
// nodes and connections (map format 0.2: nodes with @id, name, x, y, bgColor, parent, link;
// connections with start/end indexes). Draws the map as SVG from the stored positions, fits it to
// the view, and lets you pan (drag) and zoom (wheel, pinch, buttons). A node that links to another
// map opens it in place; other links open in a new tab. It imports nothing, builds the DOM with
// createElement/textContent (never innerHTML), and writes nothing.
//
// https://solid-panes.github.io/mindstr/ · licence: GNU AGPL 3.0 or later (see LICENSE).

const NS = 'https://mindstr.org/ns#'
const SVGNS = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'
const ACCEPT = 'application/ld+json, application/json;q=0.9, */*;q=0.1'
const STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif'
// Node styles by depth (the same boxes the Mindstr app lays maps out for): root, branch, deeper.
const STYLES = [
  { size: 22, weight: 700, padX: 26, h: 54, r: 27, edge: 3.4 },
  { size: 16, weight: 700, padX: 18, h: 40, r: 14, edge: 3.0 },
  { size: 15, weight: 500, padX: 12, h: 32, r: 10, edge: 1.7 }
]
const ROOT_FILL = '#6d4aff'
const LINK_W = 18 // room for the ↗ after an outside link
const MIN_K = 0.08
const MAX_K = 4
const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6d4aff" stroke-width="1.8" stroke-linecap="round"><rect x="8" y="9.5" width="8" height="5" rx="2.5" fill="#6d4aff"/><path d="M16 12c2 0 2-5 4-5M16 12c2 0 2 5 4 5M8 12c-2 0-2-5-4-5M8 12c-2 0-2 5-4 5"/></svg>')

const CSS = `
.mds { box-sizing: border-box; width: 100%; margin: 0 auto; padding: 12px; background: #fff; color: #25242a; font: 15px/1.45 ${STACK} }
.mds *, .mds *::before, .mds *::after { box-sizing: border-box }
.mds.mindstr-pane { max-width: 1400px; margin: 0 auto }
.mds-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 10px }
.mds-title { flex: 1 1 220px; min-width: 0; margin: 0; font-size: 19px; line-height: 1.3; font-weight: 700; color: #241a4d; overflow-wrap: anywhere }
.mds-meta { display: block; margin-top: 2px; font-size: 12.5px; font-weight: 500; color: #76707f }
.mds-tools { display: flex; gap: 6px; flex: 0 0 auto }
.mds-tools button { min-width: 38px; height: 36px; padding: 0 12px; border: 1px solid #ddd6ee; border-radius: 9px; background: #f8f6fd; color: #3b2a85; font: 600 15px/1 ${STACK}; cursor: pointer }
.mds-tools button:hover { background: #efeafc; border-color: #c7baea }
.mds-tools button:focus-visible { outline: 3px solid #8b6cf0; outline-offset: 2px }
.mds-stage { position: relative; width: 100%; height: min(78vh, 900px); min-height: 320px; overflow: hidden; border: 1px solid #ebe7f2; border-radius: 14px;
  background: radial-gradient(circle at 50% 45%, #fbfaff 0, #f6f4fb 70%, #f2f0f8 100%) }
.mds-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none }
.mds-svg.mds-dragging { cursor: grabbing }
.mds-edge { fill: none; stroke-linecap: round }
.mds-node rect { transition: stroke .12s ease }
.mds-node text { pointer-events: none }
.mds .mds-link, .mds .mds-link text { cursor: pointer; text-decoration: none }
.mds-link:hover rect { stroke: #3b2a85; stroke-width: 2px }
.mds-link:focus { outline: none }
.mds-link:focus-visible rect { stroke: #6d4aff; stroke-width: 3px }
.mds-root rect { filter: drop-shadow(0 3px 8px rgba(60, 40, 140, .22)) }
.mds-hint { position: absolute; left: 10px; bottom: 8px; margin: 0; padding: 3px 8px; border-radius: 7px; background: rgba(255,255,255,.85); color: #77707f; font-size: 12px; pointer-events: none }
.mds-msg { margin: 24px 4px; color: #5e5868 }
.mds-msg.mds-error { color: #a1263a }
@media (max-width: 560px) {
  .mds { padding: 8px }
  .mds-title { font-size: 17px }
  .mds-stage { height: min(68vh, 560px) }
  .mds-hint { display: none }
}
`

const local = term => {
  const v = String((term && term.value) || term || '')
  return v.slice(Math.max(v.lastIndexOf('/'), v.lastIndexOf('#')) + 1)
}
const isDoc = subject => subject && subject.value && !subject.value.endsWith('/') && typeof subject.doc === 'function'

// Does the loaded document hold a Mindstr map? (SolidOS and the pane runner load it before asking.)
// A server that turns JSON-LD into Turtle may drop every triple (JSS does, for a map's @vocab
// context and a top level with no @id), so a .jsonld file that parsed to nothing is taken as a
// possible map too; render() reads the JSON itself and says so if it is not one.
function holdsMap (store, subject) {
  if (!store || !isDoc(subject)) return false
  let nodes = false; let connections = false
  const all = store.statementsMatching(null, null, null, subject.doc())
  if (!all.length && /\.jsonld$/i.test(new URL(subject.doc().uri).pathname)) return true
  for (const st of all) {
    const p = st.predicate.value
    if (!p.startsWith(NS)) continue
    if (p === NS + 'nodes') nodes = true
    else if (p === NS + 'connections') connections = true
    if (nodes && connections) return true
  }
  return false
}

// ---------- colour ----------
function rgb (c) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.replace(/./g, x => x + x)
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}
const hex = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
function luminance (a) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2])
}
const INK = [31, 27, 46]

// ---------- the map ----------
function readMap (json) {
  const nodes = Array.isArray(json && json.nodes) ? json.nodes.filter(n => n && typeof n === 'object') : []
  const n = nodes.length
  const parent = new Array(n).fill(null)
  const conns = []
  if (Array.isArray(json.connections) && json.connections.length) {
    for (const c of json.connections) {
      const s = Number(c && c.start); const e = Number(c && c.end)
      if (Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e >= 0 && s < n && e < n && s !== e) {
        conns.push([s, e]); if (parent[e] === null) parent[e] = s
      }
    }
  } else { // 0.2 maps may rely on parent alone
    const byId = new Map(nodes.map((x, i) => [x['@id'], i]))
    nodes.forEach((x, i) => { const p = byId.get(x.parent); if (p !== undefined && p !== i) { parent[i] = p; conns.push([p, i]) } })
  }
  const depth = parent.map((_, i) => { let d = 0; let j = i; const seen = new Set(); while (parent[j] !== null && !seen.has(j)) { seen.add(j); j = parent[j]; d++ } return d })
  const branch = parent.map((_, i) => { let j = i; const seen = new Set(); while (depth[j] > 1 && !seen.has(j)) { seen.add(j); j = parent[j] } return j })
  return { nodes, parent, depth, branch, conns }
}

const pane = {
  name: 'mindstr',
  icon: ICON,

  label (subject, context) {
    try { return holdsMap(context && context.session && context.session.store, subject) ? 'Mind map' : null } catch (e) { return null }
  },

  shouldGetFocus (subject) {
    try { return holdsMap(globalThis.SolidLogic && globalThis.SolidLogic.store, subject) } catch (e) { return false }
  },

  render (subject, context) {
    const dom = context.dom
    const store = context.session.store
    const win = dom.defaultView || globalThis
    const el = (tag, cls, text) => { const e = dom.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
    const svgEl = (tag, attrs) => { const e = dom.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e }

    const root = el('div', 'mds mindstr-pane')
    const style = el('style'); style.textContent = CSS; root.appendChild(style)
    const msg = root.appendChild(el('p', 'mds-msg', 'Loading the map…'))

    const docUri = subject.doc().uri
    const doFetch = (store.fetcher && store.fetcher._fetch) || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
    if (!doFetch) { msg.textContent = 'This page cannot fetch the map.'; msg.className = 'mds-msg mds-error'; return root }
    // no-store: not the cached Turtle a server may have sent the store for the same URL
    Promise.resolve()
      .then(() => doFetch(docUri, { headers: { Accept: ACCEPT }, cache: 'no-store' }))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then(json => {
        if (!json || !Array.isArray(json.nodes) || !JSON.stringify(json['@context'] || '').includes(NS)) throw new Error('this is not a Mindstr map')
        msg.remove(); draw(readMap(json))
      })
      .catch(e => { msg.textContent = 'Could not read the map: ' + (e.message || e); msg.className = 'mds-msg mds-error' })

    // text widths, measured on a canvas so it works before the pane is in the page
    const ctx = dom.createElement('canvas').getContext('2d')
    const measure = (text, st) => {
      if (!ctx) return text.length * st.size * 0.56
      ctx.font = `${st.weight} ${st.size}px ${STACK}`
      return ctx.measureText(text).width
    }

    function goTo (url) {
      try {
        const node = store.sym ? store.sym(url) : { termType: 'NamedNode', value: url, uri: url }
        context.getOutliner(dom).GotoSubject(node, true, undefined, true, undefined)
      } catch (e) { win.location.assign(url) }
    }

    function draw (map) {
      const { nodes, depth, branch, conns } = map
      if (!nodes.length) { root.appendChild(el('p', 'mds-msg', 'This map has no nodes yet.')); return }
      const top = nodes[0]
      const title = String(top.name || 'Untitled map').replace(/\s*›\s*$/, '')

      // header
      const bar = root.appendChild(el('div', 'mds-bar'))
      const h = bar.appendChild(el('h2', 'mds-title', title))
      const maps = nodes.filter(n => n.link && /\.jsonld?($|[?#])/i.test(String(n.link))).length
      h.appendChild(el('span', 'mds-meta', nodes.length + (nodes.length === 1 ? ' idea' : ' ideas') + (maps ? ' · ' + maps + ' linked ' + (maps === 1 ? 'map' : 'maps') : '')))
      const tools = bar.appendChild(el('div', 'mds-tools'))
      const btn = (text, label, fn) => { const b = tools.appendChild(el('button', null, text)); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b }

      const stage = root.appendChild(el('div', 'mds-stage'))
      const svg = stage.appendChild(svgEl('svg', { class: 'mds-svg', role: 'img', 'aria-label': 'Mind map: ' + title }))
      const world = svg.appendChild(svgEl('g'))
      const edgeLayer = world.appendChild(svgEl('g'))
      const nodeLayer = world.appendChild(svgEl('g'))
      stage.appendChild(el('p', 'mds-hint', 'Drag to move · wheel or pinch to zoom'))

      // sizes and colours
      const box = nodes.map((n, i) => {
        const st = STYLES[Math.min(depth[i], 2)]
        const name = String(n.name == null ? '' : n.name)
        const url = n.link ? (() => { try { return new URL(String(n.link), docUri).href } catch (e) { return null } })() : null
        const isMap = !!url && /\.jsonld?$/i.test(new URL(url).pathname)
        const arrow = !!url && !isMap && !/›\s*$/.test(name) // a name ending in › already says it opens something
        const w = Math.max(st.h, measure(name, st) + st.padX * 2 + (arrow ? LINK_W : 0))
        const x = Number(n.x) || 0; const y = Number(n.y) || 0
        let fill = rgb(n.bgColor) || (depth[i] === 0 ? rgb(ROOT_FILL) : rgb(nodes[branch[i]].bgColor) || [237, 233, 250])
        if (depth[i] > 1 && !rgb(n.bgColor)) fill = mix(fill, [255, 255, 255], 0.55)
        return { st, name, url, isMap, arrow, w, h: st.h, x, y, fill }
      })
      const edgeColour = i => { const b = box[branch[i]].fill; return hex(mix(b, INK, luminance(b) > 0.5 ? 0.35 : 0.1)) }

      // connections: a curve from the side of the parent to the side of the child, or top/bottom when stacked
      for (const [s, e] of conns) {
        const a = box[s]; const b = box[e]
        const side = Math.abs(b.x - a.x) - (a.w + b.w) / 2 > 14
        let x1, y1, x2, y2, d
        if (side) {
          const dir = b.x > a.x ? 1 : -1
          x1 = a.x + dir * a.w / 2; y1 = a.y; x2 = b.x - dir * b.w / 2; y2 = b.y
          const k = Math.abs(x2 - x1) * 0.5
          d = `M${x1} ${y1}C${x1 + dir * k} ${y1} ${x2 - dir * k} ${y2} ${x2} ${y2}`
        } else { // stacked: top or bottom edge; along the wide root, as near the child as its corners allow
          const dir = b.y > a.y ? 1 : -1
          const clampX = (x, n) => Math.min(n.x + n.w / 2 - n.st.r, Math.max(n.x - n.w / 2 + n.st.r, x))
          x1 = depth[s] === 0 ? clampX(b.x, a) : a.x; y1 = a.y + dir * a.h / 2; x2 = b.x; y2 = b.y - dir * b.h / 2
          const k = Math.abs(y2 - y1) * 0.45
          d = `M${x1} ${y1}C${x1} ${y1 + dir * k} ${x2} ${y2 - dir * k} ${x2} ${y2}`
        }
        const st = STYLES[Math.min(depth[e], 2)]
        edgeLayer.appendChild(svgEl('path', { class: 'mds-edge', d, stroke: edgeColour(e), 'stroke-width': st.edge, 'stroke-opacity': depth[e] <= 1 ? 0.85 : 0.6 }))
      }

      // nodes, deepest first so the root sits on top
      const order = nodes.map((_, i) => i).sort((p, q) => depth[q] - depth[p])
      for (const i of order) {
        const b = box[i]; const st = b.st
        const dark = luminance(b.fill) < 0.4
        const g = svgEl(b.url ? 'a' : 'g', { class: 'mds-node' + (depth[i] === 0 ? ' mds-root' : '') + (b.url ? ' mds-link' : '') })
        if (b.url) {
          g.setAttribute('href', b.url); g.setAttributeNS(XLINK, 'xlink:href', b.url)
          if (!b.isMap) { g.setAttribute('target', '_blank'); g.setAttribute('rel', 'noopener noreferrer') }
          g.setAttribute('aria-label', b.name + (b.isMap ? ' (open map)' : ' (opens in a new tab)'))
          const t = svgEl('title'); t.textContent = b.isMap ? 'Open map: ' + b.url : b.url; g.appendChild(t)
          if (b.isMap) g.addEventListener('click', e => { if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); goTo(b.url) })
        }
        g.appendChild(svgEl('rect', {
          x: b.x - b.w / 2, y: b.y - b.h / 2, width: b.w, height: b.h, rx: st.r, ry: st.r,
          fill: hex(b.fill),
          stroke: hex(mix(b.fill, INK, depth[i] === 0 ? 0.45 : 0.22)),
          'stroke-width': depth[i] === 0 ? 2.2 : 1
        }))
        const tx = b.x - (b.arrow ? LINK_W / 2 : 0)
        const text = svgEl('text', {
          x: tx, y: b.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          fill: dark ? '#ffffff' : '#1f1b2e', 'font-size': st.size, 'font-weight': st.weight, 'font-family': STACK
        })
        text.textContent = b.name
        g.appendChild(text)
        if (b.arrow) {
          const arrow = svgEl('text', { x: b.x + b.w / 2 - st.padX - LINK_W / 2 + 6, y: b.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: dark ? '#ffffff' : '#5030b5', 'font-size': st.size - 2, 'font-family': STACK })
          arrow.textContent = '↗'
          g.appendChild(arrow)
        }
        nodeLayer.appendChild(g)
      }

      // ---------- view: pan and zoom ----------
      const bounds = box.reduce((m, b) => ({
        x0: Math.min(m.x0, b.x - b.w / 2), y0: Math.min(m.y0, b.y - b.h / 2),
        x1: Math.max(m.x1, b.x + b.w / 2), y1: Math.max(m.y1, b.y + b.h / 2)
      }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
      const view = { k: 1, tx: 0, ty: 0 }
      let touched = false // once the reader pans or zooms, a resize no longer refits
      const apply = () => world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`)
      const size = () => ({ w: svg.clientWidth || stage.clientWidth, h: svg.clientHeight || stage.clientHeight })
      // Fit shows the whole map. The first view on a narrow screen stops at READABLE instead, so
      // the words can be read; it centres on the root, and Fit still shows everything.
      const READABLE = 0.5
      function fit (readable) {
        const { w, h } = size()
        if (!w || !h) return false
        const pad = w < 500 ? 12 : 28
        const bw = bounds.x1 - bounds.x0; const bh = bounds.y1 - bounds.y0
        let cx = bounds.x0 + bw / 2; let cy = bounds.y0 + bh / 2
        view.k = Math.min(MAX_K, 1.25, Math.max(MIN_K, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)))
        if (readable && view.k < READABLE) {
          view.k = READABLE
          cx = Math.min(bounds.x1 - (w / 2 - pad) / view.k, Math.max(bounds.x0 + (w / 2 - pad) / view.k, box[0].x))
          cy = Math.min(bounds.y1 - (h / 2 - pad) / view.k, Math.max(bounds.y0 + (h / 2 - pad) / view.k, box[0].y))
          if (bh * view.k < h - pad * 2) cy = bounds.y0 + bh / 2
        }
        view.tx = w / 2 - cx * view.k
        view.ty = h / 2 - cy * view.k
        apply()
        return true
      }
      function zoomAt (px, py, factor) {
        const k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor))
        const f = k / view.k
        view.tx = px - (px - view.tx) * f; view.ty = py - (py - view.ty) * f; view.k = k
        touched = true; apply()
      }
      const centre = () => { const { w, h } = size(); return [w / 2, h / 2] }
      btn('−', 'Zoom out', () => zoomAt(...centre(), 1 / 1.3))
      btn('Fit', 'Fit the map to the view', () => { touched = false; fit() })
      btn('+', 'Zoom in', () => zoomAt(...centre(), 1.3))

      const at = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
      svg.addEventListener('wheel', e => {
        e.preventDefault()
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
        zoomAt(...at(e), Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)))
      }, { passive: false })

      const pts = new Map()
      let drag = null; let pinch = null; let moved = false
      const startDrag = () => { const [p] = pts.values(); drag = { x: p[0], y: p[1], tx: view.tx, ty: view.ty } }
      const startPinch = () => {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, k: view.k, tx: view.tx, ty: view.ty }
        drag = null
      }
      svg.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        pts.set(e.pointerId, at(e))
        if (pts.size === 1) { moved = false; startDrag() } else if (pts.size === 2) startPinch()
      })
      svg.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return
        pts.set(e.pointerId, at(e))
        if (pinch && pts.size >= 2) {
          const [a, b] = [...pts.values()]
          const k = Math.min(MAX_K, Math.max(MIN_K, pinch.k * Math.hypot(b[0] - a[0], b[1] - a[1]) / pinch.d))
          const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2
          view.k = k
          view.tx = mx - (pinch.mx - pinch.tx) / pinch.k * k
          view.ty = my - (pinch.my - pinch.ty) / pinch.k * k
          moved = touched = true; apply()
        } else if (drag) {
          const p = pts.get(e.pointerId)
          const dx = p[0] - drag.x; const dy = p[1] - drag.y
          if (!moved && Math.hypot(dx, dy) < 5) return
          if (!moved) { moved = true; try { svg.setPointerCapture(e.pointerId) } catch (err) {} svg.classList.add('mds-dragging') }
          view.tx = drag.tx + dx; view.ty = drag.ty + dy
          touched = true; apply()
        }
      })
      const end = e => {
        if (!pts.delete(e.pointerId)) return
        pinch = null
        if (pts.size === 1) startDrag(); else drag = null
        if (!pts.size) svg.classList.remove('mds-dragging')
      }
      svg.addEventListener('pointerup', end)
      svg.addEventListener('pointercancel', end)
      // a drag that ends on a node is not a click on it
      svg.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false } }, true)

      // fit once the stage has a size, and again on resize until the reader moves the map
      if (win.ResizeObserver) new win.ResizeObserver(() => { if (!touched) fit(true) }).observe(stage)
      const firstFit = (n = 0) => { if (!fit(true) && n < 120) win.requestAnimationFrame(() => firstFit(n + 1)) }
      firstFit()
    }

    return root
  }
}

export default pane
