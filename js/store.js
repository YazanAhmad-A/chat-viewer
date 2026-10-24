// IndexedDB storage layer, consumed by the import module and the home screen.
//
// Design: two object stores.
// - `conversations` (keyPath "fileName") holds full records including messages;
//   IndexedDB put() on the same key replaces the record wholesale, so the
//   replace-on-reimport rule comes from the platform for free.
// - `meta` (keyPath "fileName") holds the home-screen projection
//   { fileName, participants, last, count }, written during every put().
//   list() reads `meta` only, so the home screen never loads message arrays.

const DB_NAME = 'chat-viewer'
const DB_VERSION = 1

// Promise wrapper for an IDBRequest. A missing key resolves undefined —
// IndexedDB fires onsuccess with result undefined, never an error.
function request(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (event) => resolve(event.target.result)
    request.onerror = (event) => reject(event.target.error)
  })
}

// Promise wrapper for a transaction: a write is only durable at oncomplete,
// not at any individual request's onsuccess.
function completion(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export function openStore(idbFactory = globalThis.indexedDB) {
  if (!idbFactory) return Promise.reject(new TypeError('indexedDB is not available'))
  const openRequest = idbFactory.open(DB_NAME, DB_VERSION)
  return new Promise((resolve, reject) => {
    openRequest.onupgradeneeded = (event) => {
      const db = event.target.result
      db.createObjectStore('conversations', { keyPath: 'fileName' })
      db.createObjectStore('meta', { keyPath: 'fileName' })
    }
    openRequest.onsuccess = (event) => resolve(store(event.target.result))
    openRequest.onerror = (event) => reject(event.target.error)
  })
}

function store(db) {
  return {
    // Full-record overwrite keyed by fileName; mirrors the projection into meta.
    put(conv) {
      const meta = {
        fileName: conv.fileName,
        participants: conv.participants,
        last: conv.last,
        count: conv.count,
      }
      const tx = db.transaction(['conversations', 'meta'], 'readwrite')
      tx.objectStore('conversations').put(conv)
      tx.objectStore('meta').put(meta)
      return completion(tx)
    },

    // Missing fileName resolves undefined.
    get(fileName) {
      const tx = db.transaction(['conversations'], 'readonly')
      return request(tx.objectStore('conversations').get(fileName))
    },

    // Home-screen metadata only — `meta` store never holds messages.
    list() {
      const tx = db.transaction(['meta'], 'readonly')
      return request(tx.objectStore('meta').getAll())
    },

    // Removes the record and its projection together.
    delete(fileName) {
      const tx = db.transaction(['conversations', 'meta'], 'readwrite')
      tx.objectStore('conversations').delete(fileName)
      tx.objectStore('meta').delete(fileName)
      return completion(tx)
    },
  }
}

// navigator.storage.persist classified for the UI. The navigator is injectable
// so tests can exercise granted/denied; when the API is absent (or in Node,
// where navigator exists but has no .storage) this resolves 'unavailable'.
export async function requestPersistence(navigatorRef = globalThis.navigator) {
  const storage = navigatorRef?.storage
  if (!storage || typeof storage.persist !== 'function') return 'unavailable'
  try {
    return await storage.persist.call(storage) ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
