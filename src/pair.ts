/**
 * Pairing: the pure half of "give me a link my phone can open".
 *
 * The launch URL is *not* minted here — it belongs to the shipped
 * `client-connection` service, which holds the process launch token and knows
 * the query-parameter name it expects (`TOKEN_QUERY`, see
 * `docs/evidence/dsh-client-connection__lib__index.js`). This module only:
 *
 *  - resolves the ports that must be present for pairing to be possible, with a
 *    readable refusal for each missing one (fail closed, never a guessed port);
 *  - assembles the authority root the token is attached to;
 *  - shapes the tool result exactly as docs/00-contract.md §4 freezes it;
 *  - renders that result as text, because the phone needs a URL it can tap.
 *
 * Everything here is pure and takes its ports explicitly, so the whole module is
 * testable without a cordis context.
 *
 * @module dsh-mobile-remote/pair
 */

import { safeText } from './audit.ts'
import { pairingBaseUrl } from './config.ts'

/** The port pairing needs from `client-connection`. */
export interface AuthenticatedUrlPort {
  /**
   * Add this process's launch token to a clean browser URL.
   *
   * @param baseUrl - clean browser URL whose authority and mount are preserved.
   * @returns the same URL carrying the process token as its sole auth input.
   */
  authenticatedUrl(baseUrl: string): string
}

/** Result codes frozen by docs/00-contract.md §4. */
export type PairFailureCode = 'not-configured' | 'connection-unavailable' | 'internal'

/** The tool's canonical result value (docs/00-contract.md §4). */
export interface PairResult {
  ok: boolean
  configured: boolean
  authority?: string
  url: string | null
  /** Always `null` on success (the launch token has no expiry); absent on failure. */
  expiresAt?: null
  code?: PairFailureCode
  /**
   * Readable reason. Never an exception's raw text: anything dynamic in here was
   * produced by the shared sanitizer (`docs/00-contract.md` §4 CHANGE-t21-A).
   */
  message?: string
  /**
   * Configuration notes. **Always present** — an empty array when there is
   * nothing to warn about — so the success row's shape does not depend on
   * whether the fence happens to need opening (review F3).
   */
  notes: string[]
}

/** Outcome of resolving the pairing ports off the live context. */
export type PairPortResolution =
  | { ok: true; connection: AuthenticatedUrlPort }
  | { ok: false; code: PairFailureCode; message: string }

/** A cordis `ctx.get(name)`-shaped lookup, injected so this module stays pure. */
export type ServiceLookup = (name: string) => unknown

/** Whether a looked-up service is the port this plugin calls. */
function isAuthenticatedUrlPort(value: unknown): value is AuthenticatedUrlPort {
  return value !== null && typeof value === 'object' && typeof (value as { authenticatedUrl?: unknown }).authenticatedUrl === 'function'
}

/**
 * Resolve the ports pairing depends on, or explain which one is missing.
 *
 * Failure is closed by design (docs/00-contract.md §4 "失败即关闭"): no service
 * means a readable refusal, never a fallback that guesses a port or mints a URL
 * the fence would reject. `webServer` and `webRuntime` are checked as well as
 * `connection`, because a URL is only useful when this composition actually
 * serves HTTP and derives its browser-trust fence (the fence's `trustedHosts`
 * come from `ctx.webRuntime`, see docs/00-contract.md §1.2 B-3).
 *
 * @param get - service lookup off the plugin context.
 * @returns the connection port, or the refusal to report.
 */
export function resolvePairPort(get: ServiceLookup): PairPortResolution {
  const connection = get('connection')
  if (!isAuthenticatedUrlPort(connection)) {
    return {
      ok: false,
      code: 'connection-unavailable',
      message: '未找到可用的 connection 服务（client-connection 未挂载），无法生成配对链接。',
    }
  }
  if (get('webServer') === undefined) {
    return {
      ok: false,
      code: 'connection-unavailable',
      message: '未找到可用的 webServer 服务（Web 组合未挂载），配对链接无法被访问。',
    }
  }
  if (get('webRuntime') === undefined) {
    return {
      ok: false,
      code: 'connection-unavailable',
      message: '未找到可用的 webRuntime 服务：浏览器信任围栏（trustedHosts）由它导出，手机访问会被 403 拦下。',
    }
  }
  return { ok: true, connection }
}

