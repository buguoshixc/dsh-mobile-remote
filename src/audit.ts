/**
 * Audit: one structured record per `/mobile-remote/*` decision.
 *
 * The record answers "who asked for what, from where, and what did we answer",
 * for the device-level revocation story T1 (P4) needs. Two rules make it safe to
 * keep:
 *
 *  1. it is built from *chosen scalars only* — never a header bag, never a
 *     request body, never a URL with its query string — and anything free-form
 *     passes through {@link redact} first, so a token or cookie value cannot
 *     reach the sink even by accident;
 *  2. `auditLog: false` writes nothing at all: the sink is not called, and no
 *     entry is buffered;
 *  3. it records *both* halves of the source story — `source` (the leftmost
 *     `X-Forwarded-For` entry, which is client-controllable behind a proxy) and
 *     `socketPeer` (the peer the kernel saw, always the loopback behind
 *     `tailscale serve`) plus `viaForwarded` — so a hardening decision never has
 *     to trust a header on its own (F4; docs/00-contract.md §7.0.2 CHANGE-t21-C).
 *
 * {@link redact} / {@link safeText} / {@link sanitizeError} are the *shared*
 * text-safety helpers of this plugin: every surface that echoes text the plugin
 * did not author (audit `detail`, tool `message`, the mount banner) runs through
 * them, so an exception's raw text — token included — cannot reach a log line or
 * a model transcript (F2).
 *
 * The source address follows the frozen rule (docs/00-contract.md §5): the
 * leftmost non-empty `X-Forwarded-For` entry wins, falling back to the socket's
 * remote address. That ordering is not an optimization — behind `tailscale
 * serve` the socket peer is always `127.0.0.1`, so the socket address alone
 * would identify every phone as the loopback and make the audit useless.
 *
 * @module dsh-mobile-remote/audit
 */

/** Event name carried by every record of this plugin. */
export const AUDIT_EVENT = 'mobile-remote/access'

/**
 * The `X-Forwarded-For` header, in its canonical spelling and in the lower-case
 * form header lookups use. The canonical spelling is what the docs and the
 * hardening contract quote; `FORWARDED_HEADER` is what is compared.
 */
export const FORWARDED_HEADER_CANONICAL = 'X-Forwarded-For'
/** Lower-case lookup key for {@link FORWARDED_HEADER_CANONICAL}. */
export const FORWARDED_HEADER = FORWARDED_HEADER_CANONICAL.toLowerCase()

/** Header bag as Node hands it to a handler (or as a test stub builds it). */
export interface AuditHeaderBag {
  [name: string]: string | string[] | undefined
}

/** One structured audit record. */
export interface AuditEntry {
  /** ISO-8601 timestamp of the decision. */
  ts: string
  /** Fixed event name, so records can be filtered out of a shared log. */
  event: string
  /** Upper-case HTTP method. */
  method: string
  /** Request pathname only — never the query string. */
  path: string
  /** Decision: `ok`, `unauthorized`, `forbidden`, `not-configured`, `method-not-allowed`, … */
  result: string
  /** Response status written for that decision, when one was written. */
  status?: number
  /** Source address: leftmost X-Forwarded-For entry, else the socket peer. */
  source: string
  /**
   * The peer the socket actually saw (normalized). Behind `tailscale serve`
   * this is always the loopback, which is exactly what makes it useful: it is
   * the one source field a remote caller cannot forge.
   */
  socketPeer: string
  /** Whether `source` came from `X-Forwarded-For` rather than the socket peer. */
  viaForwarded: boolean
  /** Optional short explanation; sanitized and bounded before it is recorded. */
  detail?: string
}

/** What a caller supplies for one record. */
export interface AuditInput {
  method: string
  path: string
  result: string
  source: string
  /** Socket peer, when the caller has one; defaults to `source`. */
  socketPeer?: string
  /** True only when `source` was taken from `X-Forwarded-For`. */
  viaForwarded?: boolean
  status?: number
  detail?: string
}

/** Construction options for {@link AuditLog}. */
export interface AuditLogOptions {
  /** `config.auditLog`: false means the sink is never called. */
  enabled: boolean
  /** Where one JSON line goes; defaults to a no-op. */
  sink?: (line: string) => void
  /** Clock override, for deterministic tests. */
  now?: () => Date
  /** Ring-buffer bound for {@link AuditLog.entries}. */
  limit?: number
}

