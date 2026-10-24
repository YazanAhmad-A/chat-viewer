import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initWindowCalc, windowFor, remap } from '../js/window.js'

// 10 items x avg 100, viewport 400, scrollTop 350, overscan 1 — the brief's pinned case
test('initWindowCalc seeds uniform estimates', () => {
  const init = initWindowCalc(10, 100, 400)
  assert.deepEqual(init.lengths, Array(10).fill(100))
  assert.equal(init.scrollHeight, 1000)
})

test('window covers viewport: items 2..8 exclusive end', () => {
  const init = { lengths: Array(10).fill(100), scrollHeight: 1000 }
  const w = windowFor({ ...init, scrollTop: 350, viewport: 400 }, 1)
  assert.equal(w.start, 2)
  assert.equal(w.end, 8) // exclusive end
  assert.equal(w.padTop, 200) // lengths before 2: 200
  assert.equal(w.padBottom, 200) // from 8: items 8,9 = 200
})

test('uniform-height invariant: pads + rendered span == scrollHeight', () => {
  const init = { lengths: Array(10).fill(100), scrollHeight: 1000 }
  const w = windowFor({ ...init, scrollTop: 350, viewport: 400 }, 1)
  assert.equal(w.padTop + (w.end - w.start) * 100 + w.padBottom, 1000)
})

test('scrollTop 0 clamps start to 0', () => {
  const init = { lengths: Array(10).fill(100), scrollHeight: 1000 }
  const w = windowFor({ ...init, scrollTop: 0, viewport: 400 })
  assert.equal(w.start, 0)
  assert.equal(w.padTop, 0)
})

test('end never points past lengths.length (clamped)', () => {
  const init = { lengths: Array(10).fill(100), scrollHeight: 1000 }
  const w = windowFor({ ...init, scrollTop: 0, viewport: 400 }) // default overscan 8
  assert.ok(w.end <= 10, `end ${w.end} must be <= lengths.length`)
  assert.ok(w.padBottom >= 0)
})

test('remap replaces the estimate; derived sum ripples', () => {
  const { lengths } = remap({ lengths: Array(10).fill(100), itemIndex: 3, newHeight: 250 })
  assert.equal(lengths[3], 250)
  assert.equal(lengths.reduce((a, b) => a + b, 0), 1150)
})

test('remap is pure: input lengths untouched', () => {
  const input = Array(10).fill(100)
  remap({ lengths: input, itemIndex: 3, newHeight: 250 })
  assert.deepEqual(input, Array(10).fill(100))
})

test('empty lengths does not crash', () => {
  const w = windowFor({ lengths: [], scrollTop: 350, viewport: 400 })
  assert.deepEqual(w, { start: 0, end: 0, padTop: 0, padBottom: 0 })
})
