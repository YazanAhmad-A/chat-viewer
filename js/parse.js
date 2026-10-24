// Conversation parser for Telegram-style plain-text exports.
//
// parseConversation(text) -> {
//   participants: string[],                                  // first-appearance order, capped at 2
//   messages: Array<{ sender: string, text: string }>,
//   report: { matched: number, unmatched: number },
// }
//
// Line handling:
// - blank lines and `===== date =====` dividers are structural and vanish
// - lines matching the anchored timestamp regex start a new message
// - any other line appends to the previous message (continuation)
// - a non-matching line with no open message counts as unmatched

const MESSAGE = /^\[\d{1,2}:\d{2}\]\s+([^\s:][^:]{0,40}?)\s*:\s?([\s\S]*)$/
const DIVIDER = /^=+\s.*\s=+$/

export function parseConversation(text) {
  const participants = []
  const messages = []
  let matched = 0
  let unmatched = 0

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || DIVIDER.test(line)) continue

    const m = MESSAGE.exec(line)
    if (m) {
      const sender = m[1].trim()
      if (!participants.includes(sender) && participants.length < 2) {
        participants.push(sender)
      }
      messages.push({ sender, text: m[2] })
      matched++
    } else if (messages.length > 0) {
      messages[messages.length - 1].text += '\n' + line
    } else {
      unmatched++
    }
  }

  return { participants, messages, report: { matched, unmatched } }
}
