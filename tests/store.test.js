import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore, requestPersistence } from '../js/store.js'

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB stub — ~130 lines, no dependency. Supports only
// what store.js uses: open(name, version) firing onupgradeneeded then
// onsuccess, createObjectStore(name, { keyPath }), transactions (readonly /
// readwrite) over named stores, and objectStore get/put/delete/getAll.
// Requests resolve via microtasks; transaction oncomplete/onerror fires after
// the request microtasks (setTimeout), matching real IDB task ordering.
// Each object store records a call counter so tests can prove which stores
// were touched (e.g. list() must never read `conversations`).
//
// Error-injection knobs (success-path tests never touch them):
// - store.failNext = error  -> next op on that store returns a FAILING request
// - handoff.abortNextTx = error -> next tx's requests SUCCEED but the tx
//   aborts (tx.error = error), e.g. QuotaExceeded-style
// A failed request aborts its transaction with rollback, mirroring real IDB.
// ---------------------------------------------------------------------------

// Runtime error-injection knobs (used only by failure-path tests):
// - per object store: `failNext` = error -> the NEXT op on that store returns
//   a failing request (fires onerror with `request.error` set)
// - handoff knob: `abortNextTx` = error -> the NEXT transaction's requests
//   succeed, but oncomplete is replaced by onerror with `tx.error` set
// A transaction also aborts (onerror + rollback) when any of its requests
// fail, mirroring real IDB. Success-path tests never touch these knobs.
function stubFactory(handoff) {
  function makeStore(name, keyPath) {
    const store = {
      name,
      keyPath,
      data: new Map(),
      counts: { get: 0, put: 0, delete: 0, getAll: 0 },
      failNext: null,
      _request(result, error = null) {
        const request = { result, error, onsuccess: null, onerror: null }
        queueMicrotask(() => {
          const handler = request.error ? request.onerror : request.onsuccess
          if (handler) handler({ target: request })
        })
        return request
      },
      _injected() {
        const error = this.failNext
        if (error) this.failNext = null // one-shot
        return error
      },
      get(key) {
        this.counts.get++
        return this._request(this.data.get(key), this._injected()) // missing key -> undefined, not error
      },
      put(value) {
        this.counts.put++
        const error = this._injected()
        if (error) return this._request(undefined, error)
        this.data.set(value[this.keyPath], value)
        return this._request(value[this.keyPath])
      },
      delete(key) {
        this.counts.delete++
        const error = this._injected()
        if (error) return this._request(undefined, error)
        return this._request(this.data.delete(key))
      },
      getAll() {
        this.counts.getAll++
        const error = this._injected()
        if (error) return this._request(undefined, error)
        return this._request([...this.data.values()])
      },
    }
    return store
  }

  return {
    open(name, version) {
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null }
      const stores = {}
      if (handoff) handoff.stores = stores // test-only handle to verify store access
      const db = {
        name,
        version,
        createObjectStore(storeName, options = {}) {
          stores[storeName] = makeStore(storeName, options.keyPath)
          return stores[storeName]
        },
        transaction(storeNames) {
          const names = Array.isArray(storeNames) ? storeNames : [storeNames]
          names.forEach((n) => {
            if (!stores[n]) throw new Error(`no object store ${n}`)
          })
          const failures = [] // request errors observed by THIS transaction
          const undos = [] // rollback on abort (real IDB discards partial writes)
          const tx = {
            mode: null,
            oncomplete: null,
            onerror: null,
            error: null,
            objectStore(n) {
              const s = stores[n]
              const track = (req, undo) => {
                if (req.error) failures.push(req.error)
                else if (undo) undos.push(undo)
                return req
              }
              return {
                get: (key) => track(s.get(key)),
                put: (value) => {
                  // probe the key first so the undo can restore the previous value
                  const key = value[s.keyPath]
                  const prev = s.data.get(key)
                  const req = s.put(value)
                  return track(req, () => {
                    if (prev === undefined) s.data.delete(key)
                    else s.data.set(key, prev)
                  })
                },
                delete: (key) => {
                  const prev = s.data.get(key)
                  const req = s.delete(key)
                  return track(req, () => {
                    if (prev !== undefined) s.data.set(key, prev)
                  })
                },
                getAll: () => track(s.getAll()),
              }
            },
          }
          // oncomplete strictly after every request's onsuccess microtask
          setTimeout(() => {
            const abortError = handoff?.abortNextTx // tx-level abort beats request failure
            if (abortError) handoff.abortNextTx = null // one-shot
            if (abortError || failures.length) {
              // an aborted transaction discards every write it made
              while (undos.length) undos.pop()()
              tx.error = abortError ?? failures[0]
              if (tx.onerror) tx.onerror()
              return
            }
            if (tx.oncomplete) tx.oncomplete()
          }, 0)
          return tx
        },
      }
      queueMicrotask(() => {
        request.result = db
        if (request.onupgradeneeded) request.onupgradeneeded({ target: request })
        if (request.onsuccess) request.onsuccess({ target: request })
      })
      return request
    },
  }
}

