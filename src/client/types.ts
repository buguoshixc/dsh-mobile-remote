/**
 * Structural types for the one browser service this plugin uses.
 *
 * The client half deliberately imports no `@deepseek-ai` client package: the
 * browser module table only carries `react` (plus the shell's own modules), and a
 * cross-package value import would also split the module identity of a service
 * the shell already owns. The runtime instance comes from `ctx`; the shapes
 * below are the structural subsets actually touched, verified against
 * docs/evidence (see `docs/00-contract.md` §6.1 and its C-3/C-4 notes).
 *
 * @module dsh-mobile-remote/client/types
 */

import type { Context } from '@deepseek-ai/cordis'

/** One `slots.register(...)` call's options, as far as this plugin needs them. */
export interface SlotOptions {
  /** The slot being filled, e.g. `main` or `sidebar.panellist`. */
  name: string
  /** Keyed slots key on this (a keyed slot registered without one throws). */
  key?: string
  /** List slots key on this. */
  id?: string
  /** Sort order inside a list slot (the shipped panels use 0 and 10). */
  order?: number
  /**
   * The row label a list slot projects. A thunk is resolved at read time
   * (`resolveSlotLabel`), but a plain string is accepted and keeps the label
   * independent of a locale namespace this plugin does not register.
   */
  label?: string | (() => string)
  /** Locale namespace for the slot's own strings. */
  locale?: string
}

/** The browser slot service (`@deepseek-ai/dsh-client-ui-renderer`, service name `slots`). */
export interface SlotsLike {
  /**
   * Wait for a slot declaration, then run the registration callback.
   *
   * The waiter semantics are what makes a missing slot harmless: the callback
   * simply never runs, the plugin still activates.
   */
  inject(name: string, register: () => unknown): unknown
  /** Register a component (or a component factory) into a slot. */
  register(options: SlotOptions, component: unknown): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by `ui-renderer`; declared here as the structural subset used. */
    slots: SlotsLike
  }
}

/** Re-exported for the modules that only need the context type. */
export type { Context }
