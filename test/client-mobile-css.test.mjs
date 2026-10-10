/**
 * T5 tests — the narrow-screen sheet (`node --test`).
 *
 * Six groups, one per acceptance criterion plus the artifact guards:
 *
 *  1. **sheet shape** — every rule is inside `@media (max-width: ≤1024px)`, every
 *     declaration is `!important`, nothing uses `100vh`, and each acceptance
 *     target has a locating rule;
 *  2. **the switch** — the four tiers of `readMobileCssFlag` in order, the word
 *     forms a written config may produce, and "off means zero bytes, zero nodes,
 *     zero listeners";
 *  3. **the state proof** — a fake DOM mirroring docs/04b §1.1 plus a miniature
 *     CSS matcher/cascade, used to show that the collapsed (built-in rail) and
 *     the expanded (drawer) states are each handled, that a 1440px viewport
 *     matches **no** rule at all, and that inline styles and later-injected
 *     non-important competitors lose to the sheet;
 *  4. **idempotency and lifecycle** — one node per document, `apply(ctx)`
 *     wiring, disposal;
 *  5. **the keyboard hand-off** — `visualViewport` simulation, thresholds,
 *     disposer, and the static assertion for the sheet's rule 6.1;
 *  6. **the artifact** — the built bundle carries the sheet and passes the
 *     terminal guards that `pnpm verify` runs.
 *
 * The bundle checks need `pnpm build`; `pnpm verify` runs typecheck → build →
 * test in that order (and this file also imports `src/` directly, so the pure
 * functions are tested without a build).
 *
 * @module dsh-mobile-remote/test/client-mobile-css
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_ARTIFACT = join(repoRoot, 'lib', 'client.js')

const mobileCss = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'mobile-css.ts')).href)
const clientHalf = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'index.ts')).href)

// ---------------------------------------------------------------------------
// A miniature CSS reader: comments, media blocks, rules, declarations
// ---------------------------------------------------------------------------

/** Remove comments so brace scanning never trips over one. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Index of the `}` matching the `{` at `openIndex`. */
function matchBrace(text, openIndex) {
  let depth = 0
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error('unbalanced braces in the sheet')
}

/** `prop: value` pairs of one declaration block. */
function parseDeclarations(body) {
  return body
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const colon = part.indexOf(':')
      assert.ok(colon > 0, `declaration without a colon: ${part}`)
      const raw = part.slice(colon + 1).trim()
      return {
        property: part.slice(0, colon).trim(),
        value: raw.replace(/!important$/i, '').trim(),
        important: /!important$/i.test(raw),
      }
    })
}

/** Every `selector { declarations }` pair inside one block body. */
function parseRules(body) {
  const rules = []
  let cursor = 0
  while (cursor < body.length) {
    const open = body.indexOf('{', cursor)
    if (open < 0) {
      const tail = body.slice(cursor).trim()
      assert.equal(tail, '', `unexpected text outside a rule: ${tail}`)
      break
    }
    const selector = body.slice(cursor, open).trim()
    const close = matchBrace(body, open)
    rules.push({ selector, declarations: parseDeclarations(body.slice(open + 1, close)) })
    cursor = close + 1
  }
  return rules
}

/** Split a sheet into its media blocks plus whatever sits outside them. */
function parseSheet(text) {
  const clean = stripComments(text)
  const media = []
  let outside = ''
  let cursor = 0
  for (;;) {
    const start = clean.indexOf('@media', cursor)
    if (start < 0) {
      outside += clean.slice(cursor)
      break
    }
    outside += clean.slice(cursor, start)
    const open = clean.indexOf('{', start)
    assert.ok(open > 0, '@media without a block')
    const prelude = clean.slice(start + '@media'.length, open).trim()
    const close = matchBrace(clean, open)
    media.push({ prelude, rules: parseRules(clean.slice(open + 1, close)) })
    cursor = close + 1
  }
  return { media, outside: outside.trim(), allRules: media.flatMap((block) => block.rules) }
}

/** The `max-width` bound of a media prelude. */
function preludeMaxWidth(prelude) {
  const match = /max-width:\s*(\d+)px/.exec(prelude)
  assert.ok(match !== null, `media prelude without a max-width bound: ${prelude}`)
  return Number(match[1])
}

/** The media blocks that apply at one viewport width. */
function blocksAt(sheet, viewport) {
  return sheet.media.filter((block) => viewport <= preludeMaxWidth(block.prelude))
}

/** Every declaration of the sheet that matches one node at one viewport width. */
function appliedTo(sheet, node, viewport) {
  const applied = new Map()
  for (const block of blocksAt(sheet, viewport)) {
    for (const rule of block.rules) {
      for (const selector of rule.selector.split(',')) {
        if (!matchesSelector(selector.trim(), node)) continue
        for (const declaration of rule.declarations) {
          applied.set(declaration.property, declaration.value)
        }
      }
    }
  }
  return applied
}

// ---------------------------------------------------------------------------
// A miniature selector matcher: type, #id, [attr], [attr=v], [attr*=v], :not(),
// descendant and child combinators — exactly the forms the sheet uses.
// ---------------------------------------------------------------------------

/** Split one complex selector into `{ combinator, compound }` pairs. */
function tokenizeSelector(selector) {
  const parts = []
  let compound = ''
  let depth = 0
  let quote = null
  /** Combinator of the next compound; whitespace around `>` is insignificant. */
  let pending = null

  const flush = () => {
    const trimmed = compound.trim()
    if (trimmed.length === 0) return
    parts.push({ combinator: parts.length === 0 ? null : (pending ?? ' '), compound: trimmed })
    compound = ''
  }

  for (const character of selector) {
    if (quote !== null) {
      compound += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      compound += character
      continue
    }
    if (character === '[') depth += 1
    if (character === ']') depth -= 1
    if (depth === 0 && (character === ' ' || character === '\t' || character === '\n')) {
      if (compound.trim().length > 0) {
        flush()
        pending = ' '
      }
      continue
    }
    if (depth === 0 && character === '>') {
      flush()
      pending = '>'
      continue
    }
    compound += character
  }
  flush()
  return parts
}