/** Default ring-buffer bound. */
export const AUDIT_BUFFER_LIMIT = 200

/**
 * Case-insensitive single-header read.
 *
 * Node lower-cases incoming header names, but a stub (or a Fetch-shaped bag) may
 * not, so both spellings are accepted.
 *
 * @param headers - the header bag.
 * @param name - lower-case header name.
 * @returns the first string value, or undefined.
 */
export function headerValue(headers: AuditHeaderBag | undefined, name: string): string | undefined {
  if (headers === undefined || headers === null) return undefined
  const direct = headers[name]
  if (typeof direct === 'string') return direct
  if (Array.isArray(direct)) {
    const first = direct.find((entry) => typeof entry === 'string' && entry.length > 0)
    if (first !== undefined) return first
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === 'string' && entry.length > 0)
      if (first !== undefined) return first
    }
  }
  return undefined
}

/** Everything the audit records about where a request came from. */
export interface SourceFacts {
  /** The address to show: leftmost non-empty XFF entry, else the socket peer. */
  source: string
  /** The socket peer, normalized; `unknown` when the runtime gave none. */
  socketPeer: string
  /** True only when `source` was taken from `X-Forwarded-For`. */
  viaForwarded: boolean
}

/**
 * Read the request's source facts, by the frozen precedence rule.
 *
 * `source` alone is not evidence (a client may write its own
 * `X-Forwarded-For`), so the socket peer and the "did the header win" flag are
 * returned alongside it: a hardening decision may treat `source` as the real
 * remote client only when `viaForwarded` is true *and* `socketPeer` is the
 * loopback the reverse proxy owns (docs/00-contract.md §7.0.2 CHANGE-t21-C).
 *
 * @param headers - request headers.
 * @param socketRemoteAddress - `req.socket.remoteAddress`, when available.
 * @returns the source, the socket peer and the forwarded flag.
 */
export function sourceFacts(
  headers: AuditHeaderBag | undefined,
  socketRemoteAddress?: string | undefined,
): SourceFacts {
  const socketPeer =
    typeof socketRemoteAddress === 'string' && socketRemoteAddress.length > 0
      ? normalizeSource(socketRemoteAddress)
      : 'unknown'

  const forwarded = headerValue(headers, FORWARDED_HEADER)
  if (forwarded !== undefined) {
    for (const part of forwarded.split(',')) {
      const candidate = part.trim()
      if (candidate.length > 0) {
        return { source: normalizeSource(candidate), socketPeer, viaForwarded: true }
      }
    }
  }
  return { source: socketPeer, socketPeer, viaForwarded: false }
}

/** Canonical UUID (v4 in practice): what the audit must be able to *name*. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a bare run of credential-shaped characters really is a secret.
 *
 * The previous rule redacted **any** 24+ character run of `[A-Za-z0-9_-]`, which
 * swallowed the very identifiers the audit exists to record: a UUID is 36 such
 * characters, so `device=<uuid>` was written as `device=<redacted>` and the P4
 * device-level trail could never say which device was revoked, un-revoked or
 * issued a grant (t33). A long single-label hostname was mangled the same way.
 *
 * Length alone cannot separate the two, but *character classes* can:
 *  - a UUID, and any hostname label, is lowercase (hex digits and `-` only), and
 *    a UUID's longest unbroken run is 12;
 *  - every real credential in this composition is `base64url(randomBytes(32))`
 *    — the launch token, the browser-session secret, the decision and device
 *    keys derived from it — which mixes upper case and lower case. The chance a
 *    43-character base64url value has no upper case at all is about 3e-10;
 *  - a raw hex digest/secret is a single 40+ character lowercase-hex run, which
 *    a UUID (hyphenated, max run 12) can never be.
 *
 * @param value - one bare run matched by the caller's scanner.
 * @returns true when the run should be replaced with `<redacted>`.
 */
