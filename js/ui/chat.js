// Chat screen — windowed rendering over the FULL message array of a
// conversation. There is one scroll container (#chat-scroll) holding a
// spacer sandwich: [padTop][pool of live bubbles][padBottom]. Heights start
// as a uniform 64px estimate (js/window.js math) and converge on reality
// because every mounted bubble is measured in the same rAF frame that laid
// it out, with corrections folded back via ONE remapMany call per frame.
// overflow-anchor is disabled, so the frame also compensates the scroll for
// corrections above the viewport's top edge (see runFrame) — nothing the
// reader sees moves when first-seen rows prove taller or shorter than 64px.
//
// Navigation contract (module-level mini-router, no routing lib):
//   showChat() / showHome()  — flip the [hidden] attributes of #home / #chat.
//   openChat(fileName, store, opts) -> Promise<{ close(), highlightMessage }>
//     resolves after the conversation is loaded AND painted once.
//     opts.onBack: called after close() so home can refresh its list.
//     opts.initialIndex: optional message index to land on instead of the
//     saved scroll position (used by a reader that already knows a target).
//
// Task 9 seam: the search overlay (js/ui/search.js) reads the conversation
// via the module-local session and calls handle.highlightMessage /
// requestHighlight — scrolls to that bubble, measures its real position,
// then outlines it #ff8a00 for 2s. highlightMessage calls made while the
// chat hasn't finished settling are queued and applied on the first settled
// frame. The header search button opens the overlay.

import { initWindowCalc, windowFor, remapMany } from '../window.js'
import { initSearch } from './search.js'

const AVG_HEIGHT = 64        // initial per-message estimate, plan-pinned
const MAX_GROW_STEP = 64     // rows mounted incrementally per frame before a hard reset
const HIGHLIGHT_MS = 2000    // orange ping duration
const HIGHLIGHT_TOP = 0.3    // place the pinged bubble near the viewport's top third
const RESTORE_TOLERANCE = 60 // px of drift we're willing to re-pin after the first settle

// DOM owned by this module (declared in index.html's #chat skeleton).
const chatSection = document.getElementById('chat')
const homeSection = document.getElementById('home')
const scrollEl = document.getElementById('chat-scroll')
const padTopEl = document.getElementById('chat-pad-top')
const poolEl = document.getElementById('chat-pool')
const padBottomEl = document.getElementById('chat-pad-bottom')
const backBtn = document.getElementById('chat-back-btn')
const searchBtn = document.getElementById('chat-search-btn')

// Rest state per conversation: scrollTop at close time, and the measured
// height vector from the last session. Reopening reuses them, so the
// restored scroll lands EXACTLY where the reader left off (uncached heights
// fall back to estimate-based restore, which re-pins within a tolerance).
// A reimported file with a different shape (count or last message changed)
// drops the cache and re-converges. Heights vectors are treated as immutable
// (remapMany returns fresh arrays), so sharing them with the cache is safe.
const scrollPositions = new Map()
const heightCache = new Map()

let session = null
let openSeq = 0
let rafId = 0
let wired = false
let searchOverlay = null // set once in wire(); fallback for pre-wire clicks

// Handle for a superseded openChat call (two rapid row taps): harmless
// no-ops rather than null, so callers never deref-guard.
const DETACHED_HANDLE = Object.freeze({
  close() {},
  highlightMessage() {},
})

function wire() {
  if (wired) return
  wired = true

  backBtn.addEventListener('click', () => closeSession())

  // SEARCH BUTTON — opens the search overlay (js/ui/search.js). The overlay
  // reads the conversation through THIS module's live session instead of
  // re-fetching from the store (a mid-search re-import could race a fetch);
  // highlightMessage is requestHighlight itself, which no-ops once the
  // session is detached — see the seam comment atop js/ui/search.js.
  searchOverlay = initSearch(() => {
    const s = session
    if (!s || s.detached) return null
    return {
      fileName: s.fileName,
      messages: s.conv.messages,
      highlightMessage: requestHighlight,
    }
  })
  searchBtn.addEventListener('click', () => searchOverlay?.open())

  scrollEl.addEventListener('scroll', scheduleFrame, { passive: true })
  window.addEventListener('resize', scheduleFrame)
}

// ---- Mini-router ------------------------------------------------------------

export function showChat() {
  homeSection.hidden = true
  chatSection.hidden = false
}

export function showHome() {
  chatSection.hidden = true
  homeSection.hidden = false
}

