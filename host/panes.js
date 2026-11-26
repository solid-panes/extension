// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/panes.js — the bundled panes: which of them fit the page, and drawing one.
// Owns: choosing from the list (config.js, less those switched off), loading a pane's file from the
// extension, asking its label(), and mounting what it renders in a shadow root.
// Must not: edit or patch a pane (the files are unchanged copies), build the subject or context
// (shim.js), or decide which pane is showing (content.js).
(() => {
  const H = globalThis.SOLID_PANE_HOST
  const HOST_CSS = ':host{display:block;background:#fff;color:#1d1d1f;color-scheme:light;overflow-x:auto;overflow-wrap:break-word}:host([hidden]){display:none}'

  // Which bundled panes may be asked: the right kind, not switched off, and the page has the text they need
  const wanted = (kind, text, opts) => H.config.panes.filter(p => p.kind === kind && H.settings.paneOn(opts, p.name) && (!p.needs || text.includes(p.needs)))

  // Of those, the panes that say yes to this page, in list order: [{ info, pane, label, el }]
  async function fitting (wanted, subject, context) {
    const fits = []
    for (const p of wanted) {
      try {
        const { default: pane } = await import(H.api.runtime.getURL(p.file))
        let label = null
        try { label = pane.label(subject, context) } catch (e) {}
        if (!label && p.trustKind) label = p.title
        if (label) fits.push({ info: p, pane, label: String(label), el: null })
      } catch (e) { console.warn('Pane host: ' + p.file, e) }
      if (fits.length && !H.config.features.tabs) break // no tab bar: the first that fits is the only one
    }
    return fits
  }

  // The element to put in the page for a pane; a line of text if the pane throws.
  function mount (fit, subject, context) {
    try {
      const view = fit.pane.render(subject, context)
      if (view.shadowRoot) return view // the pane drew in a shadow root of its own (the JSON pane, context.shadow)
      // Otherwise it goes in one of ours, with its <style> elements lifted (styles.js).
      const host = document.createElement('div')
      host.className = 'pane-host'
      host.dataset.pane = fit.info.name
      H.styles.lift(host.attachShadow({ mode: 'open' }), view, HOST_CSS)
      return host
    } catch (e) { return failed(fit, e) }
  }

  function failed (fit, e) {
    const p = document.createElement('p')
    p.textContent = fit.label + ' could not be drawn: ' + String((e && e.message) || e)
    p.style.cssText = 'margin:24px 16px;font:15px/1.5 system-ui,sans-serif;color:#a1263a'
    return p
  }

  H.panes = { wanted, fitting, mount }
})()
