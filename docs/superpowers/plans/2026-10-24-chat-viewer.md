# Chat Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page vanilla web app that turns pasted/conversation `.txt` exports into a saved, scrollable, searchable dark chat UI, hosted on GitHub Pages.

**Architecture:** Static site, no build step, no domain packages. Logic modules (parse, search, storage, windowed rendering math) are plain ES modules unit-tested with Node's built-in runner (`node --test`); DOM/UI modules (screens, wiring) live in `js/` and are verified in the browser (Chromium: Edge locally, Brave on phone). Conversation data lives only in the device's IndexedDB.

**Tech Stack:** HTML/CSS/vanilla ES modules; IndexedDB; `node --test` (zero dev dependencies). Deploy: GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-24-chat-viewer-design.md` (read together with this plan)

## Global Constraints

- No framework, no npm runtime dependency, no CDN/external request from the page (system fonts only). Dev tooling may not install packages either (`node --test` only).
- Dark WhatsApp palette: chat bg `#0b141a`, panel `#202c33`, own bubble `#005c4b`, other bubble `#202c33`, accent `#53bdeb` (builder may fine-tune shades).
- Chats keyed by **file name without extension**; re-upload of the same name **replaces** the stored conversation.
- Last line's sender = right-side ("own") participant; the other participant = left side.
- Times, dates, `===== … =====` dividers, blank lines: all discarded.
- `*.txt` gitignored — no real chat content may ever be committed. Only `tests/fixtures/*` (synthetic content) is committed.
- Page language of UI chrome: English (labels are a handful of words); message content is RTL Arabic.
- All screens work from `file://` on the PC and over HTTP(S); IndexedDB not available under `file://` in some browsers — app must show the persistence warning, not crash (phone via Pages is the primary flow).

## Review Focus

Inputs the spec implies that no logic unit test exercises end-to-end; each gets an owning test below:

1. **A Windows-1256-encoded file** (garbled if naively UTF-8-decoded): expect readable Arabic — Task 8 (`test decodes windows-1256 fallback`).
2. **A random non-connection file uploaded by mistake** (all lines unmatched): expect a visible warning and no conversation created with 0 messages — Task 6 (`test file with zero matches throws no-messages`).
3. **A message containing a colon and starting with `[`** (e.g. `[ الفرقان] أقول: سلام`): expect it to stay one message with the full text — Task 2 (`test internal colon and leading bracket stay in message`).
4. **Search for a hamza/diacritic variant the user typed differently** (`احم` vs `إحَم`): expect matches anyway via normalization — Task 3 (`test matches ignore hamza and diacritics`).
5. **Two files with same filename but different chats:** expect replace-with-confirm is NOT needed to be smart: replace wins per spec, meta updates, message count reflects new file — Task 5 (`test put same fileName replaces (count updates, no duplicate)`).

---

### Task 1: Project scaffold

**Files:**
- Create: `.gitignore`, `package.json`, `index.html`, `css/style.css`, `js/app.js` (placeholder)

**Interfaces:**
- Produces: repo layout + `npm test` script wired for `node --test tests/`; `index.html` loads `js/app.js` as an ES module and links `css/style.css`.

- [ ] **Step 1: Init repo in `C:\Users\Thinkpad\chat-viewer`**

`git init` (the folder is the project root; it already contains the spec, the plan, `2024-02.txt`, and `.superpowers/`).

- [ ] **Step 2: Write `.gitignore`**

Content: `.superpowers/`, `node_modules/`, `*.txt`, `!tests/fixtures/*`

- [ ] **Step 3: Write `package.json`**

`{"name":"chat-viewer","type":"module","private":true,"scripts":{"test":"node --test tests/"}}`

- [ ] **Step 4: Write minimal `index.html`, `css/style.css`, `js/app.js`**

`index.html`: viewport meta, `<html dir="rtl" lang="ar">`, dark bg on `body`, link css, `<script type="module" src="js/app.js">`. `app.js` only `console.log('chat-viewer')` for now. `style.css`: reset + `html,body{background:#0b141a;color:#e9edef}`.

- [ ] **Step 5: Verify locally**

