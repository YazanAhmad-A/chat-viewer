# Chat Viewer — Design

Date: 2026-10-24
Status: Draft, awaiting builder check

## Intent and why

The owner chats with friends in Arabic. Instagram's web/app conversation view makes going back through old messages miserable: search snaps to page-like behavior — you find a match, but you can't keep reading past it without re-searching repeatedly (search to a point, read the ~5 visible messages, search again, repeat). The owner has exported the conversations as `.txt` files (both phone and PC).

This is a **personal, private reader** for those exports: upload a `.txt` anywhere, get back a real scrollable chat with working search.

## Goals

1. **Turn a `.txt` export into a chat UI** — pick a file, see the conversation as bubbles, colors per person, readable on a phone.
2. **Free scrolling, always.** From any position — after a search jump, after opening a chat — scrolling to the very end of the conversation must never be blocked or paginated. This is the #1 anti-Instagram requirement and it is non-negotiable.
3. **Search that doesn't trap you.** Search opens a results list (matched line + a little context, highlight the matches, participant name). Tap a result → the chat opens directly at that message; from there, normal free scrolling continues to the end of the conversation. Either reading forward or backward. No second screen that can't scroll.
4. **Remember conversations.** Uploaded chats persist in the browser's storage. The home screen lists saved conversations (avatar initial, chat name, last message preview). Tap to reopen — no need to re-upload the file.
5. **Update, don't duplicate.** Re-uploading a file with the same name replaces the old copy of that conversation.
6. **Delete a conversation** from the home screen when no longer wanted.
7. **Works on phone and desktop (Windows)** from the same hosted page. Personal use, primarily phone.

## Non-goals

- No sending/receiving messages of any kind. Read-only archive.
- **No backend, no account, no server of any kind.** All conversation data lives in the local browser storage of the device that uploaded it (IndexedDB). The hosted site ships zero personal data — this is the privacy model and both owner and builder must preserve it.
- No time rendering, timestamps are parsed and discarded entirely. The owner doesn't care about times at all.
- No file management beyond the upload picker (no folder watching, no drag-drop requirement — drag-drop is a freebie if easy, not a goal).
- No multi-file search / cross-chat search. Search only within the open conversation.
- No edits, annotations, favorites, or export back out (a "copy this message" long-press is a freebie, not a goal).

## Source format

**Confirmed against a real 13,869-line export (`2024-02.txt`, never to be committed to the repo).** Lines look like:

```
===== 2024-02-01 =====          ← day divider, discarded
[11:29] Sam: بشعر وبدون
[11:38] Yazan: اوه
```