async function openStubStore() {
  const handoff = {}
  const store = await openStore(stubFactory(handoff))
  return { store, ...handoff, handoff } // { store, stores, handoff } — handoff live for knobs
}

const conv1 = {
  fileName: 'a.txt',
  participants: ['Alice', 'Bob'],
  messages: [
    { time: '2024-02-03T10:00:00', text: 'first message' },
    { time: '2024-02-03T10:01:00', text: 'second message' },
  ],
  last: '2024-02-03T10:01:00',
  count: 2,
}

test('put then get returns the conversation', async () => {
  const { store } = await openStubStore()
  await store.put(conv1)
  const got = await store.get('a.txt')
  assert.deepEqual(got, conv1)
})

test('get of a missing fileName resolves undefined (no hang, no reject)', async () => {
  const { store } = await openStubStore()
  const got = await store.get('nope.txt')
  assert.equal(got, undefined)
})

test('list returns meta entries without the messages key', async () => {
  const { store, stores } = await openStubStore()
  await store.put(conv1)
  const list = await store.list()
  assert.equal(list.length, 1)
  const entry = list[0]
  assert.deepEqual(entry, {
    fileName: 'a.txt',
    participants: ['Alice', 'Bob'],
    last: '2024-02-03T10:01:00',
    count: 2,
  })
  assert.equal('messages' in entry, false, 'meta entry must not carry messages')
  // list() must have read ONLY the meta store — never load message arrays
  assert.equal(stores['meta'].counts.getAll, 1)
  assert.equal(stores['conversations'].counts.getAll, 0)
})

test('put same fileName replaces: count updates, no duplicate in list', async () => {
  const { store } = await openStubStore()
  await store.put(conv1)
  const conv2 = {
    fileName: 'a.txt',
    participants: ['Alice', 'Bob'],
    messages: [...conv1.messages, { time: '2024-02-03T10:02:00', text: 'third' }],
    last: '2024-02-03T10:02:00',
    count: 3,
  }
  await store.put(conv2)
  const got = await store.get('a.txt')
  assert.deepEqual(got, conv2)
  const list = await store.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].count, 3)
})

test('delete removes it; get then returns undefined and list is empty', async () => {
  const { store } = await openStubStore()
  await store.put(conv1)
  await store.delete('a.txt')
  assert.equal(await store.get('a.txt'), undefined)
  assert.deepEqual(await store.list(), [])
})

test('requestPersistence: unavailable when navigator/storage API is absent (Node)', async () => {
  const result = await requestPersistence(globalThis.navigator) // Node navigator has no .storage
  assert.equal(result, 'unavailable')
})

// Failure-path tests. The error-injection knobs used here (per-object-store
// `failNext`, the `abortNextTx` handoff knob) extend the stub below so both
// IDB rejection routes in store.js get exercised:
//   1. request.onerror  — an individual operation fails
//   2. tx.onerror via completion() — requests succeed but the transaction
//      aborts (e.g. QuotaExceeded)
// The spec requires a storage failure to surface visibly, so each assertion
// also checks the rejected Error's message names the failed operation.
test('put rejects on a request-level error; message names the operation; nothing stored', async () => {
  const { store, stores } = await openStubStore()
  stores.conversations.failNext = new Error('simulated request failure')
  await assert.rejects(store.put({ ...conv1, fileName: 'boom.txt' }), (err) =>
    err instanceof Error && /put/.test(err.message) && /simulated request failure/.test(err.message))
  assert.equal(stores.conversations.data.size, 0, 'failed put must leave nothing stored')
  assert.equal(stores.meta.data.size, 0, 'meta projection must not survive a failed put')
})

test('put rejects when the transaction itself aborts (requests succeeded)', async () => {
  const { store, stores, handoff } = await openStubStore()
  handoff.abortNextTx = new Error('simulated tx abort (QuotaExceededError-style quota error)')
  await assert.rejects(store.put(conv1), (err) =>
    err instanceof Error && /put/.test(err.message) && /QuotaExceededError-style/.test(err.message))
  // the distinguishing proof: individual request ops all SUCCEEDED...
  assert.equal(stores.conversations.counts.put, 1)
  assert.equal(stores.meta.counts.put, 1)
  // ...yet the abort makes the operation fail and rolls the writes back
  assert.equal(stores.conversations.data.size, 0)
  assert.equal(stores.meta.data.size, 0)
  assert.deepEqual(await store.list(), [])
})

test('get rejects on a request-level error; message names the operation', async () => {
  const { store, stores } = await openStubStore()
  stores.conversations.failNext = new Error('simulated read failure')
  await assert.rejects(store.get('a.txt'), (err) =>
    err instanceof Error && /get/.test(err.message) && /simulated read failure/.test(err.message))
})

test('requestPersistence: granted / denied pass through from persist()', async () => {
  const granted = await requestPersistence({ storage: { persist: () => Promise.resolve(true) } })
  assert.equal(granted, 'granted')
  const denied = await requestPersistence({ storage: { persist: () => Promise.resolve(false) } })
  assert.equal(denied, 'denied')
  const rejected = await requestPersistence({ storage: { persist: () => Promise.reject(new Error('bad')) } })
  assert.equal(rejected, 'denied')
})
