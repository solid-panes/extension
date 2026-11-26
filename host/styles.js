// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/styles.js — CSS that works under a strict page Content-Security-Policy.
// Owns: constructed stylesheets, and lifting a pane's <style> elements into them. A strict policy
// blocks <style>; it allows a constructed sheet adopted by a shadow root.
// Must not: let CSS cause a request (url(...) and @import are taken out), or know anything about
// particular panes or controls.
(() => {
  const H = globalThis.SOLID_PANE_HOST
  const sheet = css => { const s = new CSSStyleSheet(); s.replaceSync(css); return s }
  // CSS from a pane goes in as it is, except that anything it would load (url(...) that is not
  // data: or a #fragment, @import) is taken out: styles must not cause requests.
  const quiet = css => String(css).replace(/@import[^;]*;/gi, '').replace(/url\(\s*(['"]?)(?!data:|#)[^)]*\)/gi, 'none')

  // Give a shadow root the host's own CSS; a <style> element only where constructed sheets fail.
  function adopt (root, css) {
    try { root.adoptedStyleSheets = [sheet(css)] } catch (e) { const st = document.createElement('style'); st.textContent = css; root.append(st) }
  }

  // Put view into root with baseCss and every <style> in view lifted into a constructed sheet,
  // before view is in the page; any <style> added later is lifted too.
  function lift (root, view, baseCss) {
    const sheets = [sheet(baseCss)]
    const run = () => {
      let found = false
      for (const st of [...(view.matches('style') ? [view] : []), ...view.querySelectorAll('style')]) {
        sheets.push(sheet(quiet(st.textContent)))
        st.remove()
        found = true
      }
      if (found || !root.adoptedStyleSheets.length) root.adoptedStyleSheets = sheets.slice()
    }
    run()
    root.append(view)
    new MutationObserver(run).observe(view, { childList: true, subtree: true })
  }

  H.styles = { adopt, lift }
})()
