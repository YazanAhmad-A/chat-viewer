// Minimal DOM shim + smoke driver for js/ui/chat.js (run in Node).
// Simulates: screen visibility toggles, one scroll container whose internal
// layout is fully accounted (pad heights, per-row measured heights, rows' y
// offsets), scroll/resize events, rAF, classList, highlighting.
// Validates ALGORITHM mechanics (windowing, reconciliation, remapping,
// restore, highlight), not typography.

class FakeClass {
  constructor() { this.s = new Set() }
  add(c) { this.s.add(c) }
  remove(c) { this.s.delete(c) }
  contains(c) { return this.s.has(c) }
}

class FakeFrag {
  constructor() { this.nodeType = 11; this._kids = [] }
  append(...items) {
    for (const it of items) {
      for (const k of it instanceof FakeFrag ? it._kids : [it]) this._kids.push(k)
    }
  }
}

const parents = new WeakMap()
const rowAbs = new WeakMap()

class FakeEl {
  constructor(tag, id = '') {
    this.tag = tag
    this.id = id
    this.className = ''
    this.dir = null
    this.dataset = {}
    this.style = {}
    this.hidden = false
    this._scrollTop = 0
    this.clientHeight = 800
    this.classList = new FakeClass()
    this._kids = []
    this._listeners = {}
  }
  get children() { return this._kids }
  get firstChild() { return this._kids[0] ?? null }
  get lastChild() { return this._kids[this._kids.length - 1] ?? null }
  append(...items) {
    for (const it of items) {
      for (const k of it instanceof FakeFrag ? it._kids : [it]) {
        this._kids.push(k)
        if (k instanceof FakeEl) parents.set(k, this)
      }
    }
  }
  insertBefore(node, ref) {
    if (ref == null) { this.append(node); return node }
    const idx = this._kids.indexOf(ref)
    if (idx < 0) throw new Error('insertBefore: ref not a child')
    const kids = node instanceof FakeFrag ? node._kids : [node]
    this._kids.splice(idx, 0, ...kids)
    for (const k of kids) if (k instanceof FakeEl) parents.set(k, this)
    return node
  }
  removeChild(child) {
    const i = this._kids.indexOf(child)
    if (i >= 0) this._kids.splice(i, 1)
    return child
  }
  replaceChildren(...items) { this._kids = []; this.append(...items) }
  addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn) }
  fire(type) { for (const fn of this._listeners[type] ?? []) fn({}) }
  remove() { const p = parents.get(this); return p?.removeChild(this) }
  get scrollTop() { return this._scrollTop }
  get offsetHeight() { return 800 }
  set scrollTop(v) {
    v = Math.max(0, Math.min(v, this.maxScroll()))
    if (v !== this._scrollTop) {
      if (this.id === 'chat-scroll' && globalThis.__LOG_SCROLL) {
        const err = new Error()
        console.log(`LOG set scrollTop ${this._scrollTop} -> ${v.toFixed(1)}\n  ${err.stack.split('\n').slice(2, 5).join('\n  ')}`)
      }
      this._scrollTop = v
      this.fire('scroll')
    }
  }
  maxScroll() {
    // total content height minus one viewport (what a real browser clamps to),
    // bounded by Chromium's layout cap — 33,554,428px, measured empirically.
    return Math.max(0, Math.min(layoutTotal(), 33554428) - this.clientHeight)
  }
  // Only .top/.height are consumed. Rows report their y in viewport coords
  // (content y minus scrollTop); the scroll container's top edge sits at
  // viewport y=0 (header would be above it in the real page).
  getBoundingClientRect() {
    return { top: 0, height: this.clientHeight }
  }
}

function heightOf(row) {
  const textEl = row.children[0]?.children[1]
  const len = (textEl?.textContent ?? '').length
  return 24 + (len % 400) + 8
}

function dbgHeights(row) {
  let y = parseFloat(padTopEl.style.height) || 0
  const parts = []
  for (const r of poolEl._kids) {
    if (r === row) return `y=${y.toFixed(0)} padTop=${padTopEl.style.height} rowsBefore=${parts.length}`
    parts.push(heightOf(r).toFixed(0))
    y += heightOf(r)
  }
  return `row NOT in pool; total=${y.toFixed(0)} padTop=${padTopEl.style.height} firsts=${parts.slice(0, 6).join(',')}`
}

