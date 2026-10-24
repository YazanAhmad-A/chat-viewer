import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeArabic, normalizeWithMap, findMatches } from '../js/search.js'

test('folds hamza and diacritics', () => {
  assert.equal(normalizeArabic('إحَم'), normalizeArabic('احم'))
  assert.equal(normalizeArabic('أنا'), 'انا')
})
test('case-folds english', () => assert.equal(normalizeArabic('Zeft'), 'zeft'))
test('norm char always corresponds to an original char', () => {
  const text = 'إحَم X'
  const { norm, map } = normalizeWithMap(text)
  assert.equal(norm, 'احم x')
  assert.equal(norm.length, map.length)
  for (let n = 0; n < norm.length; n++) {
    assert.ok(map[n] >= 0 && map[n] < text.length, `map[${n}] in bounds`)
    assert.ok(
      norm[n] === normalizeArabic(text[map[n]]) || text[map[n]] === norm[n],
      `norm[${n}]=${norm[n]} must derive from text[map[${n}]]=${text[map[n]]}`
    )
  }
})
test('consumed diacritics never appear in map', () => {
  const text = 'إحَم'
  const { map } = normalizeWithMap(text)
  assert.ok(!map.includes(2)) // index 2 is the diacritic fatha, consumed
  assert.deepEqual(map, [0, 1, 3])
})
test('findMatches returns indexes and highlight ranges on original text', () => {
  const msgs = [
    { sender: 'Y', text: 'إحَم слово' },
    { sender: 'S', text: 'nothing' },
    { sender: 'S', text: 'احم جدا' },
  ]
  const hits = findMatches(msgs, 'احم')
  assert.deepEqual(hits.map(h => h.index).sort(), [0, 2])
  // ranges point into the ORIGINAL text; the slice normalizes back to the query
  for (const h of hits) {
    const [start, end] = h.ranges[0]
    const slice = msgs[h.index].text.slice(start, end)
    assert.ok(
      normalizeArabic(slice).includes(normalizeArabic('احم')),
      `range [${start},${end}) of "${msgs[h.index].text}" should cover the match`
    )
  }
  // إ(0)→ا, ح(1)→ح, fatha(2) consumed, م(3)→م ⇒ span [0, 4)
  assert.deepEqual(hits[0].ranges[0], [0, 4])
  assert.equal(msgs[0].text.slice(0, 4), 'إحَم')
  assert.deepEqual(hits[1].ranges[0], [0, 3])
  assert.equal(msgs[2].text.slice(0, 3), 'احم')
})
test('no matches returns empty', () =>
  assert.deepEqual(findMatches([{ sender: 'S', text: 's' }], 'zzz'), []))
test('empty query returns empty', () =>
  assert.deepEqual(findMatches([{ sender: 'S', text: 'احم' }], ''), []))
test('hard caps results at 500', () => {
  const msgs = Array.from({ length: 501 }, () => ({ sender: 'S', text: 'احم' }))
  assert.equal(findMatches(msgs, 'احم').length, 500)
})
