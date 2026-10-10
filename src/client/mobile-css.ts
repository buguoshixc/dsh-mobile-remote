/**
 * The narrow-screen sheet: one `<style>` node, everything inside a media block.
 *
 * Why this file exists
 * --------------------
 * The shipped frontend has **no narrow-screen rules at all** in its CSS layer
 * (`app.css`'s ten `@media` are all `prefers-reduced-motion`; `vendor.css` has
 * none), while its JS layer already knows what "narrow" means and already owns a
 * sidebar collapse (docs/00-contract.md §11.1, docs/04b-mobile-dom-inventory.md
 * §2.3). So this module adds **only the missing CSS layer plus the keyboard
 * hand-off** — never a second collapse control, never a DOM rewrite.
 *
 * The four hard rules this sheet obeys (all enforced by
 * `test/client-mobile-css.test.mjs`):
 *
 * 1. **Every rule is inside `@media (max-width: 1024px)` or narrower.** 1024 is
 *    DSH's own narrow threshold (`SIDEBAR_AUTO_COLLAPSE`,
 *    `docs/evidence/dsh-client-ui-layout__lib__client.js:13`), so the sheet and
 *    the frame's state machine switch over at the same width. A wider window
 *    sees exactly zero bytes of this sheet.
 * 2. **Every declaration is `!important`.** Plugin CSS is injected as
 *    `style[data-plugin-css]` while the shell's stylesheet is a build artifact,
 *    so the relative order is not guaranteed (docs/00-contract.md §11.4); and the
 *    three-column skeleton's widths are **inline** React styles
 *    (`docs/evidence/dsh-client-ui-layout__lib__client.js:320`), which only an
 *    `!important` author declaration can outrank.
 * 3. **xterm geometry stays JS-owned.** The terminal renders through
 *    DomRenderer, so colours/cursor/scrollbar/box are fair game, but `.xterm-*`
 *    row and screen geometry is written inline by xterm and refitting is the
 *    renderer's job (`docs/04c-terminal-dom-inventory.md` §3/§8). This sheet
 *    changes the terminal's **container** and lets xterm's own
 *    `ResizeObserver → fitScreen` react.
 * 4. **Nothing is injected when the switch is off.** `mobileCss: false` means no
 *    `<style>` node, no `visualViewport` listener, no CSS variable — and the
 *    `?mobileCss=` URL override can only *subtract*: it may turn the layer off
 *    when the host allows it, never on when the host forbids it (fail-safe, t13
 *    finding F4).
 *
 * @module dsh-mobile-remote/client/mobile-css
 */

import { NAMESPACE } from './styles.ts'

/** The sheet's stable id (docs/00-contract.md §6.1/§11.4). */
export const MOBILE_STYLE_ID = 'dsh-mobile-remote-style'

/** The sheet's `data-plugin-css` value — the tag id DSH's HMR uses per sheet. */
export const MOBILE_STYLE_KEY = `${NAMESPACE}/mobile.css`

/** Narrow threshold; equals DSH's `SIDEBAR_AUTO_COLLAPSE` (ui-layout.js:13). */
export const MOBILE_BREAKPOINT_PX = 1024

/** The narrower, phone-only block's threshold. */
export const PHONE_BREAKPOINT_PX = 600

/** CSS variable carrying the on-screen keyboard's height in px. */
export const KEYBOARD_INSET_VAR = '--dsmr-keyboard-inset'

/** `html` attribute set while the on-screen keyboard covers the layout bottom. */
export const KEYBOARD_STATE_ATTR = 'data-dsmr-keyboard'

/**
 * Smallest visual-viewport shrink treated as "the keyboard is up".
 *
 * Browser chrome (the URL bar) also shrinks the visual viewport by tens of
 * pixels; acting on that would make the layout breathe on every scroll. A
 * software keyboard is an order of magnitude taller.
 */
export const KEYBOARD_MIN_INSET_PX = 120

/** The host-published global the composition layer uses to reach the browser half. */
export const GLOBAL_CONFIG_NAME = '__DSH_MOBILE_REMOTE__'