// ---- Open / close -----------------------------------------------------------

export function openChat(fileName, store, opts = {}) {
  const seq = ++openSeq
  return loadSession(fileName, store, opts, seq).catch((err) => {
    // Never leave the app stuck on a half-rendered chat screen; home toasts
    // the rejection to the user.
    showHome()
    throw err
  })
}

async function loadSession(fileName, store, opts, seq) {
  const conv = await store.get(fileName)
  if (seq !== openSeq) return DETACHED_HANDLE
  if (!conv) throw new Error(`Conversation "${fileName}" was not found in storage`)

  releaseSession() // a previous chat, if any, commits its rest state without navigating
  try {
    showChat()
    session = beginSession(fileName, conv, opts)
  } catch (err) {
    showHome()
    throw err
  }
  return {
    close: closeSession,
    highlightMessage: (messageIndex) => requestHighlight(messageIndex),
  }
}

// Close from the back button (or any consumer of the returned handle):
// commit rest state, go home, hand control back to home to refresh its list.
function closeSession() {
  const s = session
  if (s) releaseSession()
  showHome()
  if (s) {
    const onBack = s.opts?.onBack
    if (onBack) Promise.resolve().then(onBack).catch((err) => console.error('home refresh failed:', err))
  }
}

// Persists scroll + measured heights and stops the frame engine. Does NOT
// touch screen visibility — callers own navigation.
function releaseSession() {
  const s = session
  if (!s) return
  s.detached = true
  session = null
  // The sheet lives inside #chat; a chat close must drop its context
  // snapshot so the overlay can never outlive the conversation it searched
  // (closing hides it; reopening any chat starts with a clean sheet).
  searchOverlay?.close()
  if (rafId !== 0) { cancelAnimationFrame(rafId); rafId = 0 }
  clearTimeout(s.highlightTimer)
  scrollPositions.set(s.fileName, scrollEl.scrollTop)
  heightCache.set(s.fileName, {
    count: s.conv.messages.length,
    last: s.conv.last,
    lengths: s.lengths,
  })
  // Unmount everything so the hidden screen holds no stale DOM.
  poolEl.replaceChildren()
}

function beginSession(fileName, conv, opts) {
  const messages = conv.messages ?? []
  const n = messages.length
  // Sides rule: whoever sent the LAST message is the "own" (right/green) side.
  const ownSender = n > 0 ? messages[n - 1].sender : null

  const savedTop = scrollPositions.get(fileName) ?? 0
  const cached = heightCache.get(fileName)
  const heights = cached && cached.count === n && cached.last === conv.last
    ? cached.lengths // heights converged by the previous visit — restore is exact
    : initWindowCalc(n, AVG_HEIGHT, scrollEl.clientHeight).lengths

  const initialIndex = Number.isInteger(opts.initialIndex) ? opts.initialIndex : null
  // Rest position: explicit target wins, else where the reader closed last time.
  const rawTop = initialIndex != null
    ? cumulative(heights, initialIndex)
    : savedTop
  const startTop = Math.max(0, rawTop - (initialIndex != null ? scrollEl.clientHeight * HIGHLIGHT_TOP : 0))

  poolEl.replaceChildren()

  const s = {
    fileName,
    conv,
    opts,
    ownSender,
    lengths: heights,
    first: null, // lowest mounted index (null = pool empty)
    last: null,  // highest mounted index, exclusive
    settled: false,
    jumped: false,
    pendingHighlightIndex: null,
    initialIndex,
    savedTop,
    startTop,
    highlightTimer: 0,
    highlightedRow: null,
    afterFrame: null,
    detached: false,
  }

  // First synchronous paint: mount the window at the rest position, set the
  // pads, then pin the scroll — the screen never appears empty and a reopen
  // lands in one shot (the rAF pass right after fixes the estimates).
  const win = windowFor({ lengths: heights, scrollTop: startTop, viewport: scrollEl.clientHeight })
  reconcile(s, win)
  setPads(win.start, win.end, heights)
  scrollEl.offsetHeight // force layout so scrollTop clamps against the fresh pads
  scrollEl.scrollTop = startTop
  scheduleFrame()
  return s
}

// ---- Public highlight seam (Task 9 will call this) --------------------------

function requestHighlight(i) {
  const s = session
  if (!s || s.detached) return
  if (!Number.isInteger(i) || i < 0 || i >= s.conv.messages.length) return
  if (!s.settled) {
    // Called before the chat finished painting: queue it, settle() applies it.
    s.pendingHighlightIndex = i
    return
  }
  jumpToMessage(i)
}