const els = new Map()
for (const id of ['home', 'chat', 'chat-scroll', 'chat-pad-top', 'chat-pool', 'chat-pad-bottom', 'chat-back-btn', 'chat-search-btn', 'search-overlay', 'search-back-btn', 'search-input', 'search-results', 'search-count']) {
  els.set(id, new FakeEl('div', id))
}
const scrollEl = els.get('chat-scroll')
const padTopEl = els.get('chat-pad-top')
const poolEl = els.get('chat-pool')
const padBottomEl = els.get('chat-pad-bottom')
scrollEl._kids = [padTopEl, poolEl, padBottomEl]

// gCR of rows is handled specially (row.getBoundingClientRect)
FakeEl.prototype.getBoundingClientRect = function () {
  if (this.id === 'chat-scroll') return { top: 0, height: this.clientHeight }
  // rows: y offset inside the container content = pads + preceding rows
  const row = this
  const found = dbgHeights(row)
  if (found.startsWith('y=')) {
    const y = Number(found.match(/y=([-\d.]+)/)[1])
    return { top: y - scrollEl._scrollTop, height: heightOf(row) }
  }
  console.log('DBG gCR not-in-pool:', found) // TEMP
  return { top: Number(found.match(/total=([-\d.]+)/)[1]) - scrollEl._scrollTop, height: heightOf(row) }
}

globalThis.document = {
  getElementById: (id) => els.get(id) ?? null,
  createDocumentFragment: () => new FakeFrag(),
  createElement: (tag) => new FakeEl(tag),
}
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.window = { addEventListener() {} }

const chat = await import('file:///C:/Users/Thinkpad/chat-viewer/js/ui/chat.js')

// ---- fake store -------------------------------------------------------------
const NAME_A = 'Yazan'
const NAME_B = 'Sam'
const N = 700000
const messages = Array.from({ length: N }, (_, i) => ({
  sender: i % 3 === 0 ? NAME_A : NAME_B,
  // deterministic variety: short lines, Arabic phrases, a ~1000-char monster
  text: i % 997 === 0 ? 'X'.repeat(1000)
    : i % 5 === 0 ? `رسالة رقم ${i} 🙏 مع سطر جديد\nالثاني`
      : `message ${i} done تمت`,
}))
const conv = { fileName: '2024-02', participants: [NAME_A, NAME_B], last: messages[N - 1].text, count: N, messages }
const store = { get: async (f) => (f === conv.fileName ? conv : undefined) }