- A line `[HH:MM] Name: message` is one message. Time and the day dividers (`===== YYYY-MM-DD =====`) and blank lines are all discarded — the owner doesn't care about dates or times at all. Name becomes the participant. Message text is everything after the first `": "` after the name.
- Files are UTF-8 (verified) with CRLF endings; the parser splits on `\r?\n`.
- **Line-initial `[` and internal colons** occur inside message text (verified: a message containing `[ الكتاب`). Timestamp pattern must be anchored: `^\[\d{1,2}:\d{2}\]\s+(name)\s*:\s?(.*)` and the name must match the conversation's participants — no loose matching that could swallow bracketed Arabic text as a timestamp.
- **Very long bubbles** (verified: up to ~1,000 chars on one line) must wrap comfortably, not break layout.
- Continuation lines (no match): append to the previous message with a line break.
- System-like text ("Audio call ended", "You started an audio call", `(edited)` suffixes) passes through as normal message content. No special handling.
- The conversation is exactly 2 people per file (verified: Yazan and Sam). Sides: the participant who sends the **last** line of the chat gets the right side (`right` = "own" side), the other gets left. (Owner's call was not taken here — builder may simplify to "first speaker right"; the requirement is only: one side each, consistent for the whole chat.)
- Conversation display name = the file name without extension (owner sees multiple separate chats this way).
- Arabic is the dominant language, inline English appears occasionally. Bubbles render RTL; text is treated as-is (browser bidi handles mixed text). Mixed-direction does not break the bubble; emojis and any Unicode pass through untouched.
- The owner makes these exports themselves (paste/copy into a .txt, not a third-party tool) and expects the same format in future exports — the parser can assume this format, but if a large share of lines fail to match it must warn instead of silently corrupting.

## The app

Single-page static site: plain HTML + CSS + vanilla JS. **No build step, no framework, no npm dependency.** One repo, deployable to GitHub Pages (owner has an account). Works identically opened from the local filesystem on the PC (limited persistence there is acceptable; phone is the primary device).

Screens:

1. **Home** — list of saved conversations; an "+ Add file" button at top opens the file picker (`.txt`, multiple allowed). Each row: initial avatar, name, preview of last message, tap → chat.
2. **Chat** — message bubbles only; no header chrome beyond a back button and a search button. Participant A right (own side), participant B left, per Sides rule above.
3. **Search** — a bar slides in from within the chat (does not open a different screen and lose context — same conversation, search overlay on top). Results list beneath the bar while typing, live. Tap result → overlay closes, chat scrolls to that message **highlighted**, scroll continues freely past it.
4. (Implied) **Reparsing** on re-upload replaces the stored conversation matched by filename.

### Visual style (owner chose)

- Dark "WhatsApp messenger" look: dark background `#0b141a`-ish, dark input/bubble panel `#202c33`-ish, own-side bubble green `#005c4b`-ish, other-side bubble dark `#202c33`-ish, contact name accent blue `#53bdeb`-ish. Exact hexes are the builder's.
- Own-side bubbles have a "tail" corner; other side mirrored.
- Avatar initial in each home list row uses a soft colored circle.

### Renderer requirements

- **The conversations can be very long** (Instagram exports can reach tens of thousands of messages). The chat must not hard-render every bubble. Use simple windowed/chunked rendering (e.g. render a screenful around the scroll position and extend as user scrolls) or pages appended on scroll-up/down from a virtual source. Must feel like one continuous scroll, no loading spinners, no jumps.
- Scroll position must survive returning from search results, closing the app, etc. (freebie if simple: restore last scroll position per conversation).
- Performance target: opening a 100k-line conversation loads in about a second on a mid-range phone and scrolls smoothly.

### Storage

- IndexedDB, one record per conversation: `{ fileName, participants[2], messages: [...] }`, plus a small meta (last message text) for cheap home-screen rendering.
- **Persistent storage:** on first upload, request `navigator.storage.persist()` so the browser doesn't evict saved chats. Targets are Brave on Android and Edge on Windows (both Chromium — supported). If granted, show a one-time confirmation; if refused or the API is unavailable (iOS-style environments), show a small warning that saved chats may be evicted.
- Storage failure (private mode / full quota) must be visible to the owner, not silent (a small warning that persistence failed).
- **Privacy hard rule: no real chat file ever enters the repo or the hosted site.** The repo gets a `.gitignore` covering `*.txt` (the real export used for testing lives in the tree but is ignored; only an anonymized sample fixture, if any, is committed).

## Constraints

- Zero paid services, zero backend, zero analytics, zero external requests from the page (no font CDN, no image CDN — system fonts only).
- Arabic NFC/NFD unicode differences (hamza forms, diacritics): search should do a light normalization (strip diacritics and Arabic-indic variation) so the owner doesn't fail to find a match because of `أ` vs `ا` form differences.
- The hosted site must be reachable pages on the user's phone over **HTTPS via GH Pages** — no mixed content.
- Everything works offline after first load (pure static assets; browser storage already local). A minimal manifest so "Add to Home Screen" works is a freebie, not a goal (no service worker required).

## Owner-answered questions

- Files are ready as `.txt`, available on both phone and PC. Chosen path: upload via file picker, remember in browser storage.
- The `.txt` files are owner-made (copy into a file), not third-party exports; same format going forward.
- Real export verified: UTF-8, CRLF, `[HH:MM] Name: message` lines, `===== date =====` dividers, messages with internal colons/brackets, ~1,000-char lines. A real 13,869-line file exists locally for testing.
- Devices: **Android phone with Brave browser** (primary), **Windows PC with Edge** (secondary). Both Chromium, so persistent-storage requests work on both.
- Owner has a GitHub account and will host on GitHub Pages; chats stay private because data is device-local.
- Visual style: dark messenger (A) chosen over clean light (B).
- Search UX: results-list-then-jump (B) chosen over fixed header search bar (A).
- Times and dates: discarded entirely.

## Open to the builder

- Exact app/repo name (a short neutral name is fine; e.g. `chat-viewer`).
- The precise windowed-rendering technique and chunk size.
- Choosing which side for first/last speaker per the "Sides" paragraph (the doc's starter rule was a guess).
- Whether "clear all data" settings item is worth including (small, cheap).

## Success (Definition of Done)

- Owner can upload a real ~14k-line export on their phone; it opens, scrolls from top to bottom in one continuous gesture without hitching; searching a common Arabic word pops up a result list; tapping a result lands on the highlighted message; continuing to scroll to the end blocks nothing; reopening the app shows the chats still there.
- **Size headroom:** the app targets files up to **40 MB** (~800k messages at the observed ~51 bytes/line). Import of such a file may show a brief "importing…" note (a few seconds, one-time per upload); after that, opening and scrolling must feel identical to any other chat because rendering is windowed regardless of chat size. A 40 MB chat drains well under the browser's storage quota.