Run: `npx --version` (npx availability only) and in a browser open `index.html` via `file://` — dark blank page, console shows the log. (If `npx` missing entirely this is fine — static hosting doesn't need it.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold static chat viewer"
```

### Task 2: Conversation parser

**Files:**
- Create: `js/parse.js`
- Create: `tests/parser.test.js`, `tests/fixtures/sample-conversation.txt`
- Test: `tests/parser.test.js`

**Interfaces:**
- Produces: `parseConversation(text: string) -> { participants: string[], messages: Array<{ sender: string, text: string }>, report: { matched: number, unmatched: number } }`. `participants` in first-appearance order, exactly 2 for real chats. Messages include every sender-word line; dividers/blank lines vanish.

- [ ] **Step 1: Write fixture `tests/fixtures/sample-conversation.txt`**

Synthetic, non-real content, exercising the format:

```
===== 2024-02-01 =====

[01:24] Yazan: مرحبا
[01:24] Sam: و عليكم🙂
[01:30] Sam: نص من سطرين:
سطر ثاني بلا توقيت
[01:31] Yazan: قوس [ Bracket ] و : نقطتان داخل الرسالة
[01:31] Sam: (edited)
===== 2024-02-02 =====
[09:00] Yazan: صباح الخير
```

- [ ] **Step 2: Write failing tests `tests/parser.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConversation } from '../js/parse.js'

const fic = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-conversation.txt')
const sample = readFileSync(fic, 'utf8')

test('parses messages discarding times and dividers', () => {
  const r = parseConversation(sample)
  assert.equal(r.messages.length, 6)
  assert.equal(r.messages[0].sender, 'Yazan')
  assert.equal(r.messages[0].text, 'مرحبا')
  assert.ok(!JSON.stringify(r).includes('01:24'))
  assert.ok(!JSON.stringify(r).includes('====='.slice(0, 5)))
})
test('participants are first-appearance and exactly two', () => {
  const r = parseConversation(sample)
  assert.deepEqual(r.participants, ['Yazan', 'Sam'])
})
test('continuation line appends to previous message', () => {
  const r = parseConversation(sample)
  assert.equal(r.messages[2].text, 'نص من سطرين:\nسطر ثاني بلا توقيت')
})
test('internal colon and leading bracket stay in message', () => {
  const r = parseConversation(sample)
  assert.equal(r.messages[3].text, 'قوس [ Bracket ] و : نقطتان داخل الرسالة')
})
test('report counts matched and unmatched', () => {
  const r = parseConversation(sample)
  assert.equal(r.report.matched, 6)
  assert.deepEqual(r.report.unmatched, 4 - 2 /* 2 blank lines: count every non-matching non-blank line */)
  // exact number: 2 dividers are structural, blank lines ignored: use >= 1
})
test('real-ish size corpus parses in one pass', () => {
  const big = sample.repeat(1000)
  const r = parseConversation(big)
  assert.equal(r.messages.length, 6000)
})
```

Note on the `report.unmatched` assertion: pin the spec behavior precisely — in the fixture, non-matching lines are exactly the 2 `=====` lines and 2 blank lines; dividers/blank lines are **structural** (ignored silently), so `unmatched` should be the count of non-matching lines that are NOT blank and do NOT match `/^=+ .* =+$/`. Write the assertion as `assert.equal(r.report.unmatched, 0)` for this fixture.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parseConversation` not defined / container created.

- [ ] **Step 4: Implement `js/parse.js`**

Split `text.split(/\r?\n/)`; anchor regex `/^\[\d{1,2}:\d{2}\]\s+([^\s:][^:]{0,40}?)\s*:\s?([\s\S]*)$/`; structural skip if line blank or matches `/^=+\s.*\s=+$/`; else unmatched++. First-appearance participant tracking capped at 2 for sides; extra names still parse as senders.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all parser tests).

- [ ] **Step 6: Verify against the real file (not committed)**

```js
// scripts/verify-real.js — run with: node scripts/verify-real.js
import { readFileSync } from 'node:fs'
import { parseConversation } from '../js/parse.js'
```

Run: `node scripts/verify-real.js` on `2024-02.txt` — expect participants `['Yazan','Sam']`, messages ≈13,815, `report.unmatched === 0`. **Commit nothing real.** Delete or keep script out of git (add to `.gitignore` `scripts/verify-real.js`? Simpler: keep script but read path from `process.argv[2]`.)

- [ ] **Step 7: Commit**

```bash
git add js/parse.js tests/ && git commit -m "feat: conversation parser"
```

### Task 3: Arabic-aware search matching

