// Windowed chat rendering math — pure module, no DOM. All units are CSS px.
//
// Item i occupies the px range [cum(i), cum(i) + lengths[i]) where
// cum(i) = sum of lengths[0..i-1]. Prefix sums are recomputed per call
// (O(n) adds; fine per spec — a Fenwick tree over a lazily built cum
// array is the upgrade if profiling ever demands it).
//
// windowFor conventions (matching the plan's pinned numbers):
//   start = first item with any overlap with the viewport, minus overscan, clamped ≥ 0
//   end   = exclusive; max(last partially/fully visible item + 1,
//                          last fully visible item + 1 + overscan), clamped to ≤ n
//     — i.e. overscan prefetches past the fully-visible core, but every
//       partially visible item is always rendered, even at overscan 0.
//   padTop    = total height of items before start
//   padBottom = total height of items from end on
// end is clamped inside windowFor (callers never need to clamp).

export function initWindowCalc(items, avgHeight, viewport) {
  return { lengths: Array(items).fill(avgHeight), scrollHeight: items * avgHeight }
}

export function windowFor({ lengths, scrollTop, viewport }, overscan = 8) {
  const n = lengths.length
  if (n === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }

  const cum = new Array(n + 1)
  cum[0] = 0
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + lengths[i]
  const viewTop = scrollTop
  const viewBottom = scrollTop + viewport

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
  if (first < 0) return { start: n, end: n, padTop: cum[n], padBottom: 0 }

  // The viewport can be shorter than one item; then no item is fully visible
  // and lastVis anchors end so every partial item still gets painted.
  const start = Math.max(0, first - overscan)
  const end = Math.min(n, Math.max(lastVis + 1, lastFull + 1 + overscan))
  return { start, end, padTop: cum[start], padBottom: cum[n] - cum[end] }
}

export function remap({ lengths, itemIndex, newHeight }) {
  const next = lengths.slice() // pure: caller pipes the returned lengths onward
  if (itemIndex >= 0 && itemIndex < next.length) next[itemIndex] = newHeight
  return { lengths: next }
}
