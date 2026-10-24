// Windowed chat rendering math — pure module, no DOM. All units are CSS px.
//
// Item i occupies the px range [cum(i), cum(i) + lengths[i]) where
// cum(i) = sum of lengths[0..i-1].
//
// Perf model (post huge-chat profiling): for chats up to ENGINE_MIN items the
// math stays the plain O(n) scans (identical arithmetic, tiny n). Beyond that
// a lazily-built CHUNK-SUM engine rides on the lengths array itself (WeakMap
// keyed by array identity): n/CHUNK_ROWS Float64 chunk totals replace the
// per-call O(n) cum array and scan. Lump sums keep bit-exact order (chunks sum
// left-to-right like the flat walk), so results are identical in value.
//
// INVARIANCE RULE: the engine stays exact only if heights change EXCLUSIVELY
// through remapMany/remap (which folds each delta into its chunk total, O(1)
// per update). Nothing else may write into a lengths array owned by a chat
// session. remapMany on an engine-backed vector mutates in place (zero-copy
// churn per frame — the 800k-row slice-per-frame allocation was the phone
// killer); on engineless vectors it keeps the historical pure-copy behavior.
//
// windowFor conventions (matching the plan's pinned numbers):
//   first  = first item with any overlap with the viewport's top edge region
//            (first intersecting item; -1 when scrolled past all content)
//   start = first intersecting item, minus overscan, clamped ≥ 0
//   end   = exclusive; max(last partially/fully visible item + 1,
//                          last fully visible item + 1 + overscan), clamped to ≤ n
//     — i.e. overscan prefetches past the fully-visible core, but every
//       partially visible item is always rendered, even at overscan 0.
//   padTop    = total height of items before start
//   padBottom = total height of items from end on
// end is clamped inside windowFor (callers never need to clamp).

const ENGINE_MIN = 4096  // below this n the direct path is used (bit-for-bit legacy behavior)
const CHUNK_ROWS = 512   // engine granularity: O(n/512) lookups + ≤512-row intra-chunk scans

const engines = new WeakMap()

function buildEngine(lengths) {
  const n = lengths.length
  const k = Math.ceil(n / CHUNK_ROWS)
  const sums = new Float64Array(k)
  let total = 0
  for (let c = 0; c < k; c++) {
    let part = 0
    const e = Math.min(n, (c + 1) * CHUNK_ROWS)
    for (let i = c * CHUNK_ROWS; i < e; i++) part += lengths[i]
    sums[c] = part
    total += part
  }
  const eng = { sums, total }
  engines.set(lengths, eng)
  return eng
}

function engineFor(lengths) {
  return engines.get(lengths) ?? buildEngine(lengths)
}

// cum(i) for i in [0..n]: walked chunk totals + at most CHUNK_ROWS adds.
// Same left-to-right add order as the flat walk — identical fp result.
function cumTo(lengths, eng, i) {
  const chunks = Math.floor(i / CHUNK_ROWS)
  let sum = 0
  for (let c = 0; c < chunks; c++) sum += eng.sums[c]
  for (let j = chunks * CHUNK_ROWS; j < i; j++) sum += lengths[j]
  return sum
}

export function initWindowCalc(items, avgHeight, viewport) {
  const lengths = Array(items).fill(avgHeight)
  if (items >= ENGINE_MIN) buildEngine(lengths)
  return { lengths, scrollHeight: items * avgHeight }
}

export function windowFor({ lengths, scrollTop, viewport }, overscan = 8) {
  const n = lengths.length
  if (n === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }

  const viewTop = scrollTop
  const viewBottom = scrollTop + viewport

  if (n < ENGINE_MIN) {
    const cum = new Array(n + 1)
    cum[0] = 0
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + lengths[i]

    // First/last items intersecting the viewport; last item fully inside it.
    let first = -1
    let lastVis = -1
    let lastFull = -1
    for (let i = 0; i < n; i++) {
      if (cum[i] >= viewBottom) break // nothing further can intersect
      if (cum[i + 1] <= viewTop) continue // entirely above the viewport
      if (first < 0) first = i
      lastVis = i
      if (cum[i] >= viewTop && cum[i + 1] <= viewBottom) lastFull = i
    }

    // Scrolled past all content (scrollTop >= total height): nothing to paint.
    if (first < 0) return { first: -1, start: n, end: n, padTop: cum[n], padBottom: 0 }

    // The viewport can be shorter than one item; then no item is fully visible
    // and lastVis anchors end so every partial item still gets painted.
    const start = Math.max(0, first - overscan)
    const end = Math.min(n, Math.max(lastVis + 1, lastFull + 1 + overscan))
    return { first, start, end, padTop: cum[start], padBottom: cum[n] - cum[end] }
  }

  // ---- engine path (huge chats) ---------------------------------------------
  const eng = engineFor(lengths)
  if (viewTop >= eng.total) {
    return { first: -1, start: n, end: n, padTop: eng.total, padBottom: 0 }
  }

  // Skip chunks ending at/before viewTop (same skip condition the flat item
  // loop applies, one level up: every item in such a chunk ends ≤ viewTop).
  let c = 0
  let base = 0
  while (c < eng.sums.length - 1 && base + eng.sums[c] <= viewTop) {
    base += eng.sums[c]
    c++
  }

  // Sequential item walk from the first candidate chunk, identical conditions
  // to the flat loop. Bound: items from the first intersecting chunk to the
  // chunk holding viewBottom — a couple of chunk-widths, never O(n).
  let first = -1
  let lastVis = -1
  let lastFull = -1
  let cum = base
  for (let i = c * CHUNK_ROWS; i < n && cum < viewBottom; i++) {
    const h = lengths[i]
    if (cum + h > viewTop) { // not entirely above the viewport
      if (first < 0) first = i
      lastVis = i
      if (cum >= viewTop && cum + h <= viewBottom) lastFull = i
    }
    cum += h
  }

  if (first < 0) return { first: -1, start: n, end: n, padTop: eng.total, padBottom: 0 }

  const start = Math.max(0, first - overscan)
  const end = Math.min(n, Math.max(lastVis + 1, lastFull + 1 + overscan))
  return { first, start, end, padTop: cumTo(lengths, eng, start), padBottom: eng.total - cumTo(lengths, eng, end) }
}

// Applies ALL height updates in one batch. On an engine-backed lengths vector
// this mutates in place and keeps the chunk sums exact (O(1) per update) —
// callers must have finished reading any pre-batch snapshot first. On a plain
// vector (no engine, small n and the legacy contract) it copies instead.
// Task 8 calls this once per frame-batch of remeasures instead of one remap
// per message.
export function remapMany({ lengths, updates }) {
  const eng = engines.get(lengths)
  if (!eng) {
    const next = lengths.slice() // pure path: caller pipes the returned lengths onward
    if (updates) {
      for (const { itemIndex, newHeight } of updates) {
        if (itemIndex >= 0 && itemIndex < next.length) next[itemIndex] = newHeight
      }
    }
    return { lengths: next }
  }
  if (updates) {
    for (const { itemIndex, newHeight } of updates) {
      if (itemIndex >= 0 && itemIndex < lengths.length) {
        const delta = newHeight - lengths[itemIndex]
        eng.sums[(itemIndex / CHUNK_ROWS) | 0] += delta
        eng.total += delta
        lengths[itemIndex] = newHeight
      }
    }
  }
  return { lengths }
}

// Thin wrapper over remapMany (single update) — keeps the plan's pinned
// contract working; prefer remapMany when batching reveals.
export function remap({ lengths, itemIndex, newHeight }) {
  return remapMany({ lengths, updates: [{ itemIndex, newHeight }] })
}
