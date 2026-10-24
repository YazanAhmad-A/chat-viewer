import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore, requestPersistence } from '../js/store.js'

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB stub — ~70 lines, no dependency. Supports only
// what store.js uses: open(name, version) firing onupgradeneeded then
// onsuccess, createObjectStore(name, { keyPath }), transactions (readonly /
// readwrite) over named stores, and objectStore get/put/delete/getAll.
// Requests resolve via microtasks; transaction oncomplete fires after the
// request microtasks (setTimeout), matching real IDB task ordering.
// Each object store records a call counter so tests can prove which stores
// were touched (e.g. list() must never read `conversations`).
// ---------------------------------------------------------------------------

function stubFactory(handoff) {
  function makeStore(name, keyPath) {
    const store = {
      name,
      keyPath,
      data: new Map(),
      counts: { get: 0, put: 0, delete: 0, getAll: 0 },
      _request(result) {
        const request = { result, onsuccess: null, onerror: null }
        queueMicrotask(() => {
          if (request.onsuccess) request.onsuccess({ target: request })
        })
        return request
      },
      get(key) {
        this.counts.get++
        return this._request(this.data.get(key)) // missing key -> undefined, not error
      },
      put(value) {
        this.counts.put++
        this.data.set(value[this.keyPath], value)
        return this._request(value[this.keyPath])
      },
      delete(key) {
        this.counts.delete++
        return this._request(this.data.delete(key))
      },
      getAll() {
        this.counts.getAll++
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
          const tx = {
            mode: null,
            oncomplete: null,
            onerror: null,
            objectStore(n) {
              return stores[n]
            },
          }
          // oncomplete strictly after every request's onsuccess microtask
          setTimeout(() => {
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
  return { store, ...handoff } // { store, stores }
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

test('requestPersistence: granted / denied pass through from persist()', async () => {
  const granted = await requestPersistence({ storage: { persist: () => Promise.resolve(true) } })
  assert.equal(granted, 'granted')
  const denied = await requestPersistence({ storage: { persist: () => Promise.resolve(false) } })
  assert.equal(denied, 'denied')
  const rejected = await requestPersistence({ storage: { persist: () => Promise.reject(new Error('bad')) } })
  assert.equal(rejected, 'denied')
})