/** One `[attr]`, `[attr=v]` or `[attr*=v]` test. */
function matchAttribute(inner, node) {
  const comparison = /^([\w-]+)\s*(\*?=)\s*(.*)$/.exec(inner)
  if (comparison === null) return node.getAttribute(inner.trim()) !== null
  const name = comparison[1]
  const operator = comparison[2]
  const expected = comparison[3].trim().replace(/^['"]|['"]$/g, '')
  const actual = node.getAttribute(name)
  if (actual === null) return false
  return operator === '=' ? actual === expected : actual.includes(expected)
}

/** One compound selector (no combinators) against one node. */
function matchCompound(compound, node) {
  let rest = compound.trim()
  const type = /^([a-zA-Z][\w-]*|\*)/.exec(rest)
  if (type !== null) {
    if (type[1] !== '*' && node.tag !== type[1].toLowerCase()) return false
    rest = rest.slice(type[0].length)
  }
  while (rest.length > 0) {
    if (rest.startsWith('#')) {
      const id = /^#([\w-]+)/.exec(rest)
      if (id === null || node.id !== id[1]) return false
      rest = rest.slice(id[0].length)
      continue
    }
    if (rest.startsWith('.')) {
      const className = /^\.([\w-]+)/.exec(rest)
      if (className === null || !node.classes.includes(className[1])) return false
      rest = rest.slice(className[0].length)
      continue
    }
    if (rest.startsWith('[')) {
      const end = rest.indexOf(']')
      assert.ok(end > 0, `unterminated attribute selector: ${rest}`)
      if (!matchAttribute(rest.slice(1, end), node)) return false
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith(':not(')) {
      const end = rest.indexOf(')')
      assert.ok(end > 0, `unterminated :not() selector: ${rest}`)
      if (matchCompound(rest.slice(5, end), node)) return false
      rest = rest.slice(end + 1)
      continue
    }
    throw new Error(`unsupported selector token: ${rest}`)
  }
  return true
}

/** One complex selector against one node (any combinator, right to left). */
function matchesSelector(selector, node) {
  const parts = tokenizeSelector(selector)
  assert.ok(parts.length > 0, `empty selector`)
  const last = parts[parts.length - 1]
  if (!matchCompound(last.compound, node)) return false
  let current = node
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const combinator = parts[index + 1].combinator
    const compound = parts[index].compound
    if (combinator === '>') {
      current = current.parent
      if (current === null || current === undefined || !matchCompound(compound, current)) return false
      continue
    }
    let ancestor = current.parent
    let found = false
    while (ancestor !== null && ancestor !== undefined) {
      if (matchCompound(compound, ancestor)) {
        found = true
        current = ancestor
        break
      }
      ancestor = ancestor.parent
    }
    if (!found) return false
  }
  return true
}

/** Selector specificity as `[id, class|attr, type]`. */
function specificityOf(selector) {
  let ids = 0
  let classes = 0
  let types = 0
  for (const { compound } of tokenizeSelector(selector)) {
    let rest = compound
    for (const negation of rest.match(/:not\(([^)]*)\)/g) ?? []) {
      const [innerIds, innerClasses, innerTypes] = specificityOf(negation.slice(5, -1))
      ids += innerIds
      classes += innerClasses
      types += innerTypes
      rest = rest.replace(negation, ' ')
    }
    const stripped = rest
      .replace(/#[\w-]+/g, ' ')
      .replace(/\.[\w-]+/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/:[\w-]+(\([^)]*\))?/g, ' ')
    ids += (rest.match(/#[\w-]+/g) ?? []).length
    classes += (rest.match(/\.[\w-]+/g) ?? []).length
    classes += (rest.match(/\[[^\]]*\]/g) ?? []).length
    classes += (rest.match(/:(?!not\()[\w-]+(\([^)]*\))?/g) ?? []).length
    types += (stripped.match(/[a-zA-Z][\w-]*/g) ?? []).length
  }
  return [ids, classes, types]
}

// ---------------------------------------------------------------------------
// Cascade ranks (CSS Cascade 4): an important author declaration outranks both
// the element-attached (inline) declarations and every non-important sheet, no
// matter where those were injected.
// ---------------------------------------------------------------------------

const RANK = { AUTHOR_IMPORTANT: 3, INLINE: 2, AUTHOR: 1 }

/** The winning declaration value for one property, or undefined. */
function winner(candidates, property) {
  const relevant = candidates.filter((candidate) => candidate.property === property)
  if (relevant.length === 0) return undefined
  relevant.sort((left, right) => {
    if (left.rank !== right.rank) return right.rank - left.rank
    for (let index = 0; index < 3; index += 1) {
      if (left.specificity[index] !== right.specificity[index]) {
        return right.specificity[index] - left.specificity[index]
      }
    }
    return right.order - left.order
  })
  return relevant[0].value
}

/** Every declaration of the sheet matching a node, as cascade candidates. */
function candidatesFor(sheet, node, viewport) {
  const candidates = []
  let order = 0
  for (const block of blocksAt(sheet, viewport)) {
    for (const rule of block.rules) {
      for (const selector of rule.selector.split(',')) {
        const trimmed = selector.trim()
        if (!matchesSelector(trimmed, node)) continue
        for (const declaration of rule.declarations) {
          order += 1
          candidates.push({
            property: declaration.property,
            value: declaration.value,
            important: declaration.important,
            rank: declaration.important ? RANK.AUTHOR_IMPORTANT : RANK.AUTHOR,
            specificity: specificityOf(trimmed),
            order,
          })
        }
      }
    }
  }
  return candidates
}

// ---------------------------------------------------------------------------
// A fake DOM with the shapes docs/04b §1.1 documents
// ---------------------------------------------------------------------------

class FakeNode {
  constructor(tag, attributes = {}) {
    this.tag = tag
    this.attributes = new Map(Object.entries(attributes))
    this.children = []
    this.parent = undefined
    this.style = {
      properties: new Map(),
      setProperty: (name, value) => this.style.properties.set(name, value),
      removeProperty: (name) => this.style.properties.delete(name),
    }
    // `dataset` is a live view over the data-* attributes, exactly like the DOM's
    // DOMStringMap: the shipped sheets write dataset and read attributes (and the
    // other way round) in the same breath.
    const node = this
    this.dataset = new Proxy(
      {},
      {
        get: (_target, key) =>
          typeof key === 'string' ? node.getAttribute(`data-${kebabCase(key)}`) : undefined,
        set: (_target, key, value) => {
          if (typeof key === 'string') node.setAttribute(`data-${kebabCase(key)}`, String(value))
          return true
        },
        has: (_target, key) =>
          typeof key === 'string' && node.getAttribute(`data-${kebabCase(key)}`) !== null,
        deleteProperty: (_target, key) => {
          if (typeof key === 'string') node.removeAttribute(`data-${kebabCase(key)}`)
          return true
        },
      },
    )
  }

  get id() {
    return this.attributes.get('id') ?? null
  }

  get classes() {
    return (this.attributes.get('class') ?? '').split(/\s+/).filter((part) => part.length > 0)
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  appendChild(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  remove() {
    if (this.parent === undefined) return
    const index = this.parent.children.indexOf(this)
    if (index >= 0) this.parent.children.splice(index, 1)
    this.parent = undefined
  }

  /** Depth-first node list (this node included). */
  walk() {
    const nodes = [this]
    for (const child of this.children) nodes.push(...child.walk())
    return nodes
  }
}

/** camelCase -> kebab-case for the dataset view. */
function kebabCase(key) {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

class FakeStyleElement extends FakeNode {
  constructor() {
    super('style')
    this.textContent = ''
  }
}

/** A document whose element tree is the real skeleton, so selectors can be run. */
class FakeDocument {
  constructor(html) {
    this.documentElement = html
    this.head = html.walk().find((node) => node.tag === 'head') ?? new FakeNode('head')
    if (this.head.parent === undefined) html.appendChild(this.head)
    this.created = []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim())
    return this.documentElement
      .walk()
      .filter((node) => selectors.some((one) => matchesSelector(one, node)))
  }

  createElement(tag) {
    const element = tag === 'style' ? new FakeStyleElement() : new FakeNode(tag)
    this.created.push(element)
    return element
  }
}

/** The frame tree: docs/04b §1.1 with the attributes the JSX actually writes. */
function buildTree(options = {}) {
  const { collapsed = true, expandedWidth = '280px', viewportWide = false } = options
  const html = new FakeNode('html')
  const head = html.appendChild(new FakeNode('head'))
  const body = html.appendChild(new FakeNode('body'))
  body.appendChild(new FakeNode('script', { src: 'plugins/??dsh-mobile-remote/client.js&rev=abc' }))

  const frameAttributes = { class: 'BynINW_frame' }
  if (collapsed) frameAttributes['data-sidebar-collapsed'] = 'true'
  const frame = body
    .appendChild(new FakeNode('div', { id: 'root' }))
    .appendChild(new FakeNode('div', { 'data-slot': 'root', style: 'display:contents' }))
    .appendChild(new FakeNode('div', frameAttributes))

  const sidebarRootAttributes = { class: collapsed ? '_2H3hWW_root _2H3hWW_collapsed' : '_2H3hWW_root' }
  if (!collapsed) sidebarRootAttributes['style'] = `width: ${expandedWidth}`
  frame
    .appendChild(new FakeNode('div', { class: 'BynINW_sidebarCol' }))
    .appendChild(new FakeNode('div', { 'data-slot': 'sidebar', style: 'display:contents' }))
    .appendChild(new FakeNode('div', sidebarRootAttributes))

  const center = frame.appendChild(new FakeNode('div', { class: 'BynINW_centerCol' }))
  const conversation = center
    .appendChild(new FakeNode('div', { 'data-slot': 'main', style: 'display:contents' }))
    .appendChild(new FakeNode('div', { class: 'Dc7zOa_root' }))
    .appendChild(new FakeNode('div', { class: 'Dc7zOa_body', 'data-conversation-content': '' }))
  conversation.appendChild(new FakeNode('div', { class: 'Dc7zOa_scrollBody', 'data-conversation-scroll': '' }))
  conversation.appendChild(new FakeNode('div', { class: 'Dc7zOa_composerSeat', 'data-composer-seat': '' }))

  const rightbar = frame.appendChild(new FakeNode('div', { class: 'BynINW_rightbarCol', 'data-rightbar-col': '' }))
  const panel = rightbar
    .appendChild(new FakeNode('div', { 'data-slot': 'rightbar', style: 'display:contents' }))
    .appendChild(new FakeNode('div', { class: 'OUqwTW_session', 'data-sidebar-right-session': 's1' }))
    .appendChild(
      new FakeNode('div', {
        class: 'OUqwTW_panel',
        'data-sidebar-right-panel': viewportWide ? 'push' : 'fullscreen',
        style: viewportWide ? 'width: 400px' : 'width: 100vw',
      }),
    )
  const tabLayout = panel
    .appendChild(new FakeNode('div', { class: 'OUqwTW_panelBody' }))
    .appendChild(new FakeNode('div', { class: '_tabLayout_6nhg2_134', 'data-dockkit-split': '' }))
  tabLayout.appendChild(
    new FakeNode('div', {
      class: '_tabCell_6nhg2_142',
      'data-dockkit-host': 'dock',
      'data-dockkit-column': '0',
      style: 'grid-column: 1; grid-row: 1',
    }),
  )
  tabLayout.appendChild(new FakeNode('div', { class: '_tabLayoutDivider_6nhg2_186' }))
  tabLayout.appendChild(
    new FakeNode('div', {
      class: '_tabCell_6nhg2_142',
      'data-dockkit-host': 'dock',
      'data-dockkit-column': '1',
      style: 'grid-column: 3; grid-row: 1',
    }),
  )

  frame.appendChild(new FakeNode('div', { class: 'BynINW_overlayLayer', 'data-shell-overlay': '' }))

  // The right pane holds the xterm terminal (docs/04c §2/§3 tree).
  const pane = panel
    .appendChild(new FakeNode('div', { class: '_paneBody_6nhg2_318' }))
    .appendChild(new FakeNode('section', { class: '_G3H1Wq_root', 'data-sidebar-terminal': '' }))
    .appendChild(new FakeNode('div', { class: '_G3H1Wq_screen' }))
  const xterm = pane.appendChild(new FakeNode('div', { class: 'xterm' }))
  const xtermScreen = xterm.appendChild(new FakeNode('div', { class: 'xterm-screen', style: 'width:600px;height:400px' }))
  xterm.appendChild(new FakeNode('div', { class: 'xterm-viewport' }))
  const xtermRows = xtermScreen.appendChild(
    new FakeNode('div', { class: 'xterm-rows', style: 'font-size:13px;line-height:17px' }),
  )
  xtermRows.appendChild(new FakeNode('textarea', { class: 'xterm-helper-textarea', 'aria-label': 'Terminal input' }))

  return { html, head, body, frame, sidebarRoot: sidebarRootOf(frame), center, rightbar, panel, tabLayout, pane, xterm, xtermRows }
}

/** The sidebar box: `[data-slot="sidebar"] > div`. */
function sidebarRootOf(frame) {
  const slot = frame.walk().find((node) => node.getAttribute('data-slot') === 'sidebar')
  return slot.children[0]
}

/** The sidebar column of a frame. */
function sidebarColumnOf(frame) {
  return frame.children.find((child) => child.classes.includes('BynINW_sidebarCol'))
}

/** How a sheet node identifies itself: an `id` attribute, or the card's data-hook. */
function styleIdentity(tag) {
  return tag.getAttribute('id') ?? tag.dataset['dmrStyleId'] ?? tag.dataset['pluginCss'] ?? null
}

/** Stub page globals for one call, then restore exactly what was there. */
function withGlobals(values, run) {
  const saved = new Map()
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  try {
    return run()
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
  }
}

/** A `visualViewport` stub with listener bookkeeping. */
function fakeVisualViewport(height, offsetTop) {
  const listeners = new Map()
  return {
    height,
    offsetTop,
    listeners,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    count() {
      let total = 0
      for (const set of listeners.values()) total += set.size
      return total
    },
  }
}

/** A `window` stub carrying one visual viewport. */
function fakeWindow(visualViewport, innerHeight) {
  const listeners = new Set()
  return {
    visualViewport,
    innerHeight,
    addEventListener(type, listener) {
      if (type === 'resize') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      listeners.delete(listener)
    },
    resizeListenerCount() {
      return listeners.size
    },
  }
}

const sheet = parseSheet(mobileCss.MOBILE_STYLESHEET)

/** Flatten the sheet into `{ selector, property, value, important }` rows. */
function rows() {
  return sheet.allRules.flatMap((rule) =>
    rule.selector
      .split(',')
      .map((selector) => selector.trim())
      .flatMap((selector) =>
        rule.declarations.map((declaration) => ({ selector, ...declaration })),
      ),
  )
}

/** All rows whose selector mentions a fragment. */
function rowsMentioning(fragment) {
  return rows().filter((row) => row.selector.includes(fragment))
}

// ---------------------------------------------------------------------------
// 1. Sheet shape: media-only, all-important, acceptance targets located
// ---------------------------------------------------------------------------

test('sheet: the breakpoint is DSH’s own narrow threshold and every rule is inside a media block', () => {
  assert.equal(mobileCss.MOBILE_BREAKPOINT_PX, 1024)
  assert.ok(mobileCss.MOBILE_STYLESHEET.includes('@media (max-width: 1024px)'))

  assert.equal(sheet.outside, '', 'rules outside a media block')
  assert.ok(sheet.media.length >= 1, 'no media block at all')
  assert.equal(preludeMaxWidth(sheet.media[0].prelude), 1024)
  for (const block of sheet.media) {
    assert.ok(
      preludeMaxWidth(block.prelude) <= 1024,
      `media block wider than the DSH threshold: ${block.prelude}`,
    )
    assert.match(block.prelude, /max-width/)
  }
  // Nothing may leak into a desktop-width window: at 1440px no block applies.
  assert.equal(blocksAt(sheet, 1440).length, 0)
  // At the DSH threshold only the 1024 block applies; the phone block needs ≤600.
  assert.equal(blocksAt(sheet, 1024).length, 1)
  assert.equal(blocksAt(sheet, 600).length, sheet.media.length)
})

test('sheet: every declaration carries !important (injection order is not guaranteed)', () => {
  for (const row of rows()) {
    assert.equal(row.important, true, `${row.selector} { ${row.property} } is not !important`)
  }
  // …and every declaration actually parsed as a declaration (no stray text).
  assert.ok(rows().length >= 50, `suspiciously few declarations: ${rows().length}`)
})

test('sheet: no 100vh, and the only viewport units are the small/dynamic ones', () => {
  assert.ok(!/100vh/.test(mobileCss.MOBILE_STYLESHEET), 'the sheet uses 100vh')
  assert.ok(/svh/.test(mobileCss.MOBILE_STYLESHEET), 'the composer cap should use svh')
  // Safe-area handling is part of the same mobile-height story.
  assert.ok(/env\(safe-area-inset-bottom/.test(mobileCss.MOBILE_STYLESHEET))
})

test('sheet: the five acceptance targets each have a locating rule', () => {
  const centre = rowsMentioning("_centerCol")
  assert.ok(centre.some((row) => row.property === 'width' && row.value === '100%'))
  assert.ok(centre.some((row) => row.property === 'max-width' && row.value === '100%'))

  const stack = rowsMentioning('data-dockkit-split')
  assert.ok(stack.some((row) => row.property === 'grid-template-columns' && row.value === 'minmax(0, 1fr)'))
  assert.ok(stack.some((row) => row.property === 'flex-direction' && row.value === 'column'))
  assert.ok(
    rowsMentioning('_tabLayoutDivider').some((row) => row.property === 'display' && row.value === 'none'),
  )

  const iconButton = rowsMentioning('_iconButton')
  assert.ok(iconButton.some((row) => row.property === 'min-width' && row.value === '40px'))
  assert.ok(iconButton.some((row) => row.property === 'min-height' && row.value === '40px'))
  const dockTab = rowsMentioning('data-dockkit-tab')
  assert.ok(dockTab.some((row) => row.property === 'min-height' && row.value === '40px'))
  const sharedButton = rowsMentioning("_button_")
  assert.ok(sharedButton.some((row) => row.property === 'min-height' && row.value === '40px'))

  // Collapse is reused, not re-invented: the state carrier DSH writes is what
  // the sheet keys off, and there is no rule that ever shows a sidebar control.
  assert.ok(rowsMentioning('data-sidebar-collapsed').length >= 2)
  assert.ok(rowsMentioning('_2H3hWW_collapsed').length === 0, 'the sheet binds the hashed collapse class')

  // Keyboard rule present, inside a media block, and keyed on our own attribute.
  const keyboard = rowsMentioning(`html[data-dsmr-keyboard='true']`)
  assert.ok(
    keyboard.some((row) => row.property === 'height' && row.value.includes('--dsmr-keyboard-inset')),
  )
})

test('sheet: the terminal contract (docs/04c §8) is respected textually', () => {
  const text = mobileCss.MOBILE_STYLESHEET
  // (a) no rule may touch xterm's JS-owned row geometry…
  assert.ok(!text.includes('xterm-rows'), 'the sheet mentions xterm-rows')
  assert.ok(!/\.xterm-screen[^{}]*\{/.test(text), 'the sheet styles .xterm-screen')
  // (b) …and the focus-critical input surface is never taken out of the tab order.
  assert.ok(
    !/xterm-helper-textarea[^{}]*\{[^{}]*(display:\s*none|visibility:\s*hidden)/i.test(text),
  )
  // (c) the same two guards the task's verify commands run over the bundle.
  assert.ok(
    !/xterm-helper-textarea[^{}]*\{[^{}]*(display:\s*none|visibility:\s*hidden)/i.test(text),
  )
  assert.ok(!/xterm-rows[^{}]*\{[^{}]*(font-size|width|height)\s*:/i.test(text))
  // (d) the container-level levers are the ones present.
  assert.ok(rowsMentioning('data-sidebar-terminal').some((row) => row.property === 'padding'))
  assert.ok(rowsMentioning('data-sidebar-terminal').some((row) => row.property === 'min-width'))
})

test('sheet (F2): the dockkit strip chain grows with its 40px controls', () => {
  // Measured in t26 with the shipped CSS in a real engine (headless Chromium,
  // docs/05 §2.4): the strip is a fixed 28px row (app.css R#608) while the sheet
  // raises the tab and icon button to 40px — the 40px box then overflowed 6px
  // below the strip and the pane body was hit-tested there instead, so the real
  // touch target was 34px. The strip chain is therefore raised as well.
  const strip = rowsMentioning('[data-dockkit-strip]')
  assert.ok(
    strip.some((row) => row.property === 'height' && row.value === '40px'),
    'the strip itself must be 40px tall',
  )
  assert.ok(
    rowsMentioning("[class*='_tabStrip']").some(
      (row) => row.property === 'min-height' && row.value === '40px',
    ),
  )
  const tabs = rowsMentioning('data-dockkit-strip-tabs')
  assert.ok(tabs.some((row) => row.property === 'min-height' && row.value === '40px'), 'the inner row must not clip')
  assert.ok(tabs.some((row) => row.property === 'overflow-y' && row.value === 'visible'))
  assert.ok(
    rowsMentioning('_stripChrome').some((row) => row.property === 'height' && row.value === '40px'),
    'the chrome row holding the icon buttons must match',
  )
  // The controls themselves keep their 40px (the reason the strip had to grow).
  const iconButton = rowsMentioning('_iconButton')
  assert.ok(iconButton.some((row) => row.property === 'min-height' && row.value === '40px'))
  assert.ok(rowsMentioning('data-dockkit-tab').some((row) => row.property === 'min-height' && row.value === '40px'))
})

// ---------------------------------------------------------------------------
// 2. The switch: host tiers decide, the query can only subtract, zero when off
// ---------------------------------------------------------------------------

test('switch: the default tier is the contract default (true)', () => {
  const flag = mobileCss.readMobileCssFlag({ document: new FakeDocument(buildTree().html) })
  assert.deepEqual(flag, { enabled: true, source: 'default' })
  assert.equal(mobileCss.mobileCssText({ document: new FakeDocument(buildTree().html) }), mobileCss.MOBILE_STYLESHEET)
})

test('switch: the host tiers decide, and the query can only subtract (fail-safe)', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const meta = new FakeNode('meta', { name: mobileCss.MOBILE_CSS_META_NAME, content: '0' })
  tree.head.appendChild(meta)
  const script = tree.body.children.find((node) => node.tag === 'script')

  const hostEnabled = { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: true } }

  // Host tiers, without any query.
  assert.deepEqual(mobileCss.readMobileCssFlag({ document, hostGlobal: hostEnabled }), {
    enabled: true,
    source: 'global',
  })
  assert.deepEqual(mobileCss.readMobileCssFlag({ document, hostGlobal: {} }), {
    enabled: false,
    source: 'meta',
  })

  meta.setAttribute('content', '1')
  assert.deepEqual(mobileCss.readMobileCssFlag({ document, hostGlobal: {} }), {
    enabled: true,
    source: 'meta',
  })

  // `?mobileCss=0` turns the layer off even when the host allows it.
  script.setAttribute('src', 'plugins/??dsh-mobile-remote/client.js&rev=abc&mobileCss=0')
  assert.deepEqual(mobileCss.readMobileCssFlag({ document, hostGlobal: hostEnabled }), {
    enabled: false,
    source: 'query',
  })

  // `?mobileCss=1` cannot re-enable a layer the host switched off (t13 F4).
  script.setAttribute('src', 'plugins/??dsh-mobile-remote/client.js&rev=abc&mobileCss=1')
  assert.deepEqual(
    mobileCss.readMobileCssFlag({ document, hostGlobal: { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: false } } }),
    { enabled: false, source: 'global', ignoredQuery: true },
  )
  // …and says nothing when the query agrees with the host.
  assert.deepEqual(mobileCss.readMobileCssFlag({ document, hostGlobal: hostEnabled }), {
    enabled: true,
    source: 'global',
  })

  // A query on an unrelated script is ignored.
  script.setAttribute('src', 'plugins/??other-plugin/client.js&mobileCss=0')
  assert.deepEqual(mobileCss.readMobileCssFlag({ document, hostGlobal: hostEnabled }), {
    enabled: true,
    source: 'global',
  })
})

test('switch (F4): a URL cannot re-open the layer the host closed', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const script = tree.body.children.find((node) => node.tag === 'script')
  const closed = { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: false } }

  for (const query of ['mobileCss=1', 'mobileCss=true', 'mobileCss=on', 'mobileCss=yes']) {
    script.setAttribute('src', `plugins/??dsh-mobile-remote/client.js&rev=abc&${query}`)
    const flag = mobileCss.readMobileCssFlag({ document, hostGlobal: closed })
    assert.equal(flag.enabled, false, `${query} must not re-enable the layer`)
    assert.equal(flag.ignoredQuery, true)
    // And the switched-off contract still holds end to end for that page.
    assert.equal(mobileCss.mobileCssText({ document, hostGlobal: closed }), '')
  }
})

test('switch: written word forms are understood in both directions', () => {
  const document = new FakeDocument(buildTree().html)
  const off = ['false', '0', 'off', 'no', ' FALSE ']
  const on = ['true', '1', 'on', 'yes']
  for (const word of off) {
    assert.equal(
      mobileCss.readMobileCssFlag({ document, hostGlobal: { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: word } } }).enabled,
      false,
      `${word} should switch the sheet off`,
    )
  }
  for (const word of on) {
    assert.equal(
      mobileCss.readMobileCssFlag({ document, hostGlobal: { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: word } } }).enabled,
      true,
      `${word} should keep the sheet on`,
    )
  }
})

test('switch: off means an empty sheet, no node, no variable, no listener', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const visualViewport = fakeVisualViewport(800, 0)
  const window = fakeWindow(visualViewport, 800)
  const environment = { document, window, hostGlobal: { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: false } } }

  assert.equal(mobileCss.mobileCssText(environment), '')

  const before = document.created.length
  const dispose = mobileCss.installNarrowScreenLayer(environment)
  assert.equal(document.created.length, before, 'a style node was created while switched off')
  assert.equal(document.querySelectorAll('style').length, 0)
  assert.equal(window.resizeListenerCount(), 0, 'a listener was installed while switched off')
  assert.equal(visualViewport.count(), 0, 'a visualViewport listener was installed while switched off')
  assert.equal(tree.html.style.properties.has(mobileCss.KEYBOARD_INSET_VAR), false)
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), null)
  assert.doesNotThrow(() => dispose())
})

