// Arabic-aware search normalization and matching.

const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/
const ALEF_FOLDS = new Set(['\u0623', '\u0625', '\u0622']) // أ إ آ → ا

// Lowercase, NFC-form, fold أ إ آ → ا, strip diacritics and tatweel.
export function normalizeArabic(text) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(/[\u0623\u0625\u0622]/g, 'ا')
}

// Same normalization, tracking for each emitted char the index of the
// original char that produced it. Removed diacritics are consumed: they
// emit nothing and their original index never appears in the map.
export function normalizeWithMap(text) {
  let norm = ''
  const map = []
  for (let i = 0; i < text.length; i++) {
    const raw = text[i]
    if (DIACRITICS.test(raw)) continue
    const folded = ALEF_FOLDS.has(raw) ? 'ا' : raw.toLowerCase()
    const nfc = folded.normalize('NFC')
    for (const ch of nfc) {
      norm += ch
      map.push(i)
    }
  }
  return { norm, map }
}

// Find every occurrence of query in each message, in ORIGINAL text
// coordinates. Results ordered by message index; hard cap 500 results.
export function findMatches(messages, query) {
  const q = normalizeArabic(query)
  if (!q) return []
  const results = []
  for (let index = 0; index < messages.length && results.length < 500; index++) {
    const text = messages[index]?.text ?? ''
    const { norm, map } = normalizeWithMap(text)
    let from = 0
    let hit = norm.indexOf(q, from)
    while (hit !== -1 && results.length < 500) {
      const start = map[hit]
      const end = map[hit + q.length - 1] + 1
      if (start === undefined || end === undefined) break
      results.push({ index, ranges: [[start, end]] })
      from = hit + 1
      hit = norm.indexOf(q, from)
    }
  }
  return results
}
