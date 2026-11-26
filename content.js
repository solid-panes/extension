// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// content.js — the entry point of a small pane host; the parts are in host/. It runs at
// document_start on every page and does nothing unless the page is a JSON, JSON Lines or Markdown
// response. Then it takes the text the browser already has (no second request), asks the bundled
// SolidOS panes (pane-list.js) which of them fit, and draws the first in place of the page; when
// more than one fits there is a tab bar. A Viewer / Raw switch goes back to the page as the browser
// showed it. The pane files are unchanged copies; all the adapting is in host/. The host makes no
// network requests and sends nothing anywhere: a pane that fetches the page's own address is
// answered from the text on the page, and any other fetch is refused.
//
// The manifest loads these as plain scripts, in this order, each adding its part to
// SOLID_PANE_HOST (in the content script's own world, which the page cannot see):
//   pane-list.js      which panes are bundled        host/shim.js      subject, context, fetch guard
//   host/config.js    which features are on          host/styles.js    CSS under a strict page policy
//   host/detect.js    what kind of page this is      host/panes.js     which panes fit; mounting one
//   host/settings.js  what the user has chosen       host/controls.js  tabs, Open in SolidOS, Viewer / Raw
// Owns: the order of events, hiding the page until the viewer is ready, and which pane is showing.
// Must not: hold detail that belongs to a module above.
(() => {
  const H = globalThis.SOLID_PANE_HOST
  const page = H.detect.page()
  if (!page) return

  const html = document.documentElement
  // hide a page that is certainly wanted at once, so the raw text does not flash; plain text waits until it is known to be wanted
  if (page.hide && html) html.style.visibility = 'hidden'
  const show = () => { if (html) html.style.visibility = '' }

  const settings = H.settings.read()
  const ready = new Promise(resolve => {
    if (document.readyState !== 'loading') resolve()
    else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
  })

  ;(async () => {
    const [opts] = await Promise.all([settings, ready])
    const pre = H.detect.onlyPre()
    if (!opts.enabled || !pre) return show()
    const text = pre.textContent
    if (text.length > H.settings.maxChars(opts)) return show()
    const kind = H.detect.kindOf(page, text)
    if (!kind) return show()

    const wanted = H.panes.wanted(kind, text, opts)
    if (!wanted.length) return show()

    const { subject, context } = H.shim(text, kind, page.type)
    const fits = await H.panes.fitting(wanted, subject, context)
    if (!fits.length) return show()

    // Keep the browser's own page, for Raw
    const raw = document.createElement('div')
    raw.append(...document.body.childNodes)
    raw.hidden = true
    document.body.style.margin = '0'
    document.body.append(raw)

    const features = H.config.features
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
        fits[i].el = H.panes.mount(fits[i], subject, context)
        fits[i].el.id = 'pane-' + fits[i].info.name
        if (tabs) { fits[i].el.setAttribute('role', 'tabpanel'); fits[i].el.setAttribute('aria-label', fits[i].label) }
        document.body.insertBefore(fits[i].el, raw)
      }
      if (tabs) tabs.mark(i)
      update()
      if (remember) { chosen[combo] = fits[i].info.name; H.settings.remember(chosen) }
    }
    const tabs = features.tabs && fits.length > 1 ? H.controls.tabBar(fits, i => select(i, true)) : null
    if (tabs) document.body.insertBefore(tabs.host, raw)
    select(active, false)
    const corner = H.controls.corner(m => { mode = m; update() }, { link: features.solidosLink && opts.solidosLink !== false, rawSwitch: features.rawSwitch })
    if (corner) document.body.append(corner)
    show()
  })().catch(e => { show(); console.warn('Pane host:', e) })
})()