// ---------------------------------------------------------------------------
// 3. The state proof: collapsed rail, expanded drawer, desktop inertness,
//    and the cascade against inline styles / later-injected sheets
// ---------------------------------------------------------------------------

test('state: the collapsed rail is left exactly as DSH computed it', () => {
  const tree = buildTree({ collapsed: true })
  const sidebarColumn = sidebarColumnOf(tree.frame)

  // Nothing in the sheet touches the frame's box while collapsed: the inline
  // gridTemplateColumns DSH writes (ui-layout.js:320) is the only width source.
  assert.deepEqual([...appliedTo(sheet, tree.frame, 1024).keys()], [])
  // Nothing takes the sidebar column out of flow: the 56px rail stays a track.
  assert.deepEqual([...appliedTo(sheet, sidebarColumn, 1024).keys()], [])
  // The sidebar box keeps a track-relative width — never a fixed pixel width.
  assert.equal(appliedTo(sheet, tree.sidebarRoot, 1024).get('width'), '100%')
  assert.equal(tree.sidebarRoot.classes.includes('_2H3hWW_collapsed'), true)
  // The centre column rules are state-independent size guards only.
  assert.deepEqual(
    [...appliedTo(sheet, tree.center, 1024).keys()].sort(),
    ['max-width', 'min-width', 'width'],
  )
})

