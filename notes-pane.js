// notes-pane.js — a reader for Markdown notes.
// Applies to .md documents. Shows the note as a clean page, with previous / next through the
// other notes in the same folder. It imports nothing; the Markdown is turned into DOM nodes
// one by one (never innerHTML), so a note cannot inject script into the page.
const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains'
const IS_NOTE = /\.(md|markdown)$/i
const DATED = /(\d{4})[ _-]?(\d{2})[ _-]?(\d{2})/
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#7c4dff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7M9 8h3"/></svg>')

const CSS = `
.note { max-width: 720px; margin: 0 auto; padding: 28px 32px 96px; font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1d1d1f }
.note-nav { display: flex; align-items: center; gap: 10px; margin: 0 0 28px; font-size: 14px }
.note-nav a { color: #5b2fe0; text-decoration: none; padding: 6px 12px; border-radius: 999px; background: #f1ecff; font-weight: 600 }
.note-nav a:hover, .note-nav a:focus-visible { background: #7c4dff; color: #fff; outline: none }
.note-nav .gap { flex: 1 }
.note-nav .off { visibility: hidden }
.note-date { color: #86868b; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 6px }
.note h1 { font-size: 34px; line-height: 1.2; letter-spacing: -.02em; margin: 0 0 22px }
.note h2 { font-size: 22px; margin: 34px 0 10px; color: #7c4dff }
.note h3 { font-size: 18px; margin: 26px 0 8px }
.note h4, .note h5, .note h6 { font-size: 16px; margin: 20px 0 6px }
.note p { margin: 0 0 14px }
.note a { color: #5b2fe0 }
.note strong { font-size: inherit; font-weight: 650 }
.note em { font-size: inherit }
.note ul, .note ol { margin: 0 0 14px; padding-left: 26px }
.note li { margin: 4px 0 }
.note li.note-task { list-style: none; margin-left: -24px }
.note li.note-task input { margin: 0 8px 0 0; transform: translateY(1px); accent-color: #7c4dff }
.note li.note-done { color: #86868b; text-decoration: line-through }
.note blockquote { margin: 0 0 14px; padding: 2px 16px; border-left: 3px solid #d9ccff; color: #515154 }
.note code { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f4f1fb; padding: 2px 5px; border-radius: 5px }
.note pre { background: #f4f1fb; padding: 14px 16px; border-radius: 10px; overflow-x: auto; margin: 0 0 14px }
.note pre code { background: none; padding: 0 }
.note hr { border: 0; border-top: 1px solid #e5e5ea; margin: 28px 0 }
.note table { border-collapse: collapse; margin: 0 0 14px; font-size: 15px }
.note th, .note td { border-bottom: 1px solid #e5e5ea; padding: 7px 14px 7px 0; text-align: left }
.note th { color: #86868b; font-weight: 600; background: none }
.note a.note-wiki.missing { color: #86868b; border-bottom: 1px dashed #b0b0b6; cursor: help }
.note-msg { color: #86868b }
`

// ---- Markdown to DOM -------------------------------------------------------------------------

const safeHref = href => /^(https?:|mailto:|\/|\.|#|[^:]*$)/i.test(href) ? href : null

// Inline: `code`, [text](url), **bold**, *italic* / _italic_, bare links, [[note]] and [[note|label]].
function inline (dom, parent, text) {
  const re = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)|(https?:\/\/[^\s<>)]+)|\[\[([\w .\/-]+?)(?:\|([^\]]+))?\]\]/g
  let last = 0
  let m
  const add = (tag, content, attrs) => {
    const e = dom.createElement(tag)
    for (const k in attrs || {}) e.setAttribute(k, attrs[k])
    if (tag === 'code') e.textContent = content
    else inline(dom, e, content)
    parent.appendChild(e)
  }
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(dom.createTextNode(text.slice(last, m.index)))
    if (m[1]) add('code', m[1].slice(1, -1))
    else if (m[2]) {
      const href = safeHref(m[3])
      if (href) add('a', m[2], { href }); else parent.appendChild(dom.createTextNode(m[2]))
    } else if (m[4]) add('strong', m[4].slice(2, -2))
    else if (m[5]) add('em', m[5].slice(1, -1))
    else if (m[6]) { const a = dom.createElement('a'); a.setAttribute('href', m[6]); a.textContent = m[6]; parent.appendChild(a) }
    else if (m[7]) {
      // [[note]]: a link to the note of that name beside this one; the pane resolves it once it has the folder listing
      const a = dom.createElement('a'); a.setAttribute('class', 'note-wiki'); a.setAttribute('data-wiki', m[7].trim())
      a.textContent = (m[8] || m[7]).trim(); parent.appendChild(a)
    }
    last = re.lastIndex
  }
  if (last < text.length) parent.appendChild(dom.createTextNode(text.slice(last)))
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