function jumpToMessage(i) {
  const s = session
  if (!s || s.detached) return
  s.jumped = true
  scrollEl.scrollTop = Math.max(0, cumulative(s.lengths, i) - scrollEl.clientHeight * HIGHLIGHT_TOP)
  // After the scroll's own rAF frame (mount + measure), nudge onto the true
  // bubble position — estimates around the jump are corrected by then.
  s.afterFrame = () => nudgeToIndex(i)
  scheduleFrame()
}

function nudgeToIndex(i) {
  const s = session
  if (!s || s.detached) return
  const row = rowByIndex(poolEl.children, i)
  if (row) {
    const want = scrollEl.clientHeight * HIGHLIGHT_TOP
    const have = row.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
    const delta = have - want
    if (Math.abs(delta) > 1) scrollEl.scrollTop += delta // fires another scroll frame (pads shift accordingly)
  }
  outlineMessage(i)
}

function outlineMessage(i) {
  const s = session
  if (!s || s.detached) return
  const row = rowByIndex(poolEl.children, i)
  if (!row) return
  clearTimeout(s.highlightTimer)
  const previous = s.highlightedRow
  if (previous && previous !== row) previous.classList.remove('msg-highlight')
  row.classList.add('msg-highlight')
  s.highlightedRow = row
  s.highlightTimer = setTimeout(() => { row.classList.remove('msg-highlight') }, HIGHLIGHT_MS)
}

function rowByIndex(children, i) {
  for (const row of children) {
    if (Number(row.dataset.index) === i) return row
  }
  return null
}

// ---- Frame engine -----------------------------------------------------------

function scheduleFrame() {
  if (rafId === 0) rafId = requestAnimationFrame(runFrame)
}

function runFrame() {
  rafId = 0
  const s = session
  if (!s || s.detached) return
  const viewport = scrollEl.clientHeight
  let scrollTop = scrollEl.scrollTop // may be re-read after compensation below

  // 1. Window under the height estimates as they stand, then reconcile DOM.
  let win = windowFor({ lengths: s.lengths, scrollTop, viewport })
  reconcile(s, win)

  // 2. Measure what is mounted; fold the whole frame's corrections into
  //    ONE remapMany call (a single copy of the heights vector per frame).
  const updates = measurePool(s.lengths)
  if (updates.length > 0) {
    const previous = s.lengths
    // Scroll compensation (we set overflow-anchor:none on #chat-scroll, so
    // the browser's scroll anchoring is off and WE own it): a correction to
    // a row strictly above the row under the viewport's top edge shifts
    // everything the reader sees by its delta, so add Σ(new−old) for those
    // indices back to scrollTop. The anchor row itself and anything below
    // only move content beneath the reading line — no compensation needed.
    // scrollTop == 0 pins the top of the chat (anchor is row 0 → empty sum;
    // we also skip outright) so the compensation never fights the reader there.
    const anchor = anchorIndex(previous, scrollTop)
    s.lengths = remapMany({ lengths: previous, updates }).lengths
    if (anchor > 0) {
      let shift = 0
      for (const u of updates) {
        if (u.itemIndex < anchor) shift += u.newHeight - previous[u.itemIndex]
      }
      if (shift !== 0) {
        scrollEl.scrollTop += shift
        scrollTop = scrollEl.scrollTop // read back: the browser may clamp
      }
    }
  }

  // 3. Heights changed → recompute the window once against the corrected
  //    vector AND the compensated scroll position, so padTop/padBottom never
  //    disagree with what is rendered.
  win = windowFor({ lengths: s.lengths, scrollTop, viewport })
  reconcile(s, win)
  setPads(win.start, win.end, s.lengths)

  // 4. One-time post-first-paint work: queued highlight, scroll re-pin.
  if (!s.settled) settle(s)

  // 5. After-frame follow-up (highlight landing nudge).
  const followUp = s.afterFrame
  if (followUp) { s.afterFrame = null; followUp() }
}

// After the first full render pass: honor a highlight queued before the chat
// settled, otherwise re-pin the restored scroll if the first measured frame
// shifted nearby content (only when the reader hasn't scrolled away).
function settle(s) {
  s.settled = true
  if (s.pendingHighlightIndex != null) {
    const i = s.pendingHighlightIndex
    s.pendingHighlightIndex = null
    jumpToMessage(i)
    return
  }
  if (!s.jumped && s.savedTop > 0 && Math.abs(scrollEl.scrollTop - s.savedTop) <= RESTORE_TOLERANCE) {
    scrollEl.scrollTop = s.savedTop
  }
}