test('state: the expanded narrow sidebar becomes a drawer and keeps the right track', () => {
  const tree = buildTree({ collapsed: false })
  const sidebarColumn = sidebarColumnOf(tree.frame)

  const frame = appliedTo(sheet, tree.frame, 1024)
  // Two tracks since t26: the explicit zero-width third track is what keeps the
  // docked right panel in row 1 instead of an implicit zero-height row (F1).
  assert.equal(frame.get('grid-template-columns'), 'minmax(0, 1fr) 0px')

  const column = appliedTo(sheet, sidebarColumn, 390)
  assert.equal(column.get('position'), 'fixed')
  assert.equal(column.get('left'), '0')
  assert.equal(column.get('top'), '0')
  assert.equal(column.get('bottom'), '0')
  assert.equal(column.get('width'), 'min(88vw, 340px)')
  assert.equal(column.get('z-index'), '12')

  // At 900px (still narrow, but not a phone) the narrower drawer bound applies.
  assert.equal(appliedTo(sheet, sidebarColumn, 900).get('width'), 'min(84vw, 320px)')
  assert.equal(appliedTo(sheet, sidebarColumn, 1024).get('width'), 'min(84vw, 320px)')
  assert.equal(appliedTo(sheet, tree.sidebarRoot, 390).get('width'), '100%')
})