// Blocks: headings, fenced code, lists (nested, with task boxes), quotes, tables, rules, paragraphs.
function markdown (dom, text, skipFirstH1) {
  const out = dom.createDocumentFragment()
  const el = (tag, parent) => { const e = dom.createElement(tag); (parent || out).appendChild(e); return e }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  let skipped = !skipFirstH1
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++
      el('code', el('pre')).textContent = body.join('\n')
      continue
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line)
    if (h) {
      i++
      if (h[1].length === 1 && !skipped) { skipped = true; continue }
      inline(dom, el('h' + h[1].length), h[2])
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { el('hr'); i++; continue }

    if (/^\s*>/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      el('blockquote').appendChild(markdown(dom, body.join('\n'), false))
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const table = el('table')
      const head = el('tr', el('thead', table))
      for (const c of cells(line)) inline(dom, el('th', head), c)
      i += 2
      const body = el('tbody', table)
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const tr = el('tr', body)
        for (const c of cells(lines[i])) inline(dom, el('td', tr), c)
        i++
      }
      continue
    }

    if (LIST.test(line)) {
      // a stack of open lists, one per indent level
      const stack = []
      while (i < lines.length && (LIST.test(lines[i]) || (/^\s+\S/.test(lines[i]) && stack.length))) {
        const m = LIST.exec(lines[i])
        if (!m) { // a continuation line of the last item
          const li = stack[stack.length - 1].list.lastChild
          if (li) { li.appendChild(dom.createTextNode(' ')); inline(dom, li, lines[i].trim()) }
          i++
          continue
        }
        const indent = m[1].replace(/\t/g, '  ').length
        while (stack.length && indent < stack[stack.length - 1].indent) stack.pop()
        if (!stack.length || indent > stack[stack.length - 1].indent) {
          const tag = /\d/.test(m[2]) ? 'ol' : 'ul'
          const parent = stack.length ? stack[stack.length - 1].list.lastChild || stack[stack.length - 1].list : out
          stack.push({ indent, list: el(tag, parent) })
        }
        const li = el('li', stack[stack.length - 1].list)
        const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3])
        if (task) {
          const done = task[1] !== ' '
          li.setAttribute('class', done ? 'note-task note-done' : 'note-task')
          const box = el('input', li)
          box.setAttribute('type', 'checkbox')
          box.setAttribute('disabled', '')
          if (done) box.setAttribute('checked', '')
          inline(dom, li, task[2])
        } else inline(dom, li, m[3])
        i++
      }
      continue
    }

    // a paragraph; a line ending in two spaces or a backslash is a line break
    const para = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|~~~)/.test(lines[i]) && !LIST.test(lines[i])) para.push(lines[i++])
    const p = el('p')
    para.forEach((raw, n) => {
      const hard = /( {2,}|\\)$/.test(raw)
      inline(dom, p, raw.replace(/\\$/, '').trim())
      if (n < para.length - 1) p.appendChild(hard ? dom.createElement('br') : dom.createTextNode(' '))
    })
  }
  return out
}

// ---- The pane --------------------------------------------------------------------------------

const fileName = uri => decodeURIComponent(uri.slice(uri.lastIndexOf('/') + 1))

function prettyDate (name) {
  const m = DATED.exec(name)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1]
}

