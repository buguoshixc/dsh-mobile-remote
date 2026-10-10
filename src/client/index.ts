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
 *
 * @module dsh-mobile-remote/client
 */

import type { Context } from '@deepseek-ai/cordis'

import { installNarrowScreenLayer } from './mobile-css.ts'
import { registerPairSurfaces } from './pair-card.ts'
import { injectCardStyles } from './styles.ts'

/** Hard dependency: the slot service (provided by `ui-renderer`). */
export const inject = ['slots']

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
    const disposeStyles = injectCardStyles()
    const disposeMobile = installNarrowScreenLayer()
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
