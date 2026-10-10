/**
 * The pairing card's state machine — pure functions only, no React and no DOM.
 *
 * The card asks its own origin for `/mobile-remote/pair` (docs/00-contract.md
 * §5 R1) and has to turn whatever comes back into one readable sentence. The
 * response contract is small enough to state precisely:
 *
 * | status | body | state |
 * |---|---|---|
 * | 200 | `{url, authority, expiresAt}` | `ready` |
 * | 200 | `url` passes the lexical http(s) test but the URL parser refuses it | `unexpected` |
 * | 401 | `unauthorized` | `unauthorized` — the browser session is not admitted |
 * | 403 | `forbidden` | `forbidden` — the `Host`/`Origin` fence rejected the request |
 * | 503 | `pairing not configured` | `unconfigured` — `pairingAuthority` is empty |
 * | — | fetch rejected | `network` — the request never reached the server |
 *
 * Keeping this in its own module (rather than inside the component) is what
 * makes every branch testable under `node --test` without a browser.
 *
 * @module dsh-mobile-remote/client/pair-state
 */

/** The same-origin endpoint the card reads (frozen: docs/00-contract.md §5 R1). */
export const PAIR_ENDPOINT = '/mobile-remote/pair'

/** Why the card could not produce a pairing URL. */
export type PairFailure = 'unauthorized' | 'forbidden' | 'unconfigured' | 'network' | 'unexpected'

/** What the card can be showing. */
export type PairState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      /** Absolute launch URL, scheme included — what the phone opens or scans. */
      readonly url: string
      /** Bare authority the URL points at. */
      readonly authority: string
      /** ISO timestamp, or `null` when the host issues tokens without an expiry. */
      readonly expiresAt: string | null
    }
  | {
      readonly kind: 'failed'
      readonly failure: PairFailure
      /** Short machine-ish detail (HTTP status, error message) for the diagnostics line. */
      readonly detail: string
      /** Localized sentence the user reads. */
      readonly hint: string
    }

/** One raw response as the fetch wrapper sees it. */
export interface PairResponseInput {
  /** HTTP status; ignored when `networkError` is set. */
  readonly status: number
  /** Response body text (may be empty). */
  readonly body: string
  /** Set when the request itself failed (offline, DNS, abort, CSP…). */
  readonly networkError?: string
}

/**
 * Readable Chinese copy for one failure.
 *
 * @param failure - the failure kind.
 * @param detail - the raw detail (HTTP status or error text).
 * @returns the sentence shown in the card.
 */
export function pairHint(failure: PairFailure, detail: string): string {
  switch (failure) {
    case 'unauthorized':
      return '当前页面没有通过 DSH 的认证（HTTP 401）。请在这台桌面机器的浏览器里打开 GUI 并完成登录后再查看。'
    case 'forbidden':
      return `请求被 DSH 的 Host/Origin 围栏拒绝（${detail}）。通常意味着访问用的域名不在 web-runtime 的 trustedHosts 里，或请求走了别的名字。`
    case 'unconfigured':
      return '主机侧还没有配置 pairingAuthority，配对功能处于关闭状态。请在 profile 的插件配置里填入手机访问用的 authority（例如 demo.tailnet-example.ts.net）。'
    case 'network':
      return `请求没有到达 DSH 服务（${detail}）。检查本机 web 服务是否在运行，然后重试。`
    case 'unexpected':
    default:
      return `配对接口返回了预期之外的响应（${detail}）。`
  }
}

/** Build a failed state with its copy filled in. */
function failed(failure: PairFailure, detail: string): PairState {
  return { kind: 'failed', failure, detail, hint: pairHint(failure, detail) }
}

/**
 * The terminal state for anything the pipeline could not classify.
 *
 * Exported because every "should not happen" path of the card — a rejected load,
 * a state from a future revision this build does not know, a projection that
 * throws while rendering — must end in *some* readable state instead of leaving
 * the card on the loading sentence forever (t12 finding F1: a permanent
 * "正在向本机 DSH 申请配对链接…" is harder to diagnose than an error).
 *
 * @param detail - machine-ish reason, shown on the diagnostics line.
 * @returns a `failed` state, with the same readable copy as any other
 *   unexpected shape (the five failure kinds are frozen by the contract).
 */
export function unexpectedPairState(detail: string): PairState {
  return failed('unexpected', detail)
}

/** Human-readable one-liner for a caught value; never throws itself. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '未知异常'
  }
}

/** Whether a string is an absolute http(s) URL — the card refuses anything else. */
export function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(value)
}

/**
 * WHATWG-parse an absolute URL without ever throwing.
 *
 * {@link isAbsoluteHttpUrl} is a *lexical* test: it accepts strings the URL
 * parser then rejects (`https://[::1`, `https://a:b`, `https://%zz`, `https://x%2`).
 * Those used to escape as a `TypeError` out of {@link interpretPairResponse} —
 * see t12 finding F1.
 *
 * @param value - the candidate absolute URL.
 * @returns the parsed URL, or `undefined` when the parser refuses it.
 */