function looksLikeSecret(value: string): boolean {
  if (UUID_PATTERN.test(value)) return false
  if (/^[0-9a-f]{40,}$/.test(value)) return true
  // A run this long is not an identifier whatever its shape: no UUID, hostname
  // label or device id reaches 64 characters, while a credential pasted into an
  // exception message, or a pathological blob an attacker sends, routinely does.
  // Keeping this catch-all is also what holds the `detail` field's bound: without
  // it a 400-character filler run survives redaction, the text then has to be
  // truncated, and the visible-length marker pushes the field past `SAFE_TEXT_LIMIT`
  // (measured: 210 > 200) — the bound still held, but by accident of the marker
  // rather than by redaction.
  if (value.length >= 64) return true
  return /[A-Z]/.test(value) && /[a-z]/.test(value)
}

/**
 * Strip anything token- or cookie-shaped out of free-form text.
 *
 * Defence in depth: the record is already built from chosen scalars, and this
 * runs over the one field a caller could fill with arbitrary text. It matches
 * credential *values*, not just credential spellings, because an exception
 * message carries whatever the thrown code put in it — `boom ${token}` is a
 * shape that a `?token=`-only rule walks straight past (F2).
 *
 * It must not, however, redact the identifiers the record is *about*: see
 * {@link looksLikeSecret} for why length alone was the wrong test (t33).
 *
 * @param text - candidate text.
 * @returns the text with credential values replaced by `<redacted>`.
 */
export function redact(text: string): string {
  return text
    .replace(/([?&]token=)[^&\s#]*/gi, '$1<redacted>')
    .replace(/dsh-auth-[A-Za-z0-9_-]+/gi, 'dsh-auth-<redacted>')
    .replace(/\bcookie\s*[:=]\s*[^\s;]+/gi, 'cookie=<redacted>')
    .replace(/\b(?:bearer|authorization)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{16,}/gi, '<redacted>')
    // Every capability this plugin mints is `v1.<payload>.<signature>`: the
    // decision link and the device grant alike. The prefix is what makes the
    // shape unambiguous, so it is matched even when the body looks innocuous.
    .replace(/\bv\d\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)*/g, '<redacted>')
    // Bare shapes, judged by character class rather than by length.
    .replace(/[A-Za-z0-9_-]{24,}/g, (match) => (looksLikeSecret(match) ? '<redacted>' : match))
}

/** Default bound for any text this plugin echoes. */
export const SAFE_TEXT_LIMIT = 200

/**
 * Bound for the recorded HTTP method.
 *
 * The method is whatever the client wrote on the request line, so it is both
 * attacker-controlled and unbounded: a 9000-character "method" was recorded
 * verbatim, which contradicts this module's chosen-scalars design and lets one
 * request put ~9 KB into the ring buffer (t33). The IANA registry's longest
 * method is far below this bound.
 */
export const METHOD_LIMIT = 16

/**
 * Bound a display string, keeping its length visible.
 *
 * A pathological value (a 64 KiB `pairingAuthority`, say) must not turn one log
 * line or one tool message into 64 KiB of noise, but silently cutting it hides
 * that it was pathological — hence the `…(len=N)` marker (F5).
 *
 * @param text - the text to bound.
 * @param limit - maximum kept characters.
 * @returns the bounded text.
 */
export function truncateForDisplay(text: string, limit: number = SAFE_TEXT_LIMIT): string {
  const bound = Number.isFinite(limit) && limit >= 8 ? Math.floor(limit) : SAFE_TEXT_LIMIT
  if (text.length <= bound) return text
  return `${text.slice(0, bound)}…(len=${text.length})`
}

/** Coerce an arbitrary thrown/held value into text without ever throwing. */
function coerceText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (value instanceof Error) return value.message
  if (typeof value === 'object') {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(value) ?? ''
    } catch {
      return ''
    }
  }
  if (typeof value === 'symbol' || typeof value === 'function' || typeof value === 'bigint') return ''
  return String(value)
}

/**
 * Redact and bound a value for a surface this plugin does not fully control.
 *
 * @param value - any value; only its text form is used.
 * @param limit - maximum kept characters.
 * @returns redacted, bounded text.
 */
export function safeText(value: unknown, limit: number = SAFE_TEXT_LIMIT): string {
  return truncateForDisplay(redact(coerceText(value)), limit)
}

/**
 * A *stable* error code, when the thrown value carries one.
 *
 * Only a short identifier-shaped `code`/`name` is kept. Everything else — the
 * message, the stack, a `cause` — is unstructured text and is handled by
 * {@link safeText} instead.
 *
 * @param error - the thrown value.
 * @returns the code, or undefined when there is none worth keeping.
 */