/**
 * Assemble the pairing URL: the authority root, plus this process's launch token
 * attached by the shipped port (which owns both the token and the parameter
 * name, so the two can never drift apart).
 *
 * @param port - the resolved connection port.
 * @param authority - the configured bare authority.
 * @returns the authenticated launch URL.
 */
export function buildPairUrl(port: AuthenticatedUrlPort, authority: string): string {
  return port.authenticatedUrl(pairingBaseUrl(authority))
}

/**
 * Success result (docs/00-contract.md §4).
 *
 * `notes` is always present (empty when the fence needs no attention), so a
 * caller can read `result.notes` unconditionally.
 *
 * @param authority - the configured bare authority.
 * @param url - the authenticated launch URL.
 * @param notes - configuration warnings to carry along.
 * @returns the canonical success result.
 */
export function pairSuccess(authority: string, url: string, notes: string[] = []): PairResult {
  return { ok: true, configured: true, authority, url, expiresAt: null, notes: [...notes] }
}

/** Readable refusal for an unconfigured deployment (pairing switched off). */
export function pairNotConfigured(): PairResult {
  return {
    ok: false,
    configured: false,
    code: 'not-configured',
    message: 'pairingAuthority 未配置：在 DSH 配置里设置 dsh-mobile-remote.pairingAuthority 后重试。',
    url: null,
    notes: [],
  }
}

/** Readable refusal for a missing service or a broken authority value. */
export function pairUnavailable(code: PairFailureCode, message: string, configured: boolean): PairResult {
  return { ok: false, configured, code, message, url: null, notes: [] }
}

/** Readable refusal for an authority that is not a bare `host[:port]`. */
export function pairAuthorityInvalid(authority: string): PairResult {
  return pairUnavailable(
    'internal',
    `pairingAuthority ${safeText(authority, 80)} 不是裸 host[:port] authority（不能带 scheme、路径、用户信息、空白或非规范端口），已按未配置处理。`,
    true,
  )
}

/**
 * A configuration note worth surfacing with a working URL.
 *
 * The phone reaches this GUI through a reverse proxy, so the request's `Host`
 * must be a *trusted* authority or the shipped fence answers 403 for every
 * `/api` call (docs/00-contract.md §1.2 B-2/B-3). When the configured authority
 * is absent from the fence's exported `trustedHosts`, say so — a working tool
 * result that silently produces an unusable phone page would be worse than no
 * note at all.
 *
 * @param authority - the configured authority.
 * @param trustedHosts - the fence's exported authority list, when readable.
 * @returns the note, or undefined when there is nothing to warn about.
 */
export function fenceNote(authority: string, trustedHosts: unknown): string | undefined {
  const shown = safeText(authority, 80)
  if (!Array.isArray(trustedHosts)) {
    return `未能读取 webRuntime.trustedHosts：请确认 profile patch 已按 docs/00-contract.md §7 放开 ${shown}，否则手机访问会被 403 拦下。`
  }
  const entries = trustedHosts.filter((entry): entry is string => typeof entry === 'string')
  if (entries.includes(authority)) return undefined
  return `pairingAuthority ${shown} 不在 webRuntime.trustedHosts（当前为 ${safeText(JSON.stringify(entries), 120)}）中：手机经反代访问时 Host 围栏会返回 403。按 docs/00-contract.md §7 的片段放开该 authority。`
}

/**
 * Render one result for the model/user channel.
 *
 * The success text must carry the URL in a directly openable form — the phone
 * workflow is "ask for a link, tap the link" (docs/00-contract.md §4). Failures
 * carry no URL at all, and never a token.
 *
 * @param result - the canonical result value.
 * @returns the text block content.
 */
export function renderPairResult(result: PairResult): string {
  if (result.ok && result.url !== null) {
    // The success text *is* the product: the phone needs the URL, token included.
    return [`手机配对链接（可直接点开）：${result.url}`, '', JSON.stringify(result, null, 2)].join('\n')
  }
  // The failure text is the surface F2 found echoing a thrown exception verbatim.
  // It runs through the same sanitizer the audit `detail` uses — the summary line
  // *and* the JSON payload, which would otherwise carry the very same text.
  const message = safeText(result.message ?? result.code ?? 'unknown')
  return [`配对不可用：${message}`, '', JSON.stringify({ ...result, message }, null, 2)].join('\n')
}
