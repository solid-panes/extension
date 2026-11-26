// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Melvin Carvalho
//
// host/detect.js — what kind of page this is, and where its text is.
// Owns: the content-type tests, the "body is one <pre>" test, and the tests on the text itself
// (JSON or JSON Lines in a text/plain page, Markdown by address).
// Must not: change the page, read settings, load panes, or request anything.
(() => {
  const H = globalThis.SOLID_PANE_HOST
  // JSONView's content-type test: application/json and any +json (ld+json, activity+json, ...)
  const RE_JSON_TYPE = /^application\/([\w!#$&.\-^+]+\+)?json($|;)/i
  // JSON Lines / NDJSON, where the browser shows such a response as text at all
  const RE_LINES_TYPE = /^application\/(jsonl|x-ndjson|ndjson|json-seq|x-jsonlines|jsonlines)($|;)/i
  const RE_MD_TYPE = /^text\/(x-)?markdown($|;)/i
  const RE_MD_PATH = /\.(md|markdown)$/i
  const wants = kind => H.config.kinds.includes(kind)

  // The test made at document_start, from the content type alone. null: not a page for the host.
  // hide: the page is certainly wanted, so it may be hidden at once; plain text waits for its body.
  function page () {
    const type = String(document.contentType || '')
    const jsonType = wants('json') && (RE_JSON_TYPE.test(type) || RE_LINES_TYPE.test(type))
    const mdType = wants('markdown') && RE_MD_TYPE.test(type)
    const plainType = /^text\/plain($|;)/i.test(type)
    if (!jsonType && !mdType && !plainType) return null
    if (window.top !== window && !jsonType && !mdType) return null // a framed text file: leave it alone
    return { type, jsonType, mdType, hide: jsonType || mdType }
  }

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

  // Once the text is there: 'json', 'markdown', or null for a text file that is neither.
  function kindOf (pg, text) {
    if (pg.jsonType) return 'json'
    if (pg.mdType || (wants('markdown') && RE_MD_PATH.test(location.pathname))) return 'markdown' // text/markdown, or a text file called .md (raw.githubusercontent.com)
    if (!wants('json')) return null
    // text/plain: only a body that is really JSON, or JSON Lines
    const c = text.trimStart()[0]
    if (c !== '{' && c !== '[') return null
    try { JSON.parse(text) } catch (e) { if (!isLines(text)) return null }
    return 'json'
  }

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

  H.detect = { page, onlyPre, kindOf }
})()
