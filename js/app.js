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

// TEMPORARY DEBUG CHIP (remove after the phone-scroll diagnosis): shown only
// when the URL hash contains "debug". Renders the chat scroll's live
// invariants twice a second so a non-DevTools report of the device-side
// downward-scroll bug is possible. Flags "DOWNLOCKED" when the scroll is at
// its end while messages still exist below the rendered window.
if (location.hash.includes('debug')) {
  const chip = document.createElement('div')
  chip.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:99;background:#000;color:#0f0;font:11px/1.5 monospace;padding:4px 6px;white-space:pre-wrap;pointer-events:none;text-align:left')
  document.body.append(chip)
  setInterval(() => {
    const sc = document.getElementById('chat-scroll')
    if (!sc || document.getElementById('chat').hidden) { chip.textContent = '(home)'; return }
    const pool = document.getElementById('chat-pool')
    const padT = parseFloat(document.getElementById('chat-pad-top')?.style.height) || 0
    const padB = parseFloat(document.getElementById('chat-pad-bottom')?.style.height) || 0
    const first = pool.firstElementChild?.dataset.index ?? '?'
    const last = pool.lastElementChild?.dataset.index ?? '?'
    const room = Math.round(sc.scrollHeight) - Math.round(sc.scrollTop) - sc.clientHeight
    const n = Number(document.getElementById('chat-pool')?.children.length) || 0
    const downDead = room <= 5 && Number(last) >= 0
    chip.textContent =
      `top=${Math.round(sc.scrollTop)} sh=${Math.round(sc.scrollHeight)} ch=${sc.clientHeight} room=${room}\n` +
      `padT=${Math.round(padT)} padB=${Math.round(padB)} win=${first}..${last} rows=${n}\n` +
      (downDead ? `⚠ DOWNLOCKED (room=0 but window isn't the last messages)` : `down ok`)
  }, 500)
}