export function tryParseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * Turn one raw response into a card state.
 *
 * @param input - status, body text and an optional transport error.
 * @returns the state the card renders.
 */
export function interpretPairResponse(input: PairResponseInput): PairState {
  // A hostile caller can hand this function anything: normalizing the body keeps
  // every string operation below total (t12 finding F1 is about this class).
  const body = typeof input.body === 'string' ? input.body : ''
  if (input.networkError !== undefined && input.networkError !== '') {
    return failed('network', input.networkError)
  }
  if (input.status === 401) return failed('unauthorized', 'HTTP 401')
  if (input.status === 403) return failed('forbidden', 'HTTP 403')
  if (input.status === 503) return failed('unconfigured', 'HTTP 503')
  if (input.status !== 200) {
    const trimmed = body.trim()
    return failed('unexpected', `HTTP ${input.status}${trimmed === '' ? '' : ` · ${trimmed.slice(0, 120)}`}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return failed('unexpected', 'HTTP 200 · 响应不是 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) return failed('unexpected', 'HTTP 200 · 响应不是对象')

  const record = parsed as Record<string, unknown>
  const url = record['url']
  const authority = record['authority']
  if (typeof url !== 'string' || !isAbsoluteHttpUrl(url)) {
    return failed('unexpected', 'HTTP 200 · 缺少可用的绝对 url')
  }
  // Lexical test passed — the parser can still refuse it (t12 finding F1).
  const absoluteUrl = tryParseUrl(url)
  if (absoluteUrl === undefined) {
    return failed('unexpected', 'HTTP 200 · url 不是可解析的绝对 URL')
  }
  const expiresAt = typeof record['expiresAt'] === 'string' ? record['expiresAt'] : null
  return {
    kind: 'ready',
    url,
    authority: typeof authority === 'string' && authority !== '' ? authority : absoluteUrl.host,
    expiresAt,
  }
}

/** Whether a value is one of the three states this module can produce. */
export function isPairState(value: unknown): value is PairState {
  if (value === null || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'loading' || kind === 'ready' || kind === 'failed'
}

/**
 * Coerce whatever a load produced into a state the card can render.
 *
 * @param value - the resolved value of a load.
 * @returns the value itself when it is a known state, else a readable failure.
 */
export function normalizePairState(value: unknown): PairState {
  if (isPairState(value)) return value
  return unexpectedPairState('配对状态机返回了未知状态')
}

/**
 * Run one load and always resolve into a terminal state.
 *
 * This is the load path's whole contract: it **cannot reject** and it never
 * produces `loading`. A rejected loader, a loader returning a hostile object, a
 * state machine that throws on odd input — each becomes a readable `failed`
 * state (t12 finding F1).
 *
 * @param load - the loader; defaults to {@link loadPairState}.
 * @returns the state the card should render.
 */
export async function settlePairState(load: () => Promise<unknown> = () => loadPairState()): Promise<PairState> {
  try {
    return normalizePairState(await load())
  } catch (error) {
    return unexpectedPairState(`加载配对状态失败：${describeError(error)}`)
  }
}

/** The parts of `fetch` the card uses — injectable so tests need no network. */
export type FetchLike = (
  input: string,
  init?: { credentials?: RequestCredentials; cache?: RequestCache; headers?: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>

/**
 * Load the pairing state from the same origin.
 *
 * The URL never leaves React state, and neither this module nor the card touches
 * any persistent browser store: the value lives in memory for as long as the
 * card is mounted. (The bundled artifact is asserted to contain no storage API
 * at all — see `test/client-pair.test.mjs`.)
 *
 * **Never rejects**, and that claim is now enforced rather than assumed: the
 * fetch call, the body read and the final response projection each sit in their
 * own `try`/`catch`, so a rejected fetch, a throwing `text()`, a throwing
 * `status` getter or an unparseable URL all land in a readable state (t12
 * finding F1).
 *
 * @param fetchImpl - the fetch implementation (defaults to the page's `fetch`).
 * @returns the resolved state; never rejects.
 */
export async function loadPairState(fetchImpl?: FetchLike): Promise<PairState> {
  const call = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined)
  if (call === undefined) return failed('network', 'fetch 不可用')
  let response: { status: number; text(): Promise<string> }
  try {
    response = await call(PAIR_ENDPOINT, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    return failed('network', error instanceof Error ? error.message : String(error))
  }
  let body = ''
  try {
    body = await response.text()
  } catch (error) {
    return failed('unexpected', error instanceof Error ? error.message : String(error))
  }
  try {
    return interpretPairResponse({ status: response.status, body })
  } catch (error) {
    // Reading `status` off a hostile response object can throw by itself.
    return unexpectedPairState(describeError(error))
  }
}