/** The `<meta>` hook, available to scratch pages and to `dsh-client-hmr` reloads. */
export const MOBILE_CSS_META_NAME = 'dsh-mobile-remote-mobile-css'

/** The module-URL query key (`…dsh-mobile-remote/client.js?mobileCss=0`). */
export const MOBILE_CSS_QUERY_KEY = 'mobileCss'

/** Where a resolved flag value came from — the diagnostic half of the switch. */
export type MobileCssSource = 'query' | 'global' | 'meta' | 'default'

/** The resolved switch: its value, the deciding tier, and any ignored override. */
export interface MobileCssFlag {
  /** Whether the sheet (and its keyboard listener) may be installed. */
  enabled: boolean
  /** Which tier decided the answer — logged when the sheet is switched off. */
  source: MobileCssSource
  /**
   * Set when the page URL asked to *enable* the layer while the host forbids it.
   * The query can only subtract (t13 F4), so the request is recorded instead of
   * silently dropped.
   */
  ignoredQuery?: boolean
}

/**
 * The stylesheet.
 *
 * Comment blocks name the evidence for every fragile selector; the replacement
 * ladder documented in `docs/05-mobile-css-selectors.md` is "attribute first,
 * `[class*=localName]` second, full hashed class last" (docs/04b §6.3).
 *
 * The one structural selector worth explaining: the frame is reached as
 * `#root > [data-slot="root"] > div` rather than through its hashed class
 * `.BynINW_frame`. `#root` is load-bearing for the shell itself
 * (`shell-index.js` throws `web app: missing #root`), `[data-slot="root"]` is a
 * frozen slot anchor, and the frame is its only element child — whereas the hash
 * changes with every build (`docs/04b-mobile-dom-inventory.md` §1.1, §6.2#1/#3).
 */