test('state (F1): the sheet never moves the rightbar column out of its grid row', () => {
  // The panel is absolutely positioned *inside* the rightbar column, so its
  // height is the column's height. Measured in t26: with a single-track frame the
  // column landed in an implicit second row (height 0) and the panel measured
  // 0x700 with nothing hittable at the right edge; with the zero-width third
  // track it is 0x700 in row 1 and the panel is 320x700 (docs/05 §3.3).
  const tree = buildTree({ collapsed: false, viewportWide: true })
  const rightbarColumn = tree.rightbar

  // Nothing in the sheet repositions the column itself (no grid-row/grid-column/
  // position/height overrides on it) — only the text carries the zero-width track.
  for (const viewport of [390, 900, 1024]) {
    const declarations = appliedTo(sheet, rightbarColumn, viewport)
    for (const property of ['grid-row', 'grid-column', 'grid-area', 'position', 'height', 'display', 'width']) {
      assert.equal(
        declarations.has(property),
        false,
        `the sheet must not set ${property} on the rightbar column (viewport ${viewport})`,
      )
    }
  }
  // The panel's width is left to the framework's inline value: overriding it with
  // 100% resolved against the zero-width track and collapsed the panel to 0px.
  assert.deepEqual([...appliedTo(sheet, tree.panel, 1024).keys()], [])
})

