// Search overlay for the chat screen (Task 9): a sheet rendered INSIDE #chat
// that searches the open conversation while the chat behind stays mounted —
// no screen change, no scroll reset. Tapping a result closes the sheet and
// pings the highlight engine (chat.js requestHighlight), which scrolls the
// (already mounted) chat to that bubble and outlines it for 2s.
//
// Seam (smallest honest one): chat.js owns the live session object AND the
// highlight engine, so the overlay takes BOTH from that single source rather
// than re-fetching the conversation from the store — a re-import mid-search
// could race such a fetch. chat.js passes initSearch ONE getter, evaluated
// at open() time:
//   getOpenChatHandle() -> null                       no live chat open
//   | { messages, highlightMessage, fileName }        for the CURRENT chat
// highlightMessage is chat.js's requestHighlight directly: it validates the
// index and no-ops once the session is detached/closed, so a result can
// never trigger against a dead conversation. chat.js also calls close() when
// the session is released (see releaseSession), so the sheet never outlives
// the chat it belongs to and reopening another chat starts clean.

import { findMatches } from '../search.js'

const DEBOUNCE_MS = 150     // live-results tick
const MAX_CONTEXT = 120     // chars of message text shown around the first hit
const LEAD = 40             // chars shown before the hit ...
const TAIL = MAX_CONTEXT - LEAD // ... and after it

// Markup declared statically in index.html, inside #chat (Task 9 ids).
const overlay = document.getElementById('search-overlay')
const backBtn = document.getElementById('search-back-btn')
const input = document.getElementById('search-input')
const resultsEl = document.getElementById('search-results')
const countEl = document.getElementById('search-count')

let getOpenChatHandle = null
let context = null      // snapshot of the open chat, taken at open() time
let debounceTimer = 0

export function initSearch(getter) {
  getOpenChatHandle = getter

  backBtn.addEventListener('click', close)
  input.addEventListener('input', scheduleRun)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close() // desktop convenience; chat untouched
  })
  // Delegated: rows are rebuilt on every query tick, one listener survives them.
  resultsEl.addEventListener('click', (event) => {
    if (!context || overlay.hidden) return
    const row = event.target instanceof Element ? event.target.closest('.search-row') : null
    if (!row) return
    const messageIndex = Number(row.dataset.index)
    const handle = context // close() nulls the module snapshot
    close()
    // highlightMessage is guarded in chat.js: pre-paint calls queue until the
    // chat settles, and a detached/closed session makes it a no-op.
    handle.highlightMessage(messageIndex)
  })

  return { open, close }
}

function open() {
  context = typeof getOpenChatHandle === 'function' ? getOpenChatHandle() : null
  if (!context) return // defensive: the button lives in the chat header, so a chat is always open here
  reset()
  overlay.hidden = false
  // preventScroll: focusing must not move the chat's scroll position behind.
  input.focus({ preventScroll: true })
}

function close() {
  overlay.hidden = true
  reset()
}

function reset() {
  context = null
  input.value = ''
  clearTimeout(debounceTimer)
  debounceTimer = 0
  resultsEl.replaceChildren()
  countEl.textContent = ''
  countEl.hidden = true
}

function scheduleRun() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(runSearch, DEBOUNCE_MS)
}

function runSearch() {
  debounceTimer = 0
  if (overlay.hidden || !context) return // chat closed between tick and fire

  const query = input.value
  resultsEl.replaceChildren()
  countEl.hidden = true

  if (!query.trim()) {
    hint('Type to search this conversation')
    return
  }

  // O(messages) per tick; capped at 500 matches inside findMatches.
  const matches = findMatches(context.messages, query)
  if (matches.length === 0) {
    hint('No results')
    return
  }

  countEl.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'}`
  countEl.hidden = false

  const messages = context.messages
  const frag = document.createDocumentFragment()
  for (const match of matches) frag.append(rowEl(messages[match.index], match))
  resultsEl.append(frag)
}

function rowEl(message, match) {
  const row = document.createElement('div')
  row.className = 'search-row'
  row.dataset.index = String(match.index)

  const name = document.createElement('div')
  name.className = 'search-row-name'
  name.textContent = message?.sender ?? ''

  // dir="auto" + textContent/mark nodes only — never innerHTML, mirroring
  // chat.js's bubble building so message content cannot inject markup.
  const text = document.createElement('div')
  text.className = 'search-row-text'
  text.dir = 'auto'
  for (const node of contextNodes(String(message?.text ?? ''), match.ranges)) text.append(node)

  row.append(name, text)
  return row
}

// ~MAX_CONTEXT chars of ORIGINAL text around the first hit range, with every
// range overlapping the window rendered as <mark> (ranges are indexes into
// the original message text — see js/search.js). Truncations surface as "…".
function contextNodes(text, ranges) {
  const first = ranges?.[0]
  if (!first || !Number.isInteger(first[0])) return [document.createTextNode(text)]

  let a = Math.max(0, first[0] - LEAD)
  let b = Math.min(text.length, first[1] + TAIL)
  if (b - a > MAX_CONTEXT) {
    if (a === 0) b = a + MAX_CONTEXT // hit too near the start: keep the lead, clip the tail
    else a = b - MAX_CONTEXT
  }
  // Ranges are UTF-16 unit indexes; slicing could split a surrogate pair and
  // render a lone half as a replacement glyph. Snap onto pair boundaries.
  a = snapDown(text, a)
  b = snapUp(text, b)

  const parts = []
  let cursor = a
  for (const [s, e] of ranges) {
    // s >= b: range ENTIRELY past the window — without this guard it would
    // paint an unmarked tail stretching past b and a stray empty <mark>.
    if (e <= a || s >= b) continue // outside the window
    const ms = Math.max(s, a)
    const me = Math.min(e, b)
    if (me <= cursor) continue // already covered
    if (cursor < ms) parts.push(document.createTextNode(text.slice(cursor, ms)))
    const mark = document.createElement('mark')
    mark.textContent = text.slice(ms, me)
    parts.push(mark)
    cursor = Math.max(cursor, me)
  }
  if (cursor < b) parts.push(document.createTextNode(text.slice(cursor, b)))
  if (a > 0) parts.unshift(document.createTextNode('…'))
  if (b < text.length) parts.push(document.createTextNode('…'))
  return parts
}

const HI = 0xD800 // high surrogate first unit
const LO = 0xDC00 // low surrogate first unit
const HI_END = 0xDC00
const LO_END = 0xE000

function snapDown(text, i) {
  if (i > 0 && i < text.length
    && text.charCodeAt(i - 1) >= HI && text.charCodeAt(i - 1) < HI_END
    && text.charCodeAt(i) >= LO && text.charCodeAt(i) < LO_END) return i - 1
  return i
}

function snapUp(text, i) {
  if (i > 0 && i < text.length
    && text.charCodeAt(i - 1) >= HI && text.charCodeAt(i - 1) < HI_END
    && text.charCodeAt(i) >= LO && text.charCodeAt(i) < LO_END) return i + 1
  return i
}

function hint(message) {
  const row = document.createElement('div')
  row.className = 'search-hint'
  row.textContent = message
  resultsEl.append(row)
}