export const MOBILE_STYLESHEET = `
/* ==========================================================================
   dsh-mobile-remote — narrow-screen layer (T5)
   Everything below is inside a media block. See docs/05-mobile-css-selectors.md
   for the selector registry, the fragility ladder and the re-verification
   commands.
   ========================================================================== */
@media (max-width: 1024px) {
  /* 1.1  The three-column skeleton.
     The frame's widths are React inline styles
     (ui-layout.js:320 -> "<sidebar>px minmax(<0|400>px,1fr) minmax(0px,<rightMax>px)"),
     so only !important can outrank them. Collapsed is DSH's own narrow default
     and is left completely alone; the override exists for the *expanded*
     narrow state, where the built-in solve gives the sidebar 280px and squeezes
     the centre column to ~110px on a 390px phone (ui-layout.js:38-47, :237).
     Only the expanded state is matched, so the collapsed rail keeps the exact
     inline track DSH computed for it.

     The third track stays — as an explicit '0px' — for a reason measured in t26:
     the docked right panel is 'position:absolute' inside '.BynINW_rightbarCol',
     which is 'position:relative' (ui-layout.js:73). With a single track that
     column is auto-placed into an implicit *second* row whose height is 0 and
     the frame's 'grid-template-rows:100%' + 'overflow:hidden' clip it away, so
     the panel measured 0x700 and nothing was hit-testable at the right edge.
     Keeping a zero-width third track puts the column back in row 1 (full height)
     exactly as the shipped collapsed layout does (its third track is
     'minmax(0px, 0px)'). See docs/05 §3.3 for the measurement. */
  #root > [data-slot='root'] > div:not([data-sidebar-collapsed]) {
    grid-template-columns: minmax(0, 1fr) 0px !important;
  }

  /* 1.2  Expanded sidebar -> off-canvas drawer. Taking the column out of flow
     keeps it out of the grid (a fixed grid item creates no track), which is what
     lets the centre column own the whole frame. The width mirrors the sidebar's
     own wide preference clamp(264,420) (ui-layout.js:39) capped at 320px, and
     84vw keeps the tap-outside area visible on any phone.
     z-index 12 keeps it above the centre column and above the 8px drag handles
     (z-index 11) but below the shell overlay layer (z-index 20) so modals stay
     on top. */
  #root > [data-slot='root'] > div:not([data-sidebar-collapsed]) > [class*='_sidebarCol'] {
    position: fixed !important;
    top: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
    width: min(84vw, 320px) !important;
    z-index: 12 !important;
  }

  /* 1.3  The sidebar box itself is reached structurally: its root carries no
     data-* attribute at all, only hashed classes plus an inline width that DSH
     writes in the wide state (ui-sidebar.js:289-292, docs/04b §2.1). */
  [data-slot='sidebar'] > div {
    width: 100% !important;
  }

  /* 1.4  The centre column is the only 1fr track: it takes every pixel the
     collapsed rail leaves and the whole frame when the drawer is open. The
     built-in middle track has a 400px floor while the right panel is docked
     (ui-layout.js:320), which a phone cannot afford. */
  [class*='_centerCol'] {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }

  /* 2.1  The right panel's width is deliberately **not** overridden any more.
     It used to be 'width: 100% !important', which measured 0px wide in t26: the
     panel is 'position:absolute; right:0' inside '.BynINW_rightbarCol', whose
     width *is* the third grid track — and in the shipped collapsed layout that
     track is 'minmax(0px, 0px)', so '100%' resolved against zero and the panel
     disappeared on phones. The framework's inline width is the source of truth:
     '100vw' in the auto-fullscreen mode below 768px, a px value in push mode
     (ui-sidebar-right.js:5677-5679). Any sub-pixel overflow is clipped by the
     frame's own 'overflow:hidden'. Measurement: docs/05 §2.4. */

  /* 2.2  Panels stack instead of sitting side by side.
     The dockkit split is a grid with an inline
     "minmax(0,1fr) 0px minmax(0,1fr)" and cells carrying inline
     grid-column/grid-row (shell-index.js off=620482/618635, app.css R#594), so
     both need !important. One explicit column plus auto row placement turns the
     panes into rows of equal share; the internal height chain (grid stretch)
     keeps working, which a display:flex rewrite would not preserve. */
  [data-dockkit-split][class*='_tabLayout'] {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: minmax(0, 1fr) !important;
    grid-auto-rows: minmax(0, 1fr) !important;
  }
  [data-dockkit-split][class*='_tabLayout'] > [data-dockkit-column] {
    grid-column: 1 !important;
    grid-row: auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
  }

  /* 2.3  The generic split tree is already flex; only its axis has to turn. */
  [data-dockkit-split]:not([class*='_tabLayout']) {
    flex-direction: column !important;
  }
  [data-dockkit-split] > [data-dockkit-cell] {
    flex: 1 1 0 !important;
    min-height: 0 !important;
  }

  /* 2.4  The dividers are col-resize stripes (app.css R#603/R#579) and are
     meaningless between stacked panes. Only the tabLayout divider lacks a
     data-* hook, so it is addressed by its local name (docs/04b §6.2#6). */
  [data-dockkit-divider],
  [class*='_tabLayoutDivider'] {
    display: none !important;
  }

  /* 2.5  Panes must be allowed to shrink, or the stacked pair overflows the
     panel; the pane body keeps its own overflow:auto (app.css R#643). */
  [data-dockkit-pane] {
    min-height: 0 !important;
  }

  /* 3.1  Conversation column. It stays the single vertical scroller
     (conversation.js:16336-16339); overscroll containment stops a chat swipe
     from chaining into the shell (and into pull-to-refresh). */
  [data-conversation-content] {
    min-width: 0 !important;
  }
  [data-conversation-scroll] {
    overscroll-behavior-y: contain !important;
  }

  /* 3.2  Composer. The seat is sticky at the bottom of the scroll body
     (conversation.js:15797); the safe-area inset lifts it above the Android
     gesture bar, and the text area is capped so the keyboard and a tall input
     cannot both eat the screen. svh (not vh) is the small viewport height. */
  [data-composer-seat] {
    padding-bottom: env(safe-area-inset-bottom, 0px) !important;
  }
  [data-composer-seat] {
    --dsh-composer-text-max-height: min(40svh, 336px) !important;
  }

  /* 4.1  Touch targets. Shipped sizes: shared Button sm 28px / md 36px
     (app.css R#75/R#76), dockkit tab 28px (R#621), module icon buttons 24-28px
     (R#635, ui-sidebar.js:91, ui-goal.js:129, ui-user-questions.js:608).
     min-* is used rather than fixed sizes so flow controls keep their own
     layout; absolutely positioned ones grow away from their anchor. */
  button,
  [role='button'],
  [role='menuitem'],
  [role='menuitemradio'],
  [role='option'],
  [role='treeitem'] {
    min-height: 40px !important;
  }
  [class*='_button_'],
  [class*='_iconButton'],
  [class*='_iconBtn'],
  [class*='_toggle'],
  [data-dockkit-tab],
  [role='tab'] {
    min-width: 40px !important;
    min-height: 40px !important;
  }
  /* The dockkit tab close affordance is 20x20 and hidden until hover
     (app.css R#625); on touch there is no hover, so it gets a real box. */
  [data-dockkit-tab] [class*='_tabClose'] {
    width: 32px !important;
    height: 32px !important;
  }

  /* 4.3  The strip must grow with its controls, or the 40px target is a lie.
     Measured in t26 with the shipped CSS (headless Chromium, docs/05 §2.4):
     the strip is a fixed 28px row (app.css R#608: 'height:28px', plus 10px of
     top padding) while our min-height raises the tab and the icon button to
     40px. The 40px box then overflowed 6px below the strip and the pane body
     - a later sibling in DOM order - was hit-tested there instead, so the real
     touch target was 34px, not 40px. Raising the strip chain restores the full
     40px; the cost is 12px of pane height (38px -> 50px).
     '_stripChrome' holds the split/add icon buttons (app.css R#615). */
  [data-dockkit-strip],
  [class*='_tabStrip'] {
    height: 40px !important;
    min-height: 40px !important;
  }
  [data-dockkit-strip-tabs],
  [class*='_stripTabs'] {
    min-height: 40px !important;
    overflow-y: visible !important;
  }
  [class*='_stripChrome'] {
    height: 40px !important;
    min-height: 40px !important;
  }

  /* 5.1  The xterm host box. Only the container is touched: the screen's 8px
     padding shrinks to 4px, which widens the box and lets xterm's own
     ResizeObserver -> fitScreen refit the grid and report new cols/rows to the
     host (docs/04c §3, :13422-13427/:13478-13487). min-width:0 on the flex item
     is what stops a wide host snapshot from overflowing sideways. */
  [data-sidebar-terminal] {
    min-width: 0 !important;
    min-height: 0 !important;
  }
  [data-sidebar-terminal] > [class*='_screen'] {
    padding: 4px !important;
  }
  [data-sidebar-terminal] .xterm {
    min-width: 0 !important;
  }
  /* Scrollbar skin only - appearance, not geometry (docs/04c §8). */
  [data-sidebar-terminal] .xterm-viewport {
    scrollbar-width: thin !important;
    scrollbar-color: var(--dsw-alias-border-l3) transparent !important;
  }

  /* 5.2  The exemption the touch rules must carry.
     xterm's real input element is this textarea; it is kept focusable by being
     transparent and off-screen (docs/evidence/terminal/at-xterm__xterm@6.0.0__css__xterm.pretty.css:4,
     docs/04c §8). It must never be grown into a 40px target and never be taken
     out of the focus order, or the phone keyboard stops reaching the terminal. */
  textarea.xterm-helper-textarea {
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
  }

  /* 6.1  Keyboard occlusion. The shipped viewport meta has no interactive-widget
     (dist/index.html:5) and DSH itself never reads visualViewport
     (conversation.js:7822 is vendored Lexical), so the layout viewport is not
     resized when the keyboard opens: the sticky composer ends up underneath it.
     installKeyboardAvoidance() publishes the visual-viewport shortfall as
     --dsmr-keyboard-inset plus html[data-dsmr-keyboard]; shortening the frame by
     that inset keeps the whole height chain (all percentages, app.css R#676)
     above the keyboard. */
  html[data-dsmr-keyboard='true'] #root > [data-slot='root'] > div {
    height: calc(100% - var(--dsmr-keyboard-inset, 0px)) !important;
  }
}
@media (max-width: 600px) {
  /* 7.1  Phone-only tightening: the drawer may use more of a small screen, and
     the composer gets a shorter cap where 40svh is a large slice. */
  #root > [data-slot='root'] > div:not([data-sidebar-collapsed]) > [class*='_sidebarCol'] {
    width: min(88vw, 340px) !important;
  }
  [data-composer-seat] {
    --dsh-composer-text-max-height: min(32svh, 280px) !important;
  }
}
`