test('state: a desktop-width window matches no rule in the sheet', () => {
  const tree = buildTree({ collapsed: false, viewportWide: true })
  for (const node of tree.html.walk()) {
    assert.deepEqual(
      [...appliedTo(sheet, node, 1440).keys()],
      [],
      `a rule matched ${node.tag}.${node.classes.join('.')} at 1440px`,
    )
  }
})

test('state: keyboard shortening does not disturb either collapse state', () => {
  for (const collapsed of [true, false]) {
    const tree = buildTree({ collapsed })
    tree.html.setAttribute(mobileCss.KEYBOARD_STATE_ATTR, 'true')
    const frame = appliedTo(sheet, tree.frame, 1024)
    assert.equal(frame.get('height'), 'calc(100% - var(--dsmr-keyboard-inset, 0px))')
    if (collapsed) {
      assert.deepEqual([...frame.keys()], ['height'])
      assert.deepEqual([...appliedTo(sheet, sidebarColumnOf(tree.frame), 1024).keys()], [])
    } else {
      assert.deepEqual([...frame.keys()].sort(), ['grid-template-columns', 'height'])
    }
  }
})

test('cascade: inline framework geometry loses to the sheet, wherever the sheet was injected', () => {
  const tree = buildTree({ collapsed: false, viewportWide: true })
  const sidebarColumn = sidebarColumnOf(tree.frame)

  const frameCandidates = candidatesFor(sheet, tree.frame, 1024)
  assert.equal(winner(frameCandidates, 'grid-template-columns'), 'minmax(0, 1fr) 0px')

  const inlineFrame = {
    property: 'grid-template-columns',
    value: '280px minmax(0px, 1fr) minmax(0px, 0px)',
    important: false,
    rank: RANK.INLINE,
    specificity: [9, 9, 9],
    order: 1000,
  }
  const lateSheet = { ...inlineFrame, rank: RANK.AUTHOR, specificity: [2, 9, 9], order: 1001 }
  assert.equal(winner([...frameCandidates, inlineFrame], 'grid-template-columns'), 'minmax(0, 1fr) 0px')
  assert.equal(winner([...frameCandidates, lateSheet], 'grid-template-columns'), 'minmax(0, 1fr) 0px')
  assert.equal(
    winner([...frameCandidates, inlineFrame, lateSheet], 'grid-template-columns'),
    'minmax(0, 1fr) 0px',
  )

  // The sidebar box carries an inline width in the wide state (ui-sidebar.js:292).
  const sidebarCandidates = candidatesFor(sheet, tree.sidebarRoot, 1024)
  assert.equal(
    winner(
      [
        ...sidebarCandidates,
        { property: 'width', value: '280px', important: false, rank: RANK.INLINE, specificity: [9, 9, 9], order: 1002 },
      ],
      'width',
    ),
    '100%',
  )

  // The right panel's width is deliberately *not* declared any more (t26): its
  // inline width (100vw below 768px, ui-sidebar-right.js:5677) is the truth, and
  // a 100% override resolved against the zero-width track (measured 0px wide).
  const panelCandidates = candidatesFor(sheet, tree.panel, 1024)
  assert.equal(winner(panelCandidates, 'width'), undefined)
  assert.equal(
    winner(
      [
        ...panelCandidates,
        { property: 'width', value: '100vw', important: false, rank: RANK.INLINE, specificity: [9, 9, 9], order: 1003 },
      ],
      'width',
    ),
    '100vw',
    'the framework inline width must survive the sheet',
  )

  // Every competing declaration the sheet emits is important (the premise of the
  // two assertions above).
  assert.ok(sidebarColumn !== undefined)
  assert.ok(candidatesFor(sheet, sidebarColumn, 1024).every((candidate) => candidate.important))
})

