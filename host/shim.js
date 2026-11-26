// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/shim.js — the one subject and one context every pane is given, standing in for SolidOS.
// Owns: the subject term, the store stub, the fetch guard and navigation. Only what the bundled
// panes call is here.
// The fetch guard: the page's own address is answered from the text on the page; every other
// address is refused, so nothing is requested.
// Must not: make a request, or touch the page's own JavaScript world (the fetch replaced below is
// the content script's own global; the page's fetch is a different object).
(() => {
  const H = globalThis.SOLID_PANE_HOST

  // text: the page's text; kind: 'json' or 'markdown'; type: the page's content type
  function shim (text, kind, type) {
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

  H.shim = shim
})()