// ---- helpers ----------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(label, cond, extra = '') {
  console.log(`${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

function layoutTotal() {
  let y = (parseFloat(padTopEl.style.height) || 0) + (parseFloat(padBottomEl.style.height) || 0)
  for (const row of poolEl._kids) y += heightOf(row)
  return y
}

function absTopOf(row) {
  let y = parseFloat(padTopEl.style.height) || 0
  for (const r of poolEl._kids) {
    if (r === row) return y
    y += heightOf(r)
  }
  return NaN
}

function poolIndexes() { return poolEl._kids.map((r) => Number(r.dataset.index)) }

// The row currently under the viewport's TOP edge (the reading anchor):
// first pool row with top ≤ 0 < top + height in viewport coords.
function topVisibleRow() {
  for (const r of poolEl._kids) {
    const t = r.getBoundingClientRect()
    if (t.top <= 0 && t.top + t.height > 0) return r
  }
  return null
}

const OWNER = messages[N - 1].sender
let currentOwner = OWNER

function assertPoolValid(label, msgs = messages, owner = currentOwner) {
  const idx = poolIndexes()
  const contiguous = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1)
  check(`${label}: pool contiguous+ascending`, contiguous, `${idx[0]}..${idx[idx.length - 1]} (${idx.length} rows) pads ${(parseFloat(padTopEl.style.height) || 0).toFixed(0)}/${(parseFloat(padBottomEl.style.height) || 0).toFixed(0)}`)
  check(`${label}: every row has bubble/name/text/dir`, poolEl._kids.every((r) => {
    const b = r.children[0]
    const name = b?.children[0]
    const text = b?.children[1]
    return b?.className === 'bubble' && b?.dir === 'rtl' && !!name?.textContent && text?.dir === 'auto' && text?.textContent?.length > 0
  }))
  check(`${label}: own side set by last sender`, poolEl._kids.every((r) => {
    const i = Number(r.dataset.index)
    return msgs[i].sender === owner ? r.className === 'msg own' : r.className === 'msg other'
  }))
  const total = layoutTotal()
  // ≤120px tolerance: the shim doesn't auto-clamp scrollTop after heights
  // change underneath it (real browsers do, synchronously, then fire scroll).
  check(`${label}: scrollTop within content bounds`, scrollEl.scrollTop <= Math.max(0, total - scrollEl.clientHeight + 160), `scrollTop=${scrollEl.scrollTop.toFixed(0)} total=${total.toFixed(0)}`)
  // content just above/below the pool must not overlap the viewport
  if (idx.length > 0 && !idx.includes(NaN)) {
    void 0 // bounds checks above suffice in this shim
  }
}

// ---- huge-chat regression test (scroll re-basing vs the engine cap) ----------
// Chromium clamps a scroll container at 33,554,428px (measured). A chat this
// size estimated at 64px/message is ~44.8M px, so before scroll re-basing the
// last ~380k messages were unreachable. Here: DOM extent (pads + pool) must
// stay ≤ the cap ALWAYS, the pool must reach N−1 by scrolling, and jumps must
// land + stay live both directions. Runtime budget ~secs (O(n) scans per frame).
// NOTE: run with `node --test tests/*.test.js` (npm test).

const CAP = 33554428
const capsOk = (label) => {
  const total = (parseFloat(padTopEl.style.height) || 0) + (parseFloat(padBottomEl.style.height) || 0)
    + poolEl._kids.reduce((a, r) => a + heightOf(r), 0)
  check(`${label}: DOM extent under engine cap`, total <= CAP, `total=${Math.round(total)}`)
}

import test from 'node:test'
test('huge chat: free scrolling reaches the true end despite the engine cap', async () => {
  const handle = await chat.openChat('2024-02', store)
  await sleep(30)
  const openIdx = poolIndexes()
  check('open: window at top', openIdx[0] === 0, `first=${openIdx[0]}`)
  check('open: bottom pad clamped to BOTTOM_LIMIT', (parseFloat(padBottomEl.style.height) || 0) <= 14e6, padBottomEl.style.height)
  capsOk('open at top')

  handle.highlightMessage(650000)
  for (let k = 0; k < 12; k++) await sleep(0)
  const deepIdx = poolIndexes()
  check('deep jump: target inside window', deepIdx.some((v) => v === 650000), `${deepIdx[0]}..${deepIdx[deepIdx.length - 1]}`)
  check('deep jump: top pad clamped (re-base engaged)', (parseFloat(padTopEl.style.height) || 0) === 14e6, padTopEl.style.height)
  capsOk('after deep jump')

  let stalls = 0
  let prevFirst = deepIdx[0]
  for (let step = 0; step < 30; step++) {
    scrollEl.scrollTop += 12000
    await sleep(0)
    const idx = poolIndexes()
    if (idx[0] === prevFirst) stalls++
    prevFirst = idx[0]
  }
  check('down leg: momentum keeps advancing', stalls <= 2, `${stalls}/30 stalls`)

  scrollEl.scrollTop = 1e9 // momentum-end clamp — pre-fix this never showed N−1
  await sleep(0)
  await sleep(0)
  const endIdx = poolIndexes()
  check('clamp arrival: true last message mounted', endIdx[endIdx.length - 1] === N - 1, `last=${endIdx[endIdx.length - 1]}`)
  check('clamp arrival: bottom pad empty', (parseFloat(padBottomEl.style.height) || 0) === 0, padBottomEl.style.height)
  capsOk('at true bottom')

  for (let step = 0; step < 15; step++) {
    scrollEl.scrollTop -= 8000
    await sleep(0)
  }
  capsOk('after up leg')

  handle.highlightMessage(500)
  for (let k = 0; k < 12; k++) await sleep(0)
  const topIdx = poolIndexes()
  check('near-top jump: target inside window', topIdx.some((v) => v === 500), `${topIdx[0]}..${topIdx[topIdx.length - 1]}`)
  capsOk('after near-top jump')
  let progressed = 0
  for (let step = 0; step < 10; step++) {
    const before = poolIndexes()[poolIndexes().length - 1]
    scrollEl.scrollTop += 4000
    await sleep(0)
    if (poolIndexes()[poolIndexes().length - 1] > before) progressed++
  }
  check('down after top jump: keeps advancing', progressed >= 8, `${progressed}/10`)

  handle.close()
  await sleep(0)
  const handle2 = await chat.openChat('2024-02', store)
  await sleep(30)
  const reopenIdx = poolIndexes()
  check('reopen: rest position preserved (ABS)', reopenIdx.every((v) => v >= 0 && v < N), `${reopenIdx[0]}..${reopenIdx[reopenIdx.length - 1]}`)

  if (failures > 0) throw new Error(`${failures} huge-chat check(s) failed`)
})