test('terminal: the xterm box is resized, its geometry and its input surface are not', () => {
  const tree = buildTree({ collapsed: true })
  const screen = tree.pane.walk().find((node) => node.classes.includes('_G3H1Wq_screen'))
  const rowsNode = tree.pane.walk().find((node) => node.classes.includes('xterm-rows'))
  const input = tree.pane.walk().find((node) => node.tag === 'textarea')

  // (a) the container lever: the screen padding is the only box change.
  assert.equal(appliedTo(sheet, screen, 1024).get('padding'), '4px')
  // (b) no declaration reaches xterm's JS-owned geometry…
  assert.deepEqual([...appliedTo(sheet, rowsNode, 1024).keys()], [])
  assert.deepEqual([...appliedTo(sheet, tree.xterm, 1024).keys()], ['min-width'])
  // (c) …and the input surface only ever gets the explicit exemption.
  const inputDeclarations = appliedTo(sheet, input, 1024)
  assert.deepEqual(
    [...inputDeclarations.keys()].sort(),
    ['border', 'margin', 'min-height', 'min-width', 'padding'],
  )
  assert.equal(inputDeclarations.get('min-height'), '0')
  assert.equal(inputDeclarations.get('min-width'), '0')
  for (const forbidden of ['display', 'visibility', 'pointer-events', 'opacity', 'width', 'height']) {
    assert.equal(inputDeclarations.has(forbidden), false, `${forbidden} is declared on the xterm input`)
  }
  // The touch-target rules never reach it: exactly one rule matches, the exemption.
  const matching = sheet.allRules.filter((rule) =>
    rule.selector.split(',').some((selector) => matchesSelector(selector.trim(), input)),
  )
  assert.equal(matching.length, 1)
  assert.equal(matching[0].selector, 'textarea.xterm-helper-textarea')
})

test('terminal: the stacked panes keep a height chain that can scroll', () => {
  const tree = buildTree({ collapsed: true })
  const cells = tree.tabLayout.children.filter((child) => child.getAttribute('data-dockkit-column') !== null)
  assert.equal(cells.length, 2)
  const declarations = appliedTo(sheet, cells[1], 1024)
  assert.equal(declarations.get('grid-column'), '1')
  assert.equal(declarations.get('grid-row'), 'auto')
  assert.equal(declarations.get('min-height'), '0')
  assert.equal(appliedTo(sheet, tree.tabLayout, 1024).get('grid-auto-rows'), 'minmax(0, 1fr)')
})

// ---------------------------------------------------------------------------
// 4. Idempotency and lifecycle
// ---------------------------------------------------------------------------

/**
 * A deliberately minimal document stub: no `setAttribute`, no tree — the shape
 * `test/client-pair.test.mjs` uses. The sheet must stay injectable, deduped and
 * disposable there too, with the frozen id carried as a data hook instead of an
 * attribute (see the module note: that branch is unreachable in a browser, where
 * `Element.setAttribute` always exists — `lib.dom.d.ts:10701/11058`).
 */
function createMinimalDocumentStub() {
  const tags = []
  const doc = {
    querySelector(selector) {
      return tags.find((tag) => selector.includes(tag.dataset.pluginCss)) ?? null
    },
    createElement() {
      const tag = {
        dataset: {},
        textContent: '',
        remove() {
          const at = tags.indexOf(tag)
          if (at !== -1) tags.splice(at, 1)
        },
      }
      return tag
    },
    head: {
      appendChild(tag) {
        tags.push(tag)
      },
    },
  }
  return { doc, tags }
}

test('injection: a minimal stub document is a valid environment (id falls back to a data hook)', () => {
  const { doc, tags } = createMinimalDocumentStub()
  const environment = { document: doc }

  const firstDispose = mobileCss.injectMobileCss(environment)
  const secondDispose = mobileCss.injectMobileCss(environment)
  assert.equal(tags.length, 1, 'the stub document must dedup through data-plugin-css')
  assert.equal(tags[0].getAttribute, undefined, 'this stub has no attribute API at all')
  assert.equal(tags[0].dataset['dmrStyleId'], mobileCss.MOBILE_STYLE_ID)
  assert.equal(tags[0].dataset['pluginCss'], mobileCss.MOBILE_STYLE_KEY)
  assert.equal(tags[0].textContent, mobileCss.MOBILE_STYLESHEET)

  secondDispose()
  assert.equal(tags.length, 1)
  firstDispose()
  assert.equal(tags.length, 0)
})

test('injection: one node per document, keyed by the frozen id', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const environment = { document, hostGlobal: { [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: true } } }

  const firstDispose = mobileCss.injectMobileCss(environment)
  const secondDispose = mobileCss.injectMobileCss(environment)
  const tags = document.querySelectorAll('style')
  assert.equal(tags.length, 1, 'two injections must share one node')
  assert.equal(tags[0].getAttribute('id'), mobileCss.MOBILE_STYLE_ID)
  assert.equal(tags[0].dataset['plugin'], 'dsh-mobile-remote')
  assert.equal(tags[0].dataset['pluginCss'], 'dsh-mobile-remote/mobile.css')
  assert.equal(tags[0].textContent, mobileCss.MOBILE_STYLESHEET)

  // The second call reused the node, so its disposer must not remove a node it
  // did not create…
  secondDispose()
  secondDispose()
  assert.equal(document.querySelectorAll('style').length, 1, 'the reuse disposer removed the node')
  // …while the owner's disposer does, exactly once.
  firstDispose()
  assert.equal(document.querySelectorAll('style').length, 0)
  firstDispose()
  assert.equal(document.querySelectorAll('style').length, 0)
})

test('injection: a pre-existing node with the frozen id is reused, not duplicated', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const existing = new FakeStyleElement()
  existing.setAttribute('id', mobileCss.MOBILE_STYLE_ID)
  tree.head.appendChild(existing)

  const dispose = mobileCss.injectMobileCss({ document })
  assert.equal(document.querySelectorAll('style').length, 1)
  assert.equal(document.created.length, 0, 'a second node was created')
  assert.doesNotThrow(() => dispose())
})

test('mounting: apply(ctx) installs both sheets once and releases both on dispose', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  withGlobals({ document, [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: true } }, () => {
    const disposers = []
    const ctx = {
      effect(callback) {
        disposers.push(callback())
      },
      inject() {},
      slots: { inject() {}, register() {} },
    }
    clientHalf.apply(ctx)
    clientHalf.apply(ctx)

    const tags = document.querySelectorAll('style')
    const ids = tags.map((tag) => styleIdentity(tag)).sort()
    assert.deepEqual(ids, ['dsh-mobile-remote-card-style', 'dsh-mobile-remote-style'])
    assert.equal(disposers.length, 2)
    for (const dispose of disposers) dispose()
    assert.equal(document.querySelectorAll('style').length, 0)
  })
})

test('mounting: mobileCss=false still mounts the card, and injects no narrow-screen node', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  withGlobals({ document, [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: false } }, () => {
    const disposers = []
    const ctx = {
      effect(callback) {
        disposers.push(callback())
      },
      inject() {},
      slots: { inject() {}, register() {} },
    }
    assert.doesNotThrow(() => clientHalf.apply(ctx))
    const ids = document.querySelectorAll('style').map((tag) => styleIdentity(tag))
    assert.deepEqual(ids, ['dsh-mobile-remote-card-style'])
    assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), undefined)
    for (const dispose of disposers) dispose()
    assert.equal(document.querySelectorAll('style').length, 0)
  })
})

