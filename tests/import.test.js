import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextEncoder } from 'node:util'
import { decodeText, importFile } from '../js/import.js'

// ---------------------------------------------------------------------------
// Store double: a minimal in-memory fake of the Store interface that
// js/store.js exports (get -> Promise<conv|undefined>, put -> Promise<void>).
// We fake the interface rather than reusing the IndexedDB stub from
// tests/store.test.js — importFile only touches get/put, and that stub's full
// request/transaction fidelity is already proven in the store tests. These
// tests pin importFile's behavior against the same contract; the real
// wired-up flow (browser + real openStore) runs under scripts/verify-real.js.
// ---------------------------------------------------------------------------
function fakeStore() {
  const rows = new Map()
  return {
    rows,
    async get(fileName) {
      return rows.get(fileName)
    },
    async put(conv) {
      rows.set(conv.fileName, conv)
    },
  }
}

function utf8Buffer(text) {
  return new TextEncoder().encode(text) // fresh Uint8Array over a dedicated buffer
}

function convToFile(name, text) {
  return { name, buffer: utf8Buffer(text) }
}

const SAMPLE = [
  '===== 2024-02-03 =====',
  '[10:00] Yazan: مرحبا',
  '[10:01] Sam: كيفك؟',
  '[10:02] Yazan: تمام',
].join('\n')

test('decodes utf-8 buffer of arabic text', () => {
  assert.equal(decodeText(utf8Buffer('مرحبا')), 'مرحبا')
})

test('decodes windows-1256 fallback (cp1256 bytes for م ر ح)', () => {
  const bytes = new Uint8Array([0xe3, 0xd1, 0xcd])
  assert.equal(decodeText(bytes.buffer), 'مرح')
})

test('utf-8 BOM is stripped by the fatal decoder', () => {
  assert.equal(decodeText(utf8Buffer('\uFEFFمرحبا')), 'مرحبا')
})

test('importFile stores the full conv record under the extension-stripped name', async () => {
  const store = fakeStore()
  const status = await importFile(store, convToFile('2024-02.txt', SAMPLE))
  assert.equal(status, 'imported')
  const conv = store.rows.get('2024-02')
  assert.ok(conv, 'record must exist keyed by fileName without extension')
  assert.equal(conv.fileName, '2024-02')
  assert.deepEqual(conv.participants, ['Yazan', 'Sam'])
  assert.deepEqual(conv.messages, [
    { sender: 'Yazan', text: 'مرحبا' },
    { sender: 'Sam', text: 'كيفك؟' },
    { sender: 'Yazan', text: 'تمام' },
  ])
  assert.equal(conv.last, 'تمام')
  assert.equal(conv.count, 3)
})

test('second import of the same fileName returns "replaced" and updates count', async () => {
  const store = fakeStore()
  assert.equal(await importFile(store, convToFile('chat.txt', SAMPLE)), 'imported')
  const growth = SAMPLE + '\n[10:03] Sam: بالكثير\n[10:04] Yazan: خلاص'
  assert.equal(await importFile(store, convToFile('chat.txt', growth)), 'replaced')
  const conv = store.rows.get('chat')
  assert.equal(conv.count, 5)
  assert.equal(conv.last, 'خلاص')
  assert.equal(store.rows.size, 1, 'replacement must not duplicate the record')
})

test('file with zero matched lines throws Error("no-messages")', async () => {
  const store = fakeStore()
  const junk = convToFile('notes.txt', 'random words\nno timestamps\nplain text only')
  await assert.rejects(importFile(store, junk), (err) => err instanceof Error && err.message === 'no-messages')
  assert.equal(store.rows.size, 0, 'a rejected import must store nothing')
})
