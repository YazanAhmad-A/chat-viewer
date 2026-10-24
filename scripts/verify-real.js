// Verification harness for the parser against a real chat export.
// Usage: node scripts/verify-real.js <path-to-chat-file>
// Prints counts only — never reads chat content into committed files.
import { readFileSync } from 'node:fs'
import { parseConversation } from '../js/parse.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/verify-real.js <chat-file>')
  process.exit(1)
}

const r = parseConversation(readFileSync(path, 'utf8'))
console.log('participants:', JSON.stringify(r.participants))
console.log('messages:', r.messages.length)
console.log('report:', JSON.stringify(r.report))