// ---- Pool reconciliation ----------------------------------------------------

// Keeps pool children exactly the ascending index range [s.first, s.last).
// Small drifts (normal reading: a row or two per frame) take the incremental
// prepend/append/trim path. Only a GROW side can be unbounded, so when one
// would mount more than MAX_GROW_STEP rows at once — an estimate jump after
// remeasure, a fast fling to the bottom, a far restore/highlight scroll —
// the pool hard-resets to exactly the window, which is bounded
// (~viewport/AVG + 2×overscan rows); no path schedules a huge DOM insertion.
function reconcile(s, win) {
  const { start, end } = win
  const first = s.first
  const last = s.last

  const emptyPool = first == null
  const noOverlap = first != null && (start >= last || end <= first)
  // Only a GROW side can be unbounded: the pool being replaced is always
  // window-sized, so trims are inherently bounded.
  const growsAbove = Math.max(0, first - start)
  const growsBelow = Math.max(0, end - last)
  const oversized = growsAbove > MAX_GROW_STEP || growsBelow > MAX_GROW_STEP
  if (emptyPool || noOverlap || oversized) {
    poolEl.replaceChildren()
    if (end > start) poolEl.append(fragmentFor(s, start, end))
    s.first = start
    s.last = end
    return
  }

  let up = first
  let down = last
  if (start < first) {
    poolEl.insertBefore(fragmentFor(s, start, first), poolEl.firstChild)
    up = start
  }
  if (end > last) {
    poolEl.append(fragmentFor(s, last, end))
    down = end
  }
  while (up < start) { poolEl.firstChild.remove(); up += 1 }
  while (down > end) { poolEl.lastChild.remove(); down -= 1 }

  s.first = up
  s.last = down
}

function fragmentFor(s, from, to) {
  const frag = document.createDocumentFragment()
  for (let i = from; i < to; i++) frag.append(rowFor(s, i))
  return frag
}

function rowFor(s, i) {
  const message = s.conv.messages[i]
  const row = document.createElement('div')
  // Green right side = message.sender of the conversation's LAST message.
  row.className = message.sender === s.ownSender ? 'msg own' : 'msg other'
  row.dataset.index = String(i)

  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.dir = 'rtl'

  const name = document.createElement('div')
  name.className = 'msg-name'
  name.textContent = message.sender

  // dir="auto" on the text node: inline English keeps its natural bidi while
  // the bubble umbrella is RTL; pre-wrap (CSS) keeps newlines from the export.
  // textContent only — never innerHTML — so messages can't inject markup.
  const text = document.createElement('div')
  text.className = 'msg-text'
  text.dir = 'auto'
  text.textContent = message.text

  bubble.append(name, text)
  row.append(bubble)
  return row
}

function measurePool(lengths) {
  const updates = []
  for (const row of poolEl.children) {
    const i = Number(row.dataset.index)
    if (!(i >= 0 && i < lengths.length)) continue
    const h = row.getBoundingClientRect().height
    if (h !== lengths[i]) updates.push({ itemIndex: i, newHeight: h })
  }
  return updates
}

// First item whose span intersects the viewport's top edge — the same
// convention windowFor uses internally for its `first` visible item (kept
// local rather than widening the pure math module's surface). Items with a
// correction at an index below this are above the reader's anchor line.
// Returns -1 when the scroll position is past all content (no visible row).
function anchorIndex(lengths, scrollTop) {
  let cum = 0
  for (let i = 0; i < lengths.length; i++) {
    if (cum + lengths[i] > scrollTop) return i
    cum += lengths[i]
  }
  return -1
}

// ---- Pads -------------------------------------------------------------------

// padTop = exact sum of heights of items before [start), padBottom of items
// from [end) on — so unmounting items at an edge while their height moves
// into the pad happens in the same layout commit: the content below/above
// never shifts.
function setPads(start, end, lengths) {
  let top = 0
  for (let i = 0; i < start; i++) top += lengths[i]
  let bottom = 0
  for (let i = end; i < lengths.length; i++) bottom += lengths[i]
  padTopEl.style.height = top + 'px'
  padBottomEl.style.height = bottom + 'px'
}

function cumulative(lengths, i) {
  let total = 0
  for (let k = 0; k < i; k++) total += lengths[k]
  return total
}

wire()
