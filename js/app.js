// App bootstrap: open the store, then hand the home screen its wiring.
import { openStore } from './store.js'
import { initHome } from './ui/home.js'

// Boot sentinel for index.html's inline file:// fallback: this line only
// runs when the module bootstrap itself runs (i.e. we were served).
window.__appBooted = true

try {
  const store = await openStore()
  await initHome(store)
} catch (err) {
  // Storage can be unavailable (private mode, old browser). Show it instead
  // of a blank list; the note element already exists in #home.
  const note = document.getElementById('home-note')
  if (note) {
    note.hidden = false
    note.textContent = `Couldn't open storage: ${err.message ?? err}`
  }
}
