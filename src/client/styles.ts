/**
 * The pairing card's stylesheet.
 *
 * House rules this file follows:
 *
 * - **one plugin-unique class prefix** (`dmr-`): an injected `<style>` is a flat
 *   sheet in a shared page, so a prefix shared with another plugin means
 *   whichever loads later wins silently;
 * - **colours come from the theme tokens** (`--dsw-alias-*`), so the card follows
 *   light/dark like every built-in surface — the two deliberate exceptions are
 *   the QR code itself, which must keep a dark-on-light contrast to stay
 *   scannable regardless of theme;
 * - **the tag carries `data-plugin` / `data-plugin-css`**, the HMR reclamation
 *   contract client-modules uses to claim and later replace a plugin's styles.
 *
 * The tag id (`dsh-mobile-remote-card-style`) is deliberately distinct from the
 * narrow-screen sheet's `dsh-mobile-remote-style` (docs/00-contract.md §6.1):
 * that one belongs to `mobile-css.ts`, this one to the card.
 *
 * @module dsh-mobile-remote/client/styles
 */

/** Plugin namespace; also the value of the tags' `data-plugin` attribute. */
export const NAMESPACE = 'dsh-mobile-remote'

/** The card sheet's stable id (see the module note on why it is not the contract id). */
export const CARD_STYLE_ID = 'dsh-mobile-remote-card-style'

/** The card sheet's `data-plugin-css` value, unique within the plugin. */
export const CARD_STYLE_KEY = `${NAMESPACE}/pair-card`

const CARD_CSS = `
.dmr-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  padding: 16px;
  overflow: auto;
  color: var(--dsw-alias-label-primary);
}
.dmr-panel-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dmr-panel-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
.dmr-panel-sub { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

.dmr-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base));
}
.dmr-card-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 22px; }
.dmr-card[data-dmr-state='failed'] { border-color: var(--dsw-alias-state-error-primary); }

/* Stable hooks for the narrow-screen sheet (T5): the panel and the card answer
   to these attributes rather than to a class the other sheet would have to know
   about. min-width:0 is what keeps a flex column from overflowing sideways. */
[data-dsh-mobile-remote='panel'],
[data-dsh-mobile-remote='pair-card'] { min-width: 0; }

.dmr-status { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
/* The three tones the card actually emits (pair-card.ts 'cardBody'): 'ok' on the
   ready state, 'error' on a failure, 'busy' while loading. Every one of them must
   be themed here or the state inherits the neutral colour and reads as noise —
   'ok' was missing (t34 finding C3). The success token is the shipped one for a
   success surface (--dsw-alias-state-success-primary, the same alias
   plugin-manager's result box uses). */
.dmr-status[data-dmr-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dmr-status[data-dmr-tone='busy'] { color: var(--dsw-alias-label-tertiary); }
.dmr-status[data-dmr-tone='ok'] { color: var(--dsw-alias-state-success-primary); }
/* The clipboard fallback sentence (copy button, t34 finding C4) shares the detail
   line's size but must not read as a mere note: it is the instruction the user
   has to follow when the browser exposes no clipboard. It is a child of
   '.dmr-actions' (a wrapping flex row), so 'flex-basis: 100%' gives it a row of
   its own instead of squeezing in beside the buttons. */
.dmr-copy-note { flex-basis: 100%; margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-secondary)); overflow-wrap: anywhere; }
.dmr-detail { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }

.dmr-url {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-layer-3));
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
  word-break: break-all;
  user-select: all;
}
.dmr-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dmr-action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-decoration: none;
  cursor: pointer;
}
.dmr-action:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dmr-action:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dmr-action-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-label-primary)); color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base)); }

.dmr-qr {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px;
  border-radius: var(--dsw-radius-md, 8px);
  background: #ffffff;
}
.dmr-qr svg { display: block; width: 100%; max-width: 320px; height: auto; }
.dmr-qr-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

.dmr-icon { display: inline-flex; align-items: center; justify-content: center; }

@media (max-width: 520px) {
  .dmr-panel { padding: 12px; }
  .dmr-card { padding: 12px; }
  .dmr-action { min-height: 44px; }
  .dmr-qr svg { max-width: min(78vw, 300px); }
}
`

/**
 * The minimum `document` surface the injection needs.
 *
 * Structural on purpose: the same code runs against the browser document and
 * against a stub under `node --test`.
 */
export interface StyleDocument {
  querySelector(selector: string): unknown
  createElement(tag: string): StyleElementLike
  head: { appendChild(node: StyleElementLike): void }
}

/** The style element as far as the injection touches it. */
export interface StyleElementLike {
  dataset: Record<string, string>
  textContent: string
  remove(): void
}

/**
 * Inject the card stylesheet once, returning a disposer that removes it.
 *
 * Idempotent: when a tag for this plugin's card sheet already exists (HMR, or a
 * second mount), the existing tag is reused and the disposer removes it.
 *
 * @param doc - the document to inject into; defaults to the page's `document`.
 * @returns a disposer; a no-op when there is no document (SSR, tests).
 */
export function injectCardStyles(doc?: StyleDocument): () => void {
  const target = doc ?? (globalThis.document as unknown as StyleDocument | undefined)
  if (target === undefined) return () => {}

  const selector = `style[data-plugin-css=${JSON.stringify(CARD_STYLE_KEY)}]`
  if (target.querySelector(selector) !== null) return () => {}

  const tag = target.createElement('style')
  tag.dataset['plugin'] = NAMESPACE
  tag.dataset['pluginCss'] = CARD_STYLE_KEY
  tag.dataset['dmrStyleId'] = CARD_STYLE_ID
  tag.textContent = CARD_CSS
  target.head.appendChild(tag)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    tag.remove()
  }
}

/** The stylesheet text — exported so tests can assert the prefix and the hooks. */
export const CARD_STYLESHEET = CARD_CSS
