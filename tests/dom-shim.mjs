// Minimal DOM shim for DOM-wired modules under `node --test`.
// Covers exactly what js/ui/search.js touches at module load and in its
// lifecycle: getElementById, createElement/fragment/createTextNode,
// textContent (flattening reads, like the DOM), dataset, classList,
// append (fragments splice their kids in, like the DOM),
// replaceChildren, addEventListener/fire, closest, focus, hidden.
// It exists so the search overlay's event path is covered by the committed
// suite; mechanics only, no layout/typography.

class FakeClass {
  constructor() { this.s = new Set() }
  add(c) { this.s.add(c) }
  remove(c) { this.s.delete(c) }
  contains(c) { return this.s.has(c) }
}

export class FakeEl {
  constructor(tag, id = '') {
    this.tag = tag
    this.id = id
    this.__cls = ''
    this.classList = new FakeClass()
    this.dir = null
    this.dataset = {}
    this.hidden = false
    this._kids = []
    this._listeners = {}
    this._parent = null
  }
  // textContent like the real DOM: setting replaces the kids with a single
  // text value; reading returns the value if set directly, otherwise the
  // flattened child text.
  get textContent() {
    if (this.__text !== undefined) return this.__text
    let out = ''
    for (const k of this._kids) out += k.textContent
    return out
  }
  set textContent(v) {
    this.__text = String(v)
    this._kids = []
  }
  get className() { return this.__cls }
  set className(v) {
    this.__cls = String(v)
    this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean))
  }
  get children() { return this._kids }
  append(...items) { for (const it of items) this.appendChildLike(it) }
  appendChildLike(it) {
    if (it instanceof FakeEl) {
      if (it.tag === '#fragment') {
        for (const k of it._kids) {
          k._parent = this
          this._kids.push(k)
        }
        return // fragment itself does not enter the tree
      }
      it._parent = this
      this._kids.push(it)
    }
  }
  replaceChildren(...items) {
    this._kids = []
    this.append(...items)
  }
  addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn) }
  // DOM-like bubbling: fire on the target, then walk up the parent chain.
  fire(type, event = {}) {
    let el = this
    while (el) {
      for (const fn of el._listeners[type] ?? []) fn(event)
      el = el._parent
    }
  }
  // Walks ancestors; accepts '.class' or 'class' tokens, like closest().
  closest(cls) {
    const token = String(cls).replace(/^\.+/, '')
    let el = this
    while (el) {
      if (el.classList?.contains?.(token)) return el
      el = el._parent
    }
    return null
  }
  focus() {} // search.js calls input.focus({preventScroll})
}

export function installDom() {
  const els = new Map()
  for (const id of ['home', 'chat', 'chat-scroll', 'chat-pad-top', 'chat-pool', 'chat-pad-bottom',
    'chat-back-btn', 'chat-search-btn', 'search-overlay', 'search-back-btn', 'search-input',
    'search-results', 'search-count', 'toast', 'home-note', 'add-file-btn', 'file-input',
    'chat-list', 'empty-hint', 'boot-note']) {
    const el = new FakeEl('div', id)
    if (id === 'search-overlay') el.hidden = true
    els.set(id, el)
  }
  globalThis.document = {
    getElementById: (id) => els.get(id) ?? null,
    createDocumentFragment: () => new FakeEl('#fragment'),
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (data) => { const n = new FakeEl('#text'); n.textContent = data; return n },
  }
  globalThis.Element = FakeEl // search.js gates clicks with `instanceof Element`
  return els
}
