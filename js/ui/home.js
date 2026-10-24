// Home screen: renders the saved-conversation list into #home, wires the
// file picker, delete interactions, and the persistent-storage note.
//
// Consumes Store (js/store.js: list/delete) and importFile (js/import.js).
// Every error path is made visible here — store rejections carry a readable
// message ("<op> failed: ..."), which is shown in the toast as-is.

import { importFile, UNMATCHED_WARN_RATIO } from '../import.js'
import { requestPersistence } from '../store.js'
import { openChat } from './chat.js'

const PREVIEW_MAX = 80

// Soft, WhatsApp-like avatar palette; picked deterministically from the
// participant name so the same chat always gets the same color.
const AVATAR_COLORS = [
  '#7f669d', '#00897b', '#3f51b5', '#e57373',
  '#f57c00', '#2e7d32', '#5c6bc0', '#8d6e63',
]

function avatarColor(seed) {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.codePointAt(0)) | 0
  return AVATAR_COLORS[((hash % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length]
}

// `last` is stored verbatim and may contain newlines/leading spaces; the
// preview is a display concern: collapse whitespace, trim, cap at 80 chars.
function previewText(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + '…' : text
}

const NO_MESSAGES_MESSAGE = "File doesn't look like a conversation export"

export async function initHome(store) {
  const els = {
    list: document.getElementById('chat-list'),
    emptyHint: document.getElementById('empty-hint'),
    toast: document.getElementById('toast'),
    note: document.getElementById('home-note'),
    addBtn: document.getElementById('add-file-btn'),
    fileInput: document.getElementById('file-input'),
  }

  let toastTimer = null
  // null = not requested yet; otherwise 'granted' | 'denied' | 'unavailable'.
  let persistenceStatus = null

  function toast(message) {
    els.toast.textContent = message
    els.toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { els.toast.hidden = true }, 4000)
  }

  function showPersistenceNote() {
    if (persistenceStatus === 'granted') { els.note.hidden = true; return }
    els.note.hidden = false
    els.note.textContent = persistenceStatus === 'unavailable'
      ? "This browser doesn't support persistent storage — saved chats may be evicted."
      : "Persistent storage wasn't granted — saved chats may be evicted by the browser."
  }

  function rowEl(meta) {
    const row = document.createElement('div')
    row.className = 'chat-row'
    row.dataset.file = meta.fileName
    row.append(avatarEl(meta), textEl(meta), countEl(meta))
    return row
  }

  function avatarEl(meta) {
    const el = document.createElement('span')
    el.className = 'avatar'
    const name = meta.participants[0] ?? ''
    // [...name] takes the first code POINT, so Arabic letters and astral
    // characters (emoji) both yield a usable initial.
    el.textContent = [...name][0] ?? '?'
    el.style.backgroundColor = avatarColor(name)
    return el
  }

  function textEl(meta) {
    const el = document.createElement('div')
    el.className = 'chat-row-text'
    const title = document.createElement('div')
    title.className = 'chat-row-title'
    title.textContent = meta.fileName
    const preview = document.createElement('div')
    preview.className = 'chat-row-preview'
    preview.textContent = previewText(meta.last)
    el.append(title, preview)
    return el
  }

  function countEl(meta) {
    const el = document.createElement('span')
    el.className = 'chat-row-count'
    el.textContent = String(meta.count)
    return el
  }

  async function render() {
    let metas
    try {
      metas = await store.list()
    } catch (err) {
      toast(err.message ?? String(err))
      return
    }
    els.list.replaceChildren(...metas.map(rowEl))
    els.emptyHint.hidden = metas.length > 0
  }

  // Returns true when at least one file imported successfully.
  async function importFiles(fileList) {
    let importedAny = false
    for (const file of fileList) {
      try {
        const buffer = await file.arrayBuffer()
        const { report } = await importFile(store, { name: file.name, buffer })
        importedAny = true
        // Warn-and-store (strict > at UNMATCHED_WARN_RATIO — see import.js):
        // stored count is the trusted one; the warning is only a heads-up.
        const { matched, unmatched } = report
        if (unmatched / (matched + unmatched) > UNMATCHED_WARN_RATIO) {
          toast(`Imported with warnings — some lines couldn't be read (${unmatched})`)
        }
      } catch (err) {
        toast(err.message === 'no-messages' ? NO_MESSAGES_MESSAGE : err.message ?? String(err))
      }
    }
    await render()
    return importedAny
  }

  // Persistent storage is requested once, after the first import succeeds
  // (earlier requests would be pointless — there is nothing to protect yet).
  async function notePersistence() {
    if (persistenceStatus !== null) return
    try {
      persistenceStatus = await requestPersistence()
    } catch {
      persistenceStatus = 'denied'
    }
    showPersistenceNote()
  }

  async function onDeleteConfirmed(fileName) {
    try {
      await store.delete(fileName)
      await render()
    } catch (err) {
      toast(err.message ?? String(err))
    }
  }

  function confirmDelete(row) {
    const fileName = row.dataset.file
    if (confirm(`Delete "${fileName}"? This cannot be undone.`)) onDeleteConfirmed(fileName)
  }

  // Delete affordances: right-click, or touch long-press (>=600ms).
  // contextmenu also fires on some platforms right after a long-press that
  // already opened the confirm — suppressContextUntil avoids a second dialog.
  let longPressTimer = null
  let suppressContextUntil = 0

  function rowFor(target) {
    return target instanceof Element ? target.closest('.chat-row') : null
  }

  els.list.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (Date.now() < suppressContextUntil) return
    const row = rowFor(event.target)
    if (row) confirmDelete(row)
  })

  els.list.addEventListener('touchstart', (event) => {
    const row = rowFor(event.target)
    if (!row) return
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      suppressContextUntil = Date.now() + 1000
      confirmDelete(row)
    }, 600)
  }, { passive: true })

  for (const type of ['touchend', 'touchmove', 'touchcancel']) {
    els.list.addEventListener(type, () => {
      clearTimeout(longPressTimer)
      longPressTimer = null
    })
  }

  // Row tap → open that conversation (windowed renderer, js/ui/chat.js).
  // Navigation stays minimal: chat.js flips #home/#chat visibility itself,
  // onBack is just a home re-render so the list refreshes on return.
  // The suppressContextUntil window (set when a long-press delete confirms)
  // also swallows the synthetic click that follows a raised long-press, so a
  // delete confirm can't accidentally open the chat.
  els.list.addEventListener('click', (event) => {
    if (Date.now() < suppressContextUntil) return
    const row = rowFor(event.target)
    if (!row) return
    openChat(row.dataset.file, store, { onBack: () => render() })
      .catch((err) => toast(err.message ?? String(err)))
  })

  els.addBtn.addEventListener('click', () => els.fileInput.click())
  els.fileInput.addEventListener('change', async () => {
    // Snapshot the FileList BEFORE resetting: input.files is live, and the
    // empty-string value setter clears that same FileList, so a capture taken
    // after the reset would always be empty (length 0 → no import).
    const files = [...els.fileInput.files]
    els.fileInput.value = '' // allows re-selecting the same file later
    if (files.length === 0) return
    if (await importFiles(files)) notePersistence()
  })

  await render()

  return {
    // For future code (e.g. a settings view) that wants the stored state.
    getPersistenceStatus: () => persistenceStatus,
  }
}