const notesPane = {
  name: 'notes-reader',
  icon: ICON,

  label: function (subject) {
    return subject && subject.uri && IS_NOTE.test(subject.uri.split(/[?#]/)[0]) ? 'Notes' : null
  },

  // A note opens in this pane first.
  shouldGetFocus: function (subject) {
    return !!notesPane.label(subject)
  },

  render: function (subject, context) {
    const dom = context.dom
    const store = context.session.store
    const el = (tag, cls, text) => {
      const e = dom.createElement(tag)
      if (cls) e.setAttribute('class', cls)
      if (text !== undefined) e.textContent = text
      return e
    }
    const root = el('div', 'note notes-reader-pane')
    root.appendChild(el('style', '', CSS))
    const nav = root.appendChild(el('div', 'note-nav'))
    const body = root.appendChild(el('div', 'note-body'))
    body.appendChild(el('p', 'note-msg', 'Loading…'))

    const goto = node => function (event) {
      try {
        const outliner = context.getOutliner(dom)
        event.preventDefault()
        outliner.GotoSubject(node, true, undefined, true, undefined)
      } catch (e) { /* fall back to the link */ }
    }
    const link = (text, node, cls) => {
      const a = el('a', cls, text)
      if (node) { a.setAttribute('href', node.value); a.addEventListener('click', goto(node)) }
      return a
    }

    // previous / folder / next, from the folder's listing
    const folder = store.sym(subject.uri.slice(0, subject.uri.lastIndexOf('/') + 1))
    const drawNav = () => {
      const notes = [...new Set(store.each(folder, store.sym(LDP_CONTAINS)).map(n => n.value))]
        .filter(u => IS_NOTE.test(u)).sort()
      const at = notes.indexOf(subject.uri)
      const prev = at > 0 ? store.sym(notes[at - 1]) : null
      const next = at >= 0 && at < notes.length - 1 ? store.sym(notes[at + 1]) : null
      nav.textContent = ''
      nav.appendChild(link('← ' + (prev ? (prettyDate(fileName(prev.value)) || 'Previous') : ''), prev, prev ? '' : 'off'))
      nav.appendChild(el('span', 'gap'))
      nav.appendChild(link('All notes' + (notes.length ? ' (' + notes.length + ')' : ''), folder, notes.length ? '' : 'off')) // no listing (a static site): no folder to show
      nav.appendChild(el('span', 'gap'))
      nav.appendChild(link((next ? (prettyDate(fileName(next.value)) || 'Next') : '') + ' →', next, next ? '' : 'off'))
    }
    // [[name]] links: the note called name.md in this folder, also matched without its date
    // (so [[dyson-squeak]] finds 2026-11-18-dyson-squeak.md); a path with / is taken as written.
    const slug = v => v.toLowerCase().replace(IS_NOTE, '').replace(/[\s_]+/g, '-')
    const linkWikis = () => {
      const listed = !!store.any(folder, store.sym(LDP_CONTAINS))
      const notes = store.each(folder, store.sym(LDP_CONTAINS)).map(n => n.value).filter(u => IS_NOTE.test(u))
      for (const a of body.querySelectorAll('a.note-wiki')) {
        const name = a.getAttribute('data-wiki')
        let target = null
        if (name.includes('/')) target = new URL(IS_NOTE.test(name) ? name : name + '.md', subject.uri).href
        else {
          const want = slug(name)
          target = notes.find(u => slug(fileName(u)) === want) ||
            notes.find(u => slug(fileName(u)).replace(/^\d{4}-?\d{2}-?\d{2}-/, '') === want) || null
          if (!target && !listed) target = new URL(encodeURIComponent(name) + '.md', subject.uri).href // no listing: best guess
        }
        const fresh = a.cloneNode(true) // drops any earlier click handler
        if (target) {
          fresh.setAttribute('class', 'note-wiki'); fresh.setAttribute('href', target); fresh.removeAttribute('title')
          fresh.addEventListener('click', goto(store.sym(target)))
        } else {
          fresh.setAttribute('class', 'note-wiki missing'); fresh.removeAttribute('href')
          fresh.setAttribute('title', 'No note called "' + name + '" in this folder')
        }
        a.replaceWith(fresh)
        // No folder listing (a static site): the target was a guess, so ask whether it is there.
        if (target && !listed && !name.includes('/') && typeof fetch === 'function') {
          fetch(target, { method: 'HEAD' }).then(res => {
            if (res.ok || !fresh.isConnected) return
            const gone = fresh.cloneNode(true)
            gone.setAttribute('class', 'note-wiki missing'); gone.removeAttribute('href')
            gone.setAttribute('title', 'No note called "' + name + '" in this folder')
            fresh.replaceWith(gone)
          }, () => {})
        }
      }
    }
    drawNav()
    if (!store.any(folder, store.sym(LDP_CONTAINS)) && store.fetcher) {
      store.fetcher.load(folder).then(() => { drawNav(); linkWikis() }, () => {})
    }

    // the note itself, through SolidOS's own (logged-in) fetch when there is one
    const doFetch = (store.fetcher && store.fetcher._fetch) || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
    Promise.resolve()
      .then(() => doFetch(subject.uri, { headers: { Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' } }))
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text() })
      .then(text => {
        body.textContent = ''
        const name = fileName(subject.uri)
        const date = prettyDate(name)
        if (date) body.appendChild(el('p', 'note-date', date))
        const title = /^#\s+(.*?)\s*#*$/m.exec(text)
        inline(dom, body.appendChild(el('h1')), title ? title[1] : name.replace(IS_NOTE, '').replace(/[_-]+/g, ' '))
        body.appendChild(markdown(dom, text, !!title))
        linkWikis()
      })
      .catch(e => { body.textContent = ''; body.appendChild(el('p', 'note-msg', 'Could not load this note: ' + (e && e.message ? e.message : e))) })

    return root
  }
}

export default notesPane