**Files:**
- Create: `js/search.js`
- Create: `tests/search.test.js`
- Test: `tests/search.test.js`

**Interfaces:**
- Consumes: message objects from `parseConversation` (`{sender, text}`).
- Produces:
  - `normalizeArabic(text: string) -> string` — lowercases, folds `أإآ→ا`, `ة→ة` (keep), strips Arabic diacritics `[\u064B-\u0652\u0670\u0640]`, NFC-forms.
  - `normalizeWithMap(text) -> { norm: string, map: number[] }` — same result, `map[n]` = index in original that produced `norm[n]`.
  - `findMatches(messages, query) -> Array<{ index: number, ranges: Array<[start, end]> }>` — ranges are indexes into the ORIGINAL message text for highlight rendering; results ordered by message index; capped at 500 results.

- [ ] **Step 1: Write failing tests**

Case assertions (exact):

```js
import { normalizeArabic, normalizeWithMap, findMatches } from '../js/search.js'

test('folds hamza and diacritics', () => {
  assert.equal(normalizeArabic('إحَم'), normalizeArabic('احم'))
  assert.equal(normalizeArabic('أنا'), 'انا')
})
test('case-folds english', () => assert.equal(normalizeArabic('Zeft'), 'zeft'))
test('map keeps original indexes', () => {
  const { norm, map } = normalizeWithMap('إحَم X')
  assert.equal(norm, 'احم x')
  assert.deepEqual(map, [0, 1, 1, 1, 2, 3, 4, 5, 6]) // diacritic consumed but not emitted... 
})
```

Pin the map semantics you build: each emitted char maps to the original index of the char that generated it; consumed (removed) diacritics extend the previous emission's authority if the emission happens later. Simplest deterministic rule the implementer writes: `map[n]` = original index of the normalized char at position n. Write the test to assert `norm[n] === text[map[n]].toUpperCase-case-folded && text[map[n]]` exists for each n — i.e. validate by *invariant*, not by a hand-typed array:

```js
test('norm char always corresponds to an original char', () => {
  const text = 'إحَم X'
  const { norm, map } = normalizeWithMap(text)
  assert.equal(norm.length, map.length)
  for (let n = 0; n < norm.length; n++) {
    assert.ok(norm[n] === normalizeArabic(text[map[n]]) || text[map[n]] === norm[n])
  }
})
test('findMatches returns indexes and highlight ranges on original text', () => {
  const msgs = [{ sender: 'Y', text: 'إحَم слово' }, { sender: 'S', text: 'nothing' }, { sender: 'S', text: 'احم جدا' }]
  const hits = findMatches(msgs, 'احم')
  assert.deepEqual(hits.map(h => h.index).sort(), [0, 2])
})
test('no matches returns empty', () => assert.deepEqual(findMatches([{text:'s'}], 'zzz'), []))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `js/search.js`**

Per-message: build once per call `{norm, map}`; slide the window of `norm` for the (normalized) query; on hit, push normalized span start/end mapped to original indexes through `map` (start = `map[hitStart]`, end = last mapped index + 1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add js/search.js tests/search.test.js && git commit -m "feat: normalized arabic search"
```

### Task 4: Windowed chat rendering math

**Files:**
- Create: `js/window.js`
- Create: `tests/window.test.js`
- Test: `tests/window.test.js`

**Interfaces:**
- Produces: a pure module the DOM renderer calls; all units are CSS px.

```ts
initWindowCalc(items: number, avgHeight: number, viewport: number):
  { lengths: number[], scrollHeight: number }
// lengths[i] = current height estimate of item i (avg everywhere initially)
windowFor({ lengths, scrollTop, viewport }, overscan = 8):
  { start: number, end: number, padTop: number, padBottom: number }
// start/end are the range to append to the DOM (end exclusive); pad* are spacer heights
remap({ lengths, itemIndex, newHeight }): { lengths } // pinned height replaces estimate, deltas ripple
```

- [ ] **Step 1: Write failing tests**

10 items × avg 100, viewport 400, scrollTop 350, overscan 1:

```js
const init = { lengths: Array(10).fill(100), scrollHeight: 1000 }
w = windowFor({ ...init, scrollTop: 350, viewport: 400 }, 1)
assert.equal(w.start, 2); assert.equal(w.end, 8) // w covers screen: items 2..8, exclusive end
assert.equal(w.padTop, 200); assert.equal(w.padBottom, 200) // lengths before 2: 200; from 8: 200
assert.equal(w.padTop + (w.end - w.start) * 100 + w.padBottom, 1000)
```

