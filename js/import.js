// Import flow — file → stored conversation.
//
// Consumes parseConversation (js/parse.js) and the Store interface
// (js/store.js: get/put). The only UI-visible decision here is the encoding
// fallback: Telegram's desktop exports are UTF-8, but older Android exports
// are windows-1256 for Arabic locales, and bytes that are not valid UTF-8
// throw under { fatal: true }, which is the detection signal.
//
// importFile returns 'imported' for a brand-new fileName and 'replaced' when
// a prior record with that key existed; parse failures surface as
// Error('no-messages') so the UI can show a plain, honest message.

import { parseConversation } from './parse.js'

const FALLBACK_ENCODING = 'windows-1256'

export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // Not valid UTF-8 → decode with the locale's legacy single-byte encoding.
    // windows-1256 has no fatal mode and covers every byte, so this decode
    // cannot throw — but constructing it can in a platform that lacks the
    // encoding, in which case degrade to lenient UTF-8 (replacement chars).
    try {
      return new TextDecoder(FALLBACK_ENCODING).decode(buffer)
    } catch {
      return new TextDecoder('utf-8').decode(buffer)
    }
  }
}

// File name, last extension stripped: '2024-02.txt' -> '2024-02'.
// A name with no dot is returned unchanged.
function fileNameKey(name) {
  return name.replace(/\.[^.]*$/, '')
}

export async function importFile(store, fileObj) {
  const text = decodeText(fileObj.buffer)
  const parsed = parseConversation(text)
  if (parsed.report.matched === 0) throw new Error('no-messages')

  const fileName = fileNameKey(fileObj.name)
  const messages = parsed.messages
  const conv = {
    fileName,
    participants: parsed.participants, // parse caps at the first two senders
    messages,
    // Final message verbatim, empty string allowed — the 80-char meta
    // preview is the caller's concern, NOT done here.
    last: messages[messages.length - 1].text,
    count: messages.length,
  }

  const prior = await store.get(fileName)
  await store.put(conv)
  return prior ? 'replaced' : 'imported'
}
