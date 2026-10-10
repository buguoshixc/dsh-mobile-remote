/**
 * The pairing card, the panel that hosts it, and the sidebar entry that opens
 * the panel.
 *
 * ## What the user sees
 *
 * A card in the centre column that answers one question — "what do I open on the
 * phone?" — with the absolute launch URL and the same URL as a QR code, so the
 * phone needs no typing and no token copying. When the host cannot mint a URL the
 * card says which of the four reasons applies (see `pair-state.ts`).
 *
 * ## Mounting (frozen by docs/00-contract.md §6.1)
 *
 * - the panel registers into the **keyed** `main` slot under `PANEL_KEY`, which
 *   is the entry `ui-layout` renders for a non-Conversation panel;
 * - the sidebar row registers into the **list** slot `sidebar.panellist` with the
 *   same id and `order: 20` (after the shipped `plugins` = 0 and `schedules` = 10),
 *   so clicking it calls `ctx.layout.selectPanel('mobile-remote')`.
 *
 * Both go through `ctx.slots.inject(...)`, i.e. the waiting form the shipped
 * panels use: if the declaration never appears the callback never runs and the
 * plugin still activates.
 *
 * ## Failure policy
 *
 * **Nothing here may throw.** A client plugin that throws while registering is a
 * client plugin that fails to activate, which would take the card down *and*
 * leave a confusing boot log. Every registration therefore goes through
 * `safeRegister`, which swallows and logs instead.
 *
 * ## Token handling
 *
 * The launch URL lives in React state for as long as the card is mounted, and in
 * the DOM while it is shown. It is never handed to a persistent browser store —
 * the tests assert the built bundle contains no storage API name at all.
 *
 * @module dsh-mobile-remote/client/pair-card
 */

import React from 'react'

import { encodeQr, type QrMatrix } from './qr.ts'
import {
  describeError,
  loadPairState,
  settlePairState,
  unexpectedPairState,
  type PairState,
} from './pair-state.ts'
import { NAMESPACE } from './styles.ts'
import type { Context, SlotOptions } from './types.ts'

/** The panel key: `main`'s key, `sidebar.panellist`'s id, and the patch row id. */
export const PANEL_KEY = 'mobile-remote'

/** The label of the sidebar row (a plain string — this plugin registers no locale dictionary). */
export const PANEL_LABEL = '手机远控'

/** The stable attribute every surface of this plugin carries. */
export const CARD_ATTRIBUTE = 'data-dsh-mobile-remote'

/** `console.warn` wrapper so a degraded registration is visible but never fatal. */
function warn(message: string, error?: unknown): void {
  const suffix = error === undefined ? '' : ` (${error instanceof Error ? error.message : String(error)})`
  try {
    console.warn(`[${NAMESPACE}] ${message}${suffix}`)
  } catch {
    // A console that throws must not take the plugin down either.
  }
}

/**
 * Register one slot entry, swallowing every failure.
 *
 * The guard covers all four ways this can go wrong: the `slots` service is
 * absent, `inject` itself throws, `register` throws (a keyed-slot collision
 * throws by contract), or the callback throws when the declaration finally
 * appears — possibly inside another plugin's `register()` call, which is exactly
 * where an escape would be most damaging.
 *
 * @param ctx - the client root context.
 * @param slot - the slot name to wait for.
 * @param options - the registration key.
 * @param component - the component (or component factory) to register.
 * @returns `true` when the registration was handed over, `false` when it degraded.
 */
export function safeRegister(
  ctx: Context,
  slot: string,
  options: SlotOptions,
  component: unknown,
): boolean {
  try {
    const slots = ctx?.slots
    if (slots === undefined || typeof slots.inject !== 'function') {
      warn(`slot service unavailable; "${slot}" not registered`)
      return false
    }
    slots.inject(slot, () => {
      try {
        if (typeof slots.register !== 'function') return undefined
        return slots.register(options, component)
      } catch (error) {
        warn(`slot "${slot}" rejected the registration; the surface stays hidden`, error)
        return undefined
      }
    })
    return true
  } catch (error) {
    warn(`slot "${slot}" could not be registered; the surface stays hidden`, error)
    return false
  }
}

/**
 * Register the panel and its sidebar entry.
 *
 * The `locale` namespace is what docs/00-contract.md §6.1 freezes. Note the
 * framework coupling it implies: the renderer throws `SlotAssemblyError` for an
 * entry that declares `locale` when no locale face is installed
 * (`docs/evidence/dsh-client-ui-renderer__lib__client.js:721-724`). The shipped
 * composition always installs one — `ui-sidebar` and every built-in panel
 * register their dictionaries through it — and our components take no `t`, so
 * the seat exists only to keep the frozen registration shape.
 *
 * @param ctx - the client root context.
 * @returns one flag per registration: `[panel, sidebarRow]`.
 */