`remap` test: item 3 remeasured 0→250:

```js
after remap: lengths[3] === 250, scrollHeight(derived sum) === 1150
```

Write these against the actual returned shape; also assert `windowFor` with `scrollTop: 0` returns `start: 0`. `end` may exceed `lengths.length` (clamp inside test: `min(end, lengths.length)`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` → FAIL.

- [ ] **Step 3: Implement `js/window.js`**

```ts
windowFor: binary search cumulative offsets for first bottom-visible item...
```

One line on approach: maintain prefix sums implicitly by computing only within [start candidates]; a plain implementation (cumulative sums recomputed lazily per call is O(n) — for 800k items at 60fps this is 800k adds/call ≈ acceptable, but binary search over a lazily built Fenwick tree is the upgrade) — implementer's choice; spec only demands smooth scroll.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add js/window.js tests/window.test.js && git commit -m "feat: windowed scroll math"
```

### Task 5: IndexedDB store

**Files:**
- Create: `js/store.js`
- Create: `tests/store.test.js`
- Test: `tests/store.test.js` (in-memory minimal IDB stub — 40 lines, no dependency)

**Interfaces:**
- Produces (all `db` from `openStore(idbFactory?)`, default `globalThis.indexedDB`):

```ts
openStore(idbFactory?) -> Promise<Store>
Store.put(conv: { fileName, participants, messages, last, count }) -> Promise<void>   // keyed by fileName, REPLACES
Store.get(fileName) -> Promise<conv | undefined>
Store.list() -> Promise<Array<{ fileName, last, count, participants }>>                // meta only, no messages
Store.delete(fileName) -> Promise<void>
requestPersistence() -> Promise<'granted'|'denied'|'unavailable'>                      // navigator.storage.persist
```

- [ ] **Step 1: Write failing tests**

```js
test('put then get returns conversation', ...)
test('list returns meta without messages key', ...)
test('put same fileName replaces (count updates, no duplicate)', ...)
test('delete removes it; get then returns undefined', ...)
```

(Stub must support `open(name, version)`, `createObjectStore`, transaction-less `getAll`, `get`, `put`, `delete` — only what the tests need.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` → FAIL.

- [ ] **Step 3: Implement `js/store.js`**

One object store `conversations`, keyPath `"fileName"`. `put` = full-record overwrite (IndexedDB semantics = replace, spec's replace rule for free). Meta for `list`: keep a second store `meta` with {fileName, last, count, participants} written during `put`, so HomePage never loads message arrays.

- [ ] **Step 4: Run tests to verify they pass**, and in the browser DevTools console (`js/store.js` importable there) verify persist request works on real Chromium — accept manual verification.

- [ ] **Step 5: Commit**

```bash
git add js/store.js tests/store.test.js && git commit -m "feat: idb storage with meta list"
```

### Task 6: Import flow (file → stored conversation)

**Files:**
- Create: `js/import.js`
- Create: `tests/import.test.js`
- Test: `tests/import.test.js`

**Interfaces:**
- Consumes: `parseConversation` (Task 2), `Store.put` (Task 5).
- Produces:

```ts
decodeText(buffer: ArrayBuffer) -> string
// try TextDecoder('utf-8', { fatal: true }); on throw, TextDecoder('windows-1256')
importFile(store, fileObj /* {name, buffer} */) -> Promise<'imported'|'replaced'>
// or Promise<{status, report}>, throws Error('no-messages') when parseConversation reports matched === 0
```

- [ ] **Step 1: Write failing tests**

```js
test('decodes utf-8 buffer', buf → 'مرحبا'))
test('decodes windows-1256 fallback', Uint8Array of [0xE3, 0xD1, 0xCD] (cp1256 bytes for م ر ح) → 'مرح')
test('file with zero matches throws no-messages', a text file of random words → throws)
test('name key strips extension', ('2024-02.txt' → conversation fileName '2024-02'))
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test` → FAIL.

- [ ] **Step 3: Implement `js/import.js`** — participants, messages, last, count from parse; `last` = final message text (may be empty string — trim to 80 chars for the meta preview by the caller, not here).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add js/import.js tests/import.test.js && git commit -m "feat: import with encoding fallback"
```

### Task 7: Home screen (UI)

**Files:**
- Create: `js/ui/home.js`, `index.html` (modify), `css/style.css` (modify)
- Test: none new (UI wiring; store/parser covered) — browser verification steps.

**Interfaces:**
- Consumes: `Store.list/put/delete`, `importFile`. Produces: rendered `#home` section + `<input type=file multiple accept=".txt">`; selected files → `importFile` → re-render list; empty-parser files show a toast-style inline warning. Row: initial-avatar (first char of first participant, colored circle), name, last preview, count; long-press/right-click → delete confirm.

- [ ] **Step 1: Write the screen** — markup is small: header "Chats" + "+" button; list; footer note (Quota/persist warnings inline here if `requestPersistence()` ≠ granted).
- [ ] **Step 2: Browser verify** — serve locally (`python -m http.server 8080` or Edge on file://; storage needs http(s) → prefer `python -m http.server`); upload `2024-02.txt`; expect one row "2024-02" with preview + participants; re-upload same file → still one row; wrong file (e.g. non-chat .txt) → warning toast, no row added.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: home screen"`

### Task 8: Chat screen with windowed rendering

**Files:**
- Create: `js/ui/chat.js`, modify `index.html`/`css/style.css`
- Test: covered by Task 4 math; browser verification here.

**Interfaces:**
- Consumes: `Store.get(fileName)`, window calc (Task 4), BUBBLE layout: right-side participant = last message's sender (dark green `#005c4b`, `margin-left:auto`, `border-start-end-radius:2px`), other side left (`#202c33`, `margin-right:auto`). Name label inside bubble at accent `#53bdeb`. `dir="rtl"` on bubble; browser bidi handles inline English. Chat container scrolls (#scroll)

- [ ] **Step 1: Implement chat screen** — on scroll events: `windowFor` → keep a pool of rendered bubbles in a spacer sandwich (padTop/PAD, padBottom/END); remap measured heights as bubbles are painted; new reach = replace pool within current window only. Highlight state: `pendingHighlightIndex` from Task 9's jump — when set, after scroll lands, add `outline: 2px solid #ff8a00` to that bubble for 2s.
- [ ] **Step 2: Browser verify with the real file (http-served)** — uploads [[real 2024-02]]: (a) opens < 1 s; (b) full swipe top→bottom continuous, no hitching, no gaps; (c) restart browser, Chat → back at a similar place or last read position (min: back to top, no crash); (d) ~1,000-char message wraps, never widens the viewport.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: chat screen with virtualized scroll"`

### Task 9: Search overlay

**Files:**
- Create: `js/ui/search.js`, modify chat files
- Test: normalization covered by Task 3; browser verification here.

**Interfaces:**
- Consumes: `findMatches` (Task 3) and the chat screen's `pendingHighlightIndex` setter (Task 8). Produces: search button in chat header opens overlay INSIDE the chat screen (absolute-positioned sheet, chat behind stays mounted — no screen change, no scroll reset); input (any language), live results (debounced 150 ms) capped 500: rows = {participant name accent, ~120 chars context with `<mark>` highlights}; tap row → overlay closes, `pendingHighlightIndex = index` → chat scrolls to it, highlight ping. Free scroll continues normally afterward. Back arrow closes overlay, restores nothing (chat already mounted).

- [ ] **Step 1: Implement overlay.**
- [ ] **Step 2: Browser verify** — in the real 2024-02 chat: search "احم" → hit list; tap one → lands highlighted; immediately swipe to the end of the conversation: natural, unblocked. Search a hamza-mismatched variant (`إحَم`) → same hits. Search gibberish → "No results".
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: search overlay with jump"`

### Task 10: Deploy to GitHub Pages

**Files:**
- Modify: nothing code-side; repo remote + Pages enabling.

- [ ] **Step 1: Push**

```bash
gh repo create chat-viewer --public --source . --push   # or: git remote add + git push (requires owner GH login)
```

- [ ] **Step 2: Enable Pages: Settings → Pages → deploy from `main` `/` root** (or `--enable-pages` via API); wait for the green URL.

- [ ] **Step 3: Verify on the owner's phone browser (Brave)** — open the URL, allow "Add to Home Screen," import `2024-02.txt` from phone storage, confirm: open-time, smooth full scroll, search jump + continued free scroll, close app, reopen → chats listed.

- [ ] **Step 4: Commit any last fixes (if any), push, confirm Pages rebuilt.**
