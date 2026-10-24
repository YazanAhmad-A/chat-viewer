// Search overlay lifecycle test (browser-UI module exercised through the
// minimal DOM shim). Pins the contract that broke live on deploy:
//   initSearch(getter) → open() → type → results MUST render.
// Regression root cause: open() snapshotted the conversation context, then
// reset() nullified it before any keystroke could be processed, so the
// results list stayed empty forever (Arabic and English alike).
//
// js/ui/search.js captures its elements at module import, so each test
// installs a fresh shim and imports the module with a cache-busting query
// (unique specifier → unique module instance under node: ESM).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installDom } from './dom-shim.mjs'

const settle = () => new Promise((r) => setTimeout(r, 220)) // debounce ~150ms

test('open() then typing renders result rows (context survives open)', async () => {
  const els = installDom()
  const messages = [
    { sender: 'Sam', text: 'hello there' },
    { sender: 'Yazan', text: 'مرحبا middle' },
    { sender: 'Sam', text: 'another hello message' },
  ]
  const handle = { fileName: 'demo', messages, highlightMessage: () => {} }
  let open = true // chat session live
  const { initSearch } = await import('../js/ui/search.js?t=case1')
  const overlay = initSearch(() => (open ? handle : null))

  overlay.open()
  assert.equal(els.get('search-overlay').hidden, false, 'overlay opens')

  els.get('search-input').value = 'hello'
  els.get('search-input').fire('input')
  await settle()

  const results = els.get('search-results')
  assert.ok(results.children.length > 0, 'expected result rows after typing')
  const text = results.children.map((r) => r.textContent).join('\n')
  assert.ok(text.includes('hello'), 'row content includes the hit text')
})

test('tap a result closes overlay and calls highlightMessage', async () => {
  const els = installDom()
  const messages = [{ sender: 'Sam', text: 'find me here' }]
  let highlighted = null
  const handle = {
    fileName: 'demo2',
    messages,
    highlightMessage: (i) => { highlighted = i },
  }
  const { initSearch } = await import('../js/ui/search.js?t=case2')
  const overlay = initSearch(() => handle)

  overlay.open()
  const input = els.get('search-input')
  input.value = 'find'
  input.fire('input')
  await settle()

  const results = els.get('search-results')
  assert.ok(results.children.length > 0, 'rows exist to tap')
  const row = results.children[0]
  row.fire('click', { target: row }) // event.target must be the row for closest()
  assert.equal(els.get('search-overlay').hidden, true, 'overlay closed on tap')
  assert.equal(highlighted, 0, 'highlightMessage called with the result index')
})

test('after the overlay is closed (chat released) typing does nothing and stays hidden', async () => {
  const els = installDom()
  const handle = {
    fileName: 'demo3',
    messages: [{ sender: 'Sam', text: 'x' }],
    highlightMessage: () => { throw new Error('must not run after release') },
  }
  const { initSearch } = await import('../js/ui/search.js?t=case3')
  const overlay = initSearch(() => handle)

  overlay.open()
  // chat.js releaseSession() closes the overlay when the chat ends — that
  // is the real lifecycle; there is no mid-keystroke snapshot revoke.
  overlay.close()
  els.get('search-input').value = 'never'
  els.get('search-input').fire('input')
  await settle()
  assert.equal(els.get('search-overlay').hidden, true, 'stays closed')
  assert.equal(els.get('search-results').children.length, 0, 'no rows render while closed')
})

test('no-results query renders the No results hint, count stays hidden', async () => {
  const els = installDom()
  const handle = { fileName: 'demo4', messages: [{ sender: 'Sam', text: 'only this' }], highlightMessage: () => {} }
  const { initSearch } = await import('../js/ui/search.js?t=case4')
  const overlay = initSearch(() => handle)

  overlay.open()
  els.get('search-input').value = 'zzz-nothing'
  els.get('search-input').fire('input')
  await settle()

  const results = els.get('search-results')
  assert.equal(results.children.length, 1, 'single hint row')
  assert.equal(results.textContent, 'No results')
  assert.equal(els.get('search-count').hidden, true)
})