export function registerPairSurfaces(ctx: Context): boolean[] {
  const panel = safeRegister(ctx, 'main', { name: 'main', key: PANEL_KEY, locale: NAMESPACE }, PairPanel)
  const row = safeRegister(
    ctx,
    'sidebar.panellist',
    { name: 'sidebar.panellist', id: PANEL_KEY, order: 20, locale: NAMESPACE, label: PANEL_LABEL },
    PairPanelIcon,
  )
  return [panel, row]
}

/**
 * Turn a module matrix into one SVG path (a set of unit squares).
 *
 * @param matrix - the encoded matrix.
 * @returns a `d` attribute for an SVG whose viewBox is `0 0 size size`.
 */
export function qrModulesToPath(matrix: QrMatrix): string {
  const parts: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.modules[row] as readonly boolean[]
    for (let col = 0; col < matrix.size; col += 1) {
      if (line[col] === true) parts.push(`M${col} ${row}h1v1h-1z`)
    }
  }
  return parts.join('')
}

/** The QR block: the code itself, plus a readable fallback when it cannot be built. */
function QrBlock({ url }: { url: string }): React.ReactElement {
  const encoded = React.useMemo(() => {
    try {
      return { matrix: encodeQr(url), error: undefined as string | undefined }
    } catch (error) {
      return { matrix: undefined, error: error instanceof Error ? error.message : String(error) }
    }
  }, [url])

  if (encoded.matrix === undefined) {
    return React.createElement(
      'p',
      { className: 'dmr-qr-note', 'data-dmr-qr': 'unavailable' },
      `二维码无法生成（${encoded.error ?? '未知原因'}）；请直接用上面的链接。`,
    )
  }

  const size = encoded.matrix.size
  return React.createElement(
    'div',
    { className: 'dmr-qr', 'data-dmr-qr': 'ready', 'data-dmr-qr-version': String(encoded.matrix.version) },
    React.createElement(
      'svg',
      {
        viewBox: `0 0 ${size} ${size}`,
        role: 'img',
        'aria-label': '配对二维码',
        shapeRendering: 'crispEdges',
        focusable: 'false',
      },
      React.createElement('rect', { x: 0, y: 0, width: size, height: size, fill: '#ffffff' }),
      React.createElement('path', { d: qrModulesToPath(encoded.matrix), fill: '#000000' }),
    ),
  )
}

/** The copy-to-clipboard button (no storage: the clipboard is the only sink). */
function CopyButton({ url }: { url: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  const onClick = React.useCallback(() => {
    const clipboard = globalThis.navigator?.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }, [url])
  return React.createElement(
    'button',
    { type: 'button', className: 'dmr-action', onClick, 'data-dmr-action': 'copy' },
    copied ? '已复制' : '复制链接',
  )
}

/**
 * The card's one async path, with its terminal `.catch()`.
 *
 * Exported with an injectable loader so the contract "the card never stays on
 * the loading sentence" is provable under `node --test` without a DOM — t12
 * finding F1 was exactly this: `loadPairState` could reject, and the rejected
 * promise left the card showing "正在向本机 DSH 申请配对链接…" forever.
 *
 * @param apply - receives exactly one terminal state; never `loading`.
 * @param load - the loader; defaults to `loadPairState`.
 */
export function loadCardState(
  apply: (state: PairState) => void,
  load: () => Promise<unknown> = () => loadPairState(),
): void {
  void settlePairState(load)
    .then((next) => {
      apply(next)
    })
    .catch((error) => {
      // `settlePairState` already absorbs every loader failure; this second line
      // of defence covers an `apply` that throws (a setState during teardown, a
      // hostile observer) so the chain can never end in a bare rejection.
      apply(unexpectedPairState(`加载配对状态失败：${describeError(error)}`))
    })
}

/**
 * Project one state into the card's children. Pure: no hooks, no DOM.
 *
 * @param state - the state to render.
 * @param retry - starts a fresh load.
 * @returns the child elements, in order.
 */
export function cardBody(state: PairState, retry: () => void): React.ReactNode[] {
  const children: React.ReactNode[] = [
    React.createElement('h3', { className: 'dmr-card-title', key: 'title' }, '手机配对'),
  ]

  if (state.kind === 'loading') {
    children.push(
      React.createElement(
        'p',
        { className: 'dmr-status', 'data-dmr-tone': 'busy', role: 'status', key: 'status' },
        '正在向本机 DSH 申请配对链接…',
      ),
    )
  } else if (state.kind === 'failed') {
    children.push(
      React.createElement(
        'p',
        { className: 'dmr-status', 'data-dmr-tone': 'error', role: 'status', key: 'status' },
        state.hint,
      ),
      React.createElement('p', { className: 'dmr-detail', key: 'detail' }, `原因代码：${state.failure} · ${state.detail}`),
      React.createElement(
        'div',
        { className: 'dmr-actions', key: 'actions' },
        React.createElement(
          'button',
          { type: 'button', className: 'dmr-action', onClick: retry, 'data-dmr-action': 'retry' },
          '重试',
        ),
      ),
    )
  } else {
    children.push(
      React.createElement(
        'p',
        { className: 'dmr-status', 'data-dmr-tone': 'ok', role: 'status', key: 'status' },
        '用手机扫码或在手机上打开下面的链接即可完成配对；令牌只在本次会话内有效，不会被保存到浏览器。',
      ),
      React.createElement('code', { className: 'dmr-url', 'data-dmr-url': 'pair', key: 'url' }, state.url),
      React.createElement(
        'div',
        { className: 'dmr-actions', key: 'actions' },
        React.createElement(CopyButton, { url: state.url, key: 'copy' }),
        React.createElement(
          'a',
          {
            className: 'dmr-action dmr-action-primary',
            href: state.url,
            target: '_blank',
            rel: 'noreferrer',
            'data-dmr-action': 'open',
            key: 'open',
          },
          '打开配对链接',
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'dmr-action', onClick: retry, 'data-dmr-action': 'retry', key: 'retry' },
          '重新申请',
        ),
      ),
      React.createElement(QrBlock, { url: state.url, key: 'qr' }),
      React.createElement(
        'p',
        { className: 'dmr-detail', key: 'authority' },
        `目标地址：${state.authority}${state.expiresAt === null ? ' · 无固定有效期' : ` · 有效期至 ${state.expiresAt}`}`,
      ),
    )
  }

  return children
}

