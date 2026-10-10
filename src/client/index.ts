/**
 * dsh-mobile-remote — browser half.
 *
 * dsh-client-modules serves this bundle at `/plugins/dsh-mobile-remote/client.js`
 * and its `factory(require)` runs when the kernel materializes the entry, so
 * every side effect — including CSS injection — lives inside the module body,
 * never at script top level.
 *
 * The surface is the frozen one from docs/00-contract.md §6.1:
 *
 * - `inject = ['slots']` is a hard dependency on the slot service registration
 *   surface (`slots` is provided by `ui-renderer`, which the roster orders before
 *   every UI package). `layout` is deliberately **not** listed: it is reached
 *   only through the sidebar's own click handler, so a missing `layout` cannot
 *   unmount this plugin.
 * - `apply(ctx)` injects the card stylesheet once and registers the pairing
 *   panel (keyed `main`, key `mobile-remote`) plus its `sidebar.panellist` row.
 *   Both registrations go through waiters and swallow their own failures: a slot
 *   this plugin cannot claim must cost the user a missing card, never a broken
 *   client — see `pair-card.ts` `safeRegister`.
 * - `apply` is also where the module URL is captured, once, and handed to the
 *   narrow-screen layer. It must happen here rather than in a lazy read: DSH's
 *   loader drops the bundle's `<script>` element on `load` and materializes this
 *   factory afterwards, so every moment after activation is already too late for
 *   a DOM lookup (t34 finding C1, `mobile-css.ts` `captureModuleUrl`).
 *
 * @module dsh-mobile-remote/client
 */

import type { Context } from '@deepseek-ai/cordis'

import { captureModuleUrl, installNarrowScreenLayer } from './mobile-css.ts'
import { registerPairSurfaces } from './pair-card.ts'
import { injectCardStyles } from './styles.ts'

/** Hard dependency: the slot service (provided by `ui-renderer`). */
export const inject = ['slots']

/**
 * This module's own URL, captured once when the factory runs.
 *
 * DSH materializes the factory on first import, i.e. this statement is the
 * earliest point in the plugin's own code where the page can still be asked about
 * the bundle load — one task *after* `defaultLoadBundle` removed the `<script>`
 * element (`docs/evidence/dsh-client-modules__lib__client.js:451-458` vs `:17-21`).
 * The value is handed to the narrow-screen layer, so nothing below has to look at
 * the page again (t34 finding C1, `mobile-css.ts` `captureModuleUrl`).
 */
const MODULE_URL = captureModuleUrl()

/**
 * Mount the browser half.
 *
 * Everything a mount acquires is acquired inside one `ctx.effect(...)`, so a
 * profile recomposition removes the stylesheets again, releases the
 * `visualViewport` listener and lets the slot framework drop the registrations it
 * owns.
 *
 * The narrow-screen layer (T5, `mobile-css.ts`) is additive and switch-controlled:
 * with `mobileCss: false` it answers an empty sheet, so the pairing card keeps
 * working while the mobile layout layer stays off. The card and its QR encoder are
 * untouched by that path.
 *
 * Never throws: a client plugin that throws during activation is worse than a
 * plugin that shows nothing.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: Context): void {
  const mount = (): (() => void) => {
    // The capture above is the factory-entry answer; a page that had nothing to
    // say *then* is asked once more here rather than frozen as "never", because a
    // load record only ever appears (the bundle must load before this runs) and a
    // first mount must not decide the question for a page that was still empty.
    // `undefined` is a valid answer either way: no override, the host tiers decide.
    const environment = { moduleUrl: MODULE_URL ?? captureModuleUrl() }
    const disposeStyles = injectCardStyles()
    const disposeMobile = installNarrowScreenLayer(environment)
    registerPairSurfaces(ctx)
    return () => {
      disposeMobile()
      disposeStyles()
    }
  }

  try {
    if (typeof ctx?.effect === 'function') {
      ctx.effect(mount, 'dsh-mobile-remote: pair card + narrow-screen layer')
      return
    }
    mount()
  } catch (error) {
    try {
      console.warn(
        `[dsh-mobile-remote] pair card could not mount: ${error instanceof Error ? error.message : String(error)}`,
      )
    } catch {
      // A console that throws must not take the plugin down.
    }
  }
}