// ---------------------------------------------------------------------------
// 5. The keyboard hand-off
// ---------------------------------------------------------------------------

test('keyboard: visualViewport shortfall drives the variable and the html attribute', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const visualViewport = fakeVisualViewport(800, 0)
  const window = fakeWindow(visualViewport, 800)
  const dispose = mobileCss.installKeyboardAvoidance({ document, window })

  assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), '0px')
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), null)

  // The keyboard opens: Chrome's default resizes-visual leaves innerHeight alone.
  visualViewport.height = 450
  visualViewport.emit('resize')
  assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), '350px')
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), 'true')

  // A scrolled visual viewport is part of the shortfall, never a negative inset.
  visualViewport.height = 500
  visualViewport.offsetTop = 40
  visualViewport.emit('scroll')
  assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), '260px')

  // Closed again.
  visualViewport.height = 800
  visualViewport.offsetTop = 0
  visualViewport.emit('resize')
  assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), '0px')
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), null)

  dispose()
  assert.equal(visualViewport.count(), 0, 'visualViewport listeners survived the disposer')
  assert.equal(window.resizeListenerCount(), 0, 'window listeners survived the disposer')
  assert.equal(tree.html.style.properties.has(mobileCss.KEYBOARD_INSET_VAR), false)
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), null)
})

test('keyboard: browser chrome below the threshold never lifts the layout', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const visualViewport = fakeVisualViewport(800, 0)
  const window = fakeWindow(visualViewport, 800)
  const dispose = mobileCss.installKeyboardAvoidance({ document, window })

  assert.equal(mobileCss.KEYBOARD_MIN_INSET_PX, 120)
  visualViewport.height = 800 - 60
  visualViewport.emit('resize')
  assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), '0px')
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), null)

  visualViewport.height = 800 - mobileCss.KEYBOARD_MIN_INSET_PX
  visualViewport.emit('resize')
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), 'true')

  dispose()
})

test('keyboard: an environment without visualViewport installs nothing and never throws', () => {
  const tree = buildTree()
  const document = new FakeDocument(tree.html)
  const dispose = mobileCss.installKeyboardAvoidance({ document, window: {} })
  assert.equal(tree.html.style.properties.get(mobileCss.KEYBOARD_INSET_VAR), '0px')
  assert.equal(tree.html.getAttribute(mobileCss.KEYBOARD_STATE_ATTR), null)
  assert.doesNotThrow(() => dispose())
})

test('keyboard: the static assertion that ties the JS to the sheet', () => {
  // The plan is only executable if the published variable/attribute are the ones
  // the stylesheet consumes, and the container it shortens exists in the tree.
  assert.equal(mobileCss.KEYBOARD_INSET_VAR, '--dsmr-keyboard-inset')
  assert.equal(mobileCss.KEYBOARD_STATE_ATTR, 'data-dsmr-keyboard')
  const rows = rowsMentioning(`html[data-dsmr-keyboard='true']`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].property, 'height')
  assert.equal(rows[0].value, 'calc(100% - var(--dsmr-keyboard-inset, 0px))')
  assert.equal(rows[0].selector, "html[data-dsmr-keyboard='true'] #root > [data-slot='root'] > div")

  const tree = buildTree()
  tree.html.setAttribute(mobileCss.KEYBOARD_STATE_ATTR, 'true')
  assert.equal(appliedTo(sheet, tree.frame, 1024).get('height'), 'calc(100% - var(--dsmr-keyboard-inset, 0px))')
  // And the surface it must keep visible is the shipped sticky composer seat.
  assert.equal(tree.center.walk().some((node) => node.getAttribute('data-composer-seat') !== null), true)
})

// ---------------------------------------------------------------------------
// 6. The built artifact: the sheet ships, and the terminal guards hold
// ---------------------------------------------------------------------------

test('artifact: the built bundle actually installs the sheet when driven through apply()', () => {
  // Load the real artifact through its handshake and drive `apply`, so this
  // proves the shipped bytes (not just `src/`): the sheet survives bundling
  // verbatim, the switch reaches the bundle, and disposal removes the node.
  const bundle = readFileSync(CLIENT_ARTIFACT, 'utf8')
  let definition
  const execute = new Function('window', bundle)
  execute({ __ModuleLoader__: { load: (value) => (definition = value) } })
  assert.equal(definition.id, 'dsh-mobile-remote')

  const requireReact = createRequire(import.meta.url)
  const exports = definition.factory((specifier) => {
    if (specifier === 'react') return requireReact('react')
    throw new Error(`unexpected require in the client bundle: ${specifier}`)
  })
  assert.deepEqual(exports.inject, ['slots'])

  const run = (mobileCssFlag) => {
    const tree = buildTree()
    const document = new FakeDocument(tree.html)
    return withGlobals({ document, [mobileCss.GLOBAL_CONFIG_NAME]: { mobileCss: mobileCssFlag } }, () => {
      const disposers = []
      exports.apply({
        effect(callback) {
          disposers.push(callback())
        },
        inject() {},
        slots: { inject() {}, register() {} },
      })
      const tags = document.querySelectorAll('style')
      for (const dispose of disposers) dispose()
      return tags
    })
  }

  const on = run(true)
  const mobile = on.find((tag) => tag.getAttribute('id') === mobileCss.MOBILE_STYLE_ID)
  assert.ok(mobile, 'the bundle did not install the narrow-screen sheet')
  assert.equal(mobile.textContent, mobileCss.MOBILE_STYLESHEET, 'the sheet changed on the way through the bundler')
  assert.equal(on.length, 2)

  const off = run(false)
  assert.deepEqual(
    off.map((tag) => styleIdentity(tag)),
    ['dsh-mobile-remote-card-style'],
    'mobileCss=false must reach the built bundle and inject no narrow-screen node',
  )
})

test('artifact: the bundle carries the sheet and passes the verify guards', () => {
  const bundle = readFileSync(CLIENT_ARTIFACT, 'utf8')
  assert.ok(bundle.trimStart().startsWith('window.__ModuleLoader__.load('))
  assert.ok(/max-width:\s*1024px/.test(bundle), 'no 1024px breakpoint in the bundle')
  assert.ok(bundle.includes('--dsmr-keyboard-inset'))
  assert.ok(bundle.includes('visualViewport'))
  assert.ok(!bundle.includes('xterm-rows'))
  assert.ok(!/xterm-helper-textarea[^{}]*\{[^{}]*(display:\s*none|visibility:\s*hidden)/i.test(bundle))
  assert.ok(!/xterm-rows[^{}]*\{[^{}]*(font-size|width|height)\s*:/i.test(bundle))
  // The frozen tag id travels with the bundle.
  assert.ok(bundle.includes('dsh-mobile-remote-style'))
})
