import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConversation } from '../js/parse.js'

const fic = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-conversation.txt')
const sample = readFileSync(fic, 'utf8')

test('parses messages discarding times and dividers', () => {
  const r = parseConversation(sample)
  assert.equal(r.messages.length, 6)
  assert.equal(r.messages[0].sender, 'Yazan')
  assert.equal(r.messages[0].text, 'مرحبا')
  assert.ok(!JSON.stringify(r).includes('01:24'))
  assert.ok(!JSON.stringify(r).includes('====='.slice(0, 5)))
})
test('participants are first-appearance and exactly two', () => {
  const r = parseConversation(sample)
  assert.deepEqual(r.participants, ['Yazan', 'Sam'])
})
test('continuation line appends to previous message', () => {
  const r = parseConversation(sample)
  assert.equal(r.messages[2].text, 'نص من سطرين:\nسطر ثاني بلا توقيت')
})
test('internal colon and leading bracket stay in message', () => {
  const r = parseConversation(sample)
  assert.equal(r.messages[3].text, 'قوس [ Bracket ] و : نقطتان داخل الرسالة')
})
test('report counts matched and unmatched', () => {
  const r = parseConversation(sample)
  assert.equal(r.report.matched, 6)
  // dividers and blank lines are structural; the fixture's one continuation
  // line is absorbed into the previous message, so nothing is left unmatched
  assert.equal(r.report.unmatched, 0)
})
test('real-ish size corpus parses in one pass', () => {
  const big = sample.repeat(1000)
  const r = parseConversation(big)
  assert.equal(r.messages.length, 6000)
})