/**
 * Project a state without ever throwing during render.
 *
 * A projection failure (a state object whose getters throw, a shape from a
 * future revision) becomes a readable failure card instead of an exception
 * escaping into React's render — t12 finding F1's "never leave the user on a
 * silent sentence" rule applied to the render half.
 *
 * @param state - the state to render.
 * @param retry - starts a fresh load.
 * @returns the state actually rendered plus its children; the state is the
 *   failure state when the projection had to fall back.
 */
export function safeCardBody(
  state: PairState,
  retry: () => void,
): { state: PairState; children: React.ReactNode[] } {
  try {
    return { state, children: cardBody(state, retry) }
  } catch (error) {
    const fallback = unexpectedPairState(`卡片渲染失败：${describeError(error)}`)
    try {
      return { state: fallback, children: cardBody(fallback, retry) }
    } catch {
      // Nothing left to derive: emit one static sentence and stay renderable.
      return {
        state: fallback,
        children: [
          React.createElement(
            'p',
            { className: 'dmr-status', 'data-dmr-tone': 'error', role: 'status', key: 'status' },
            '卡片渲染失败；请刷新页面后重试。',
          ),
        ],
      }
    }
  }
}

/** The card itself: one state machine, one readable answer. */
export function PairCard(): React.ReactElement {
  const [state, setState] = React.useState<PairState>({ kind: 'loading' })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    loadCardState((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  const view = safeCardBody(state, retry)

  return React.createElement(
    'section',
    { className: 'dmr-card', [CARD_ATTRIBUTE]: 'pair-card', 'data-dmr-state': view.state.kind },
    ...view.children,
  )
}

/** The `main` panel that hosts the card. */
export function PairPanel(): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dmr-panel', [CARD_ATTRIBUTE]: 'panel' },
    React.createElement(
      'header',
      { className: 'dmr-panel-head' },
      React.createElement('h2', { className: 'dmr-panel-title' }, '手机远控'),
      React.createElement(
        'p',
        { className: 'dmr-panel-sub' },
        '把这台桌面 DSH 的 GUI 交给手机使用（需经 Tailscale 到达本机回环端口）。',
      ),
    ),
    React.createElement(PairCard),
  )
}

/** The sidebar row glyph; `ui-sidebar` supplies `size` and `active`. */
export function PairPanelIcon(props?: { size?: number; active?: boolean }): React.ReactElement {
  const size = props?.size ?? 18
  const color = props?.active === true ? 'var(--dsw-alias-label-primary)' : 'currentColor'
  return React.createElement(
    'span',
    { className: 'dmr-icon', [CARD_ATTRIBUTE]: 'icon' },
    React.createElement(
      'svg',
      { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      // A phone outline with a QR-ish square inside: reads as "scan to pair".
      React.createElement('rect', {
        x: 4.5,
        y: 1.5,
        width: 7,
        height: 13,
        rx: 1.5,
        stroke: color,
        strokeWidth: 1.2,
      }),
      React.createElement('rect', { x: 6.5, y: 6, width: 3, height: 3, fill: color }),
      React.createElement('path', { d: 'M7.2 12.6h1.6', stroke: color, strokeWidth: 1.2, strokeLinecap: 'round' }),
    ),
  )
}