/** The minimum `document` surface the sheet's injection and flag tiers need. */
export interface MobileDocument {
  querySelector(selector: string): ElementLike | null
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
  createElement(tag: string): StyleElementLike
  head: { appendChild(node: StyleElementLike): void }
  documentElement: RootElementLike
}

/** The element surface the flag tiers read. */
export interface ElementLike {
  getAttribute(name: string): string | null
}

/** The `html` element surface the keyboard hand-off writes to. */
export interface RootElementLike {
  style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): void
  }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** The style element as far as this module touches it. */
export interface StyleElementLike {
  dataset: Record<string, string>
  textContent: string
  /**
   * Optional on purpose: the frozen id is written as an attribute when the
   * environment has one and as the `data-dmr-style-id` hook otherwise, so the
   * pair-card tests' minimal document stub is a valid environment too.
   *
   * The fallback is **not** a production path: every real `Element` implements
   * `setAttribute` (WHATWG DOM; TypeScript's `lib.dom.d.ts:10701` declares it at
   * `:11058`), and `document.createElement('style')` yields an
   * `HTMLStyleElement` (`lib.dom.d.ts:16707`), so a browser always takes the
   * attribute branch. Idempotency never depends on either branch: the dedup key
   * is `data-plugin-css`, which is written unconditionally.
   */
  setAttribute?(name: string, value: string): void
  remove(): void
}