export function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const raw = (error as { code?: unknown }).code ?? (error as { name?: unknown }).name
  return typeof raw === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(raw) ? raw : undefined
}

/**
 * The shared sanitizer for anything thrown.
 *
 * Output shape: `<category>[/<stable code>]: <redacted, bounded text>`. The raw
 * exception text is never handed to a caller verbatim, so the audit `detail` and
 * the tool `message` — the two surfaces F2 found leaking — are produced by the
 * same function and cannot drift apart.
 *
 * @param error - the thrown value.
 * @param category - the caller's stable category (`internal`, `admission-error`, …).
 * @param limit - maximum kept characters of the text part.
 * @returns the sanitized description.
 */
export function sanitizeError(error: unknown, category = 'internal', limit: number = SAFE_TEXT_LIMIT): string {
  const code = errorCodeOf(error)
  const head = code === undefined || code === category ? category : `${category}/${code}`
  const text = safeText(error, limit)
  return text.length === 0 ? head : `${head}: ${text}`
}

/** Keep only the pathname of a request target, dropping query and fragment. */
export function pathnameOnly(target: string | undefined): string {
  if (typeof target !== 'string' || target.length === 0) return '/'
  const cut = target.search(/[?#]/)
  const path = cut === -1 ? target : target.slice(0, cut)
  return path.length === 0 ? '/' : path
}

/**
 * Reduce a candidate source address to an address-shaped token.
 *
 * `X-Forwarded-For` is client-controlled text, and a structured audit field must
 * stay structured: everything from the first character that cannot appear in an
 * address (`host`, `IPv4`, `[IPv6]`, with an optional port) is dropped, so a
 * value like `203.0.113.7?token=…` is recorded as `203.0.113.7` and a garbage
 * value is recorded as `unknown`.
 *
 * @param value - the raw candidate.
 * @returns the address-shaped prefix, or `unknown`.
 */
export function normalizeSource(value: string): string {
  const match = /^[A-Za-z0-9:._%\-\[\]]+/.exec(value.trim())
  return match === null ? 'unknown' : match[0]
}

/** One canonical JSON line for a record. */
export function formatAuditEntry(entry: AuditEntry): string {
  return JSON.stringify(entry)
}

/**
 * The plugin's audit sink and bounded in-memory view.
 *
 * The default sink is a no-op: the host half passes `ctx.logger.info`, so a
 * record lands in the DSH log while remaining a single structured JSON line.
 */
export class AuditLog {
  readonly enabled: boolean

  private readonly sink: (line: string) => void
  private readonly now: () => Date
  private readonly limit: number
  private readonly buffer: AuditEntry[] = []

  constructor(options: AuditLogOptions) {
    this.enabled = options.enabled
    this.sink = options.sink ?? (() => {})
    this.now = options.now ?? (() => new Date())
    this.limit = options.limit ?? AUDIT_BUFFER_LIMIT
  }

  /**
   * Record one decision.
   *
   * @param input - the chosen scalars for this record.
   * @returns the recorded entry, or undefined when auditing is off.
   */
  record(input: AuditInput): AuditEntry | undefined {
    if (!this.enabled) return undefined
    const entry: AuditEntry = {
      ts: this.now().toISOString(),
      event: AUDIT_EVENT,
      method: truncateForDisplay(coerceText(input.method).trim().toUpperCase(), METHOD_LIMIT),
      path: pathnameOnly(input.path),
      result: input.result,
      // The field is an address, not free text: normalize even when a caller
      // hands over a raw header value, so no query string can ride along.
      source: normalizeSource(redact(input.source)),
      socketPeer: normalizeSource(redact(input.socketPeer ?? input.source)),
      viaForwarded: input.viaForwarded === true,
    }
    if (input.status !== undefined) entry.status = input.status
    // The detail is the one field an exception message can reach, and it leaves
    // through the same sanitizer the tool channel uses (F2).
    if (input.detail !== undefined && input.detail.length > 0) entry.detail = safeText(input.detail)
    this.sink(formatAuditEntry(entry))
    this.buffer.push(entry)
    if (this.buffer.length > this.limit) this.buffer.splice(0, this.buffer.length - this.limit)
    return entry
  }

  /** Recent records, oldest first (a copy; callers cannot mutate the buffer). */
  entries(): readonly AuditEntry[] {
    return [...this.buffer]
  }
}