/** The `window` surface the keyboard hand-off needs (all optional: SSR, tests). */
export interface MobileWindow {
  visualViewport?: VisualViewportLike
  innerHeight?: number
  addEventListener?(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

/** The visual-viewport subset used to measure the keyboard. */
export interface VisualViewportLike {
  height: number
  offsetTop: number
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** Everything this module reads from the page; every member is optional. */
export interface MobileEnvironment {
  document?: MobileDocument
  window?: MobileWindow
  /** The host-published global (index-inject row, see docs/05 §4). */
  hostGlobal?: { [key: string]: unknown }
}

/** The style tag lookup: stable id first, then the HMR-facing tag id. */
const STYLE_SELECTOR = `#${MOBILE_STYLE_ID}, style[data-plugin-css=${JSON.stringify(MOBILE_STYLE_KEY)}]`

/** The `<meta>` selector for the fallback tier. */
const META_SELECTOR = `meta[name=${JSON.stringify(MOBILE_CSS_META_NAME)}]`

/** Read a boolean that may arrive as a real boolean or as a written word. */
function parseBooleanish(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase()
    if (word === '0' || word === 'false' || word === 'off' || word === 'no') return false
    if (word === '1' || word === 'true' || word === 'on' || word === 'yes') return true
  }
  return undefined
}

/** The per-request override: `?mobileCss=0` anywhere on a plugin script URL. */
function readQueryFlag(document: MobileDocument | undefined): boolean | undefined {
  const scripts = document?.querySelectorAll?.('script[src]')
  if (scripts === undefined) return undefined
  const pattern = new RegExp(`[?&]${MOBILE_CSS_QUERY_KEY}=([^&#]*)`)
  for (let index = 0; index < scripts.length; index += 1) {
    const script = scripts[index]
    const src = script?.getAttribute('src')
    if (typeof src !== 'string' || !src.includes(`${NAMESPACE}/client.js`)) continue
    const match = pattern.exec(src)
    if (match === null) continue
    const parsed = parseBooleanish(decodeURIComponent(match[1] ?? ''))
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/**
 * Resolve the `mobileCss` switch — **fail-safe**: the `?mobileCss=` query can
 * only ever *subtract*, never re-enable a layer the host switched off.
 *
 * 1. the host value, which is what the operator configured:
 *    `globalThis.__DSH_MOBILE_REMOTE__.mobileCss` (the host half's normal
 *    delivery path, a `webserver/index-inject` `{kind:'global'}` row), then
 *    `<meta name="dsh-mobile-remote-mobile-css" content="…">` (a static hook),
 *    then the frozen default `true` (docs/00-contract.md §3);
 * 2. `?mobileCss=0|1` on this plugin's script URL — a per-load override that
 *    needs no host change (a scratch page or the HMR loop). `0` turns the layer
 *    **off** even when the host allows it; `1` cannot turn it **on** when the
 *    host forbids it (t13 F4: an operator's `false` must not be reversible from
 *    the page URL).
 *
 * `source` names the tier that decided the answer; `ignoredQuery` is set when a
 * query asked for something the host does not allow, so the diagnostic line can
 * say so instead of leaving the operator guessing.
 *
 * @param environment - the page surface; defaults to the real one.
 * @returns the value, the deciding tier, and whether a query was ignored.
 */
export function readMobileCssFlag(environment?: MobileEnvironment): MobileCssFlag {
  const document = resolveDocument(environment)
  const fromQuery = readQueryFlag(document)
  const host = readHostFlag(environment, document)

  if (!host.enabled) {
    return fromQuery === true
      ? { enabled: false, source: host.source, ignoredQuery: true }
      : { enabled: false, source: host.source }
  }
  if (fromQuery === false) return { enabled: false, source: 'query' }
  return { enabled: true, source: host.source }
}

/** The host-side tiers: global, then meta, then the frozen default. */
function readHostFlag(
  environment: MobileEnvironment | undefined,
  document: MobileDocument | undefined,
): { enabled: boolean; source: MobileCssSource } {
  const global = environment?.hostGlobal ?? (globalThis as { [key: string]: unknown })
  const container = global[GLOBAL_CONFIG_NAME]
  if (container !== null && typeof container === 'object') {
    const fromGlobal = parseBooleanish((container as Record<string, unknown>)[MOBILE_CSS_QUERY_KEY])
    if (fromGlobal !== undefined) return { enabled: fromGlobal, source: 'global' }
  }

  const meta = document?.querySelector(META_SELECTOR) ?? null
  const fromMeta = parseBooleanish(meta?.getAttribute('content'))
  if (fromMeta !== undefined) return { enabled: fromMeta, source: 'meta' }

  return { enabled: true, source: 'default' }
}

/** The live document, when there is one. */
function resolveDocument(environment?: MobileEnvironment): MobileDocument | undefined {
  if (environment?.document !== undefined) return environment.document
  const page = (globalThis as { document?: MobileDocument }).document
  return page
}

/** The live window, when there is one. */
function resolveWindow(environment?: MobileEnvironment): MobileWindow | undefined {
  if (environment?.window !== undefined) return environment.window
  return globalThis as MobileWindow
}

/**
 * The sheet text, honouring the switch.
 *
 * An empty string is the whole "switched off" contract: no node, no listener,
 * nothing to clean up. Tests assert this directly, which is why the text (and
 * not just the injection) is exported.
 *
 * @param environment - the page surface; defaults to the real one.
 * @returns the stylesheet, or `''` when `mobileCss` is off.
 */
export function mobileCssText(environment?: MobileEnvironment): string {
  return readMobileCssFlag(environment).enabled ? MOBILE_STYLESHEET : ''
}

/**
 * Inject the narrow-screen sheet once.
 *
 * Idempotent through the frozen id: a sheet already in the page (an earlier
 * mount, or a recomposition that outlived its disposer) is reused and the
 * returned disposer does not remove a node this call did not create.
 *
 * @param environment - the page surface; defaults to the real one.
 * @returns the disposer; a no-op when switched off or when there is no document.
 */
export function injectMobileCss(environment?: MobileEnvironment): () => void {
  const document = resolveDocument(environment)
  if (document === undefined) return () => {}

  const text = mobileCssText(environment)
  if (text === '') return () => {}

  if (document.querySelector(STYLE_SELECTOR) !== null) return () => {}

  const tag = document.createElement('style')
  if (typeof tag.setAttribute === 'function') tag.setAttribute('id', MOBILE_STYLE_ID)
  else tag.dataset['dmrStyleId'] = MOBILE_STYLE_ID
  tag.dataset['plugin'] = NAMESPACE
  tag.dataset['pluginCss'] = MOBILE_STYLE_KEY
  tag.dataset['dmrMobileCss'] = 'true'
  tag.textContent = text
  document.head.appendChild(tag)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    tag.remove()
  }
}

/**
 * Publish the on-screen keyboard's height and let CSS react.
 *
 * On every `resize`/`scroll` of `window.visualViewport` (plus any window
 * `resize`), the layout viewport's shortfall is written to
 * `html.style[--dsmr-keyboard-inset]`, and `html[data-dsmr-keyboard="true"]` is
 * set while the shortfall is keyboard-sized (see {@link KEYBOARD_MIN_INSET_PX}).
 * The sheet's rule 6.1 consumes both.
 *
 * The listener is not installed and the attribute is not set when the switch is
 * off — the caller (`installNarrowScreenLayer`) checks first.
 *
 * @param environment - the page surface; defaults to the real one.
 * @returns a disposer that removes the listeners, the variable and the attribute.
 */
export function installKeyboardAvoidance(environment?: MobileEnvironment): () => void {
  const document = resolveDocument(environment)
  const root = document?.documentElement
  if (root === undefined) return () => {}

  const window = resolveWindow(environment)
  const viewport = window?.visualViewport

  const sync = (): void => {
    const layoutHeight = typeof window?.innerHeight === 'number' ? window.innerHeight : 0
    if (viewport === undefined || layoutHeight === 0) {
      root.style.setProperty(KEYBOARD_INSET_VAR, '0px')
      root.removeAttribute(KEYBOARD_STATE_ATTR)
      return
    }
    const shortfall = Math.max(0, Math.round(layoutHeight - (viewport.height + viewport.offsetTop)))
    const open = shortfall >= KEYBOARD_MIN_INSET_PX
    root.style.setProperty(KEYBOARD_INSET_VAR, `${open ? shortfall : 0}px`)
    if (open) root.setAttribute(KEYBOARD_STATE_ATTR, 'true')
    else root.removeAttribute(KEYBOARD_STATE_ATTR)
  }

  sync()
  viewport?.addEventListener('resize', sync)
  viewport?.addEventListener('scroll', sync)
  window?.addEventListener?.('resize', sync)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    viewport?.removeEventListener('resize', sync)
    viewport?.removeEventListener('scroll', sync)
    window?.removeEventListener?.('resize', sync)
    root.style.removeProperty(KEYBOARD_INSET_VAR)
    root.removeAttribute(KEYBOARD_STATE_ATTR)
  }
}

/**
 * Install the whole narrow-screen layer, or nothing at all.
 *
 * This is the only entry point `src/client/index.ts` calls, and it is the single
 * place the switch is read: with `mobileCss: false` it installs no `<style>`
 * node and no `visualViewport` listener.
 *
 * @param environment - the page surface; defaults to the real one.
 * @returns a disposer releasing everything this call acquired.
 */
export function installNarrowScreenLayer(environment?: MobileEnvironment): () => void {
  const flag = readMobileCssFlag(environment)
  if (!flag.enabled) {
    try {
      const ignored =
        flag.ignoredQuery === true
          ? ' (a ?mobileCss=1 override was ignored: the host config is authoritative for enabling)'
          : ''
      console.info(
        `[dsh-mobile-remote] narrow-screen CSS off (mobileCss=false via ${flag.source})${ignored}; nothing injected`,
      )
    } catch {
      // A console that throws must not take the plugin down.
    }
    return () => {}
  }

  const disposeStyle = injectMobileCss(environment)
  const disposeKeyboard = installKeyboardAvoidance(environment)
  return () => {
    disposeKeyboard()
    disposeStyle()
  }
}
