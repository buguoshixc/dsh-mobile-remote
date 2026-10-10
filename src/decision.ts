/**
 * One-time decision links: signing, verification, and the pending table.
 *
 * The phone answers an approval by opening a link we sent it. That link is a
 * capability: whoever holds it may cast exactly one decision, and only for the
 * request it was minted for. This module owns that capability and nothing else —
 * no HTTP route, no push transport, no approval-answerer wiring (those are the
 * t10 integration's job, and it imports this file directly).
 *
 * ## What the signature covers
 *
 * The token is the shipped credential idiom (`v1.<payload>.<signature>`, exactly
 * the shape `client-connection` uses for its browser cookie — see
 * `docs/evidence/dsh-client-connection__lib__index.js:299-313`):
 *
 * ```
 * v1.<base64url(JSON{version,id,expiresAt})>.<base64url(HMAC-SHA256(key, body))>
 * ```
 *
 * The MAC is computed over the **encoded body string**, not over re-serialized
 * JSON, so verification never depends on property order. The payload binds the
 * decision **id and its expiry** — signing only the id would let anyone mint
 * `?d=<other-id>&t=<this signature>` and decide a different request.
 *
 * ## Why every failure looks the same to the holder
 *
 * {@link DecisionStore.verify} answers with one closed code per failure class
 * (`malformed`, `bad-signature`, `unknown`, `used`, `expired`) so a wiring layer
 * can log the real reason, while the caller-facing response may collapse them
 * all into one refusal. The check order is deliberate: format → signature and
 * expiry (no state touched) → **replay** → existence → row/expiry agreement. A
 * forged token therefore never consumes or expires anything, and an expired or
 * unknown link never burns an id.
 *
 * Replay is answered before existence on purpose: a consumed id is removed from
 * the table, so consulting the table first would report every replay as
 * `unknown` and make the `used` class unreachable. The consumed-id set is
 * bounded ({@link DEFAULT_USED_LIMIT}); once an id falls out of that window a
 * replay degrades to `unknown` — still refused, never honoured.
 *
 * ## Fail-closed vocabulary
 *
 * {@link normalizeDecision} accepts **exactly** `allow`, `deny`, `cancel`,
 * `unavailable` — lowercase, no trimming, no case folding. Anything else is
 * `unavailable`, which is the only word that can never grant. That mirrors the
 * shipped approval service, whose answerers' rogue returns are normalized to
 * `unavailable` (docs/evidence/dsh-user-approval__lib__index.js:30-35, :176).
 *
 * @module dsh-mobile-remote/decision
 */

import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto'

/** The four legal decision words, verbatim. */
export const DECISIONS = ['allow', 'deny', 'cancel', 'unavailable'] as const

/** One decision word. */
export type Decision = (typeof DECISIONS)[number]

/**
 * What an unrecognized decision word becomes.
 *
 * `unavailable` is the shipped fail-closed outcome; it is never a grant, so a
 * garbled response can only lose the request, never approve it.
 */
export const FALLBACK_DECISION: Decision = 'unavailable'

/** The token version this module mints and accepts. */
export const TOKEN_VERSION = 'v1'

/** Default lifetime of a decision link, in milliseconds (contract's approvalTimeoutMs default). */
export const DEFAULT_TTL_MS = 120_000

/** Default bound on the pending table. */
export const DEFAULT_PENDING_LIMIT = 64

/** Default bound on the consumed-id set (the in-process replay window). */
export const DEFAULT_USED_LIMIT = 512

/** Domain-separation context for the derived signing key. */
export const KEY_INFO = 'dsh-mobile-remote/decision-link/v1'

/** HKDF salt; fixed because `info` carries the version. */
const KEY_SALT = 'dsh-mobile-remote'

/**
 * Normalize an untrusted decision word into the closed vocabulary.
 *
 * Exact match only: case variants (`Allow`), padded words (`allow `), empty
 * strings, non-strings and unknown words all fall back to `unavailable`. The
 * phone's answer travels through a link this plugin signed, so a word that is
 * not byte-exact is tampering or garbage — coercing it would be the one error
 * that approves a request nobody approved.
 *
 * @param value - the untrusted word.
 * @returns one of {@link DECISIONS}.
 */
export function normalizeDecision(value: unknown): Decision {
  if (typeof value !== 'string') return FALLBACK_DECISION
  return (DECISIONS as readonly string[]).includes(value) ? (value as Decision) : FALLBACK_DECISION
}

/** Bytes: a caller-supplied secret, or the text form of one. */
export type SecretMaterial = Uint8Array | string

/**
 * Derive the signing key from the caller's secret.
 *
 * Domain separation matters because the consumer will hand this module the same
 * `client-connection/browser-session` secret that signs browser cookies
 * (`docs/evidence/dsh-client-connection__lib__index.js:223`, `:266-283`): HKDF
 * with a distinct `info` guarantees a decision link can never be replayed as a
 * cookie, or the other way around. Rotating either the secret or
 * {@link KEY_INFO} invalidates every outstanding link (docs/17-decision-link.md
 * §3).
 *
 * @param secret - secret material, e.g. the 32-byte browser-session secret.
 * @returns a 32-byte HMAC key.
 * @throws when the secret is empty — an empty key would silently sign for
 * everyone, so it is refused loudly at construction time.
 */
export function decisionKey(secret: SecretMaterial): Buffer {
  const ikm = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret)
  if (ikm.byteLength === 0) throw new Error('decision: a non-empty signing secret is required')
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(KEY_SALT, 'utf8'), Buffer.from(KEY_INFO, 'utf8'), 32))
}

/** The signed payload of one decision link. */
export interface DecisionPayload {
  /** Payload schema version; must equal {@link TOKEN_VERSION} module-side constant. */
  version: number
  /** The decision id this link may decide. */
  id: string
  /** When the link stops being usable, as epoch milliseconds. */
  expiresAt: number
}

/** Why a token was refused. Closed set; each class has its own test. */
export type DecisionRejection =
  /** Not `v1.<body>.<signature>`, or a part is not decodable base64url. */
  | 'malformed'
  /** The MAC does not match, or the URL's id disagrees with the signed one. */
  | 'bad-signature'
  /** Well signed, but no such pending request (already pruned, or another process/secret). */
  | 'unknown'
  /** Already decided once: this is a replay. */
  | 'used'
  /** Past its expiry (at `now === expiresAt` it is already expired). */
  | 'expired'

/** Result of the state-free half of verification. */
export type SignatureVerdict =
  | { ok: true; payload: DecisionPayload }
  | { ok: false; code: 'malformed' | 'bad-signature' | 'expired' }

/** Result of a full verification against a store. */
export type DecisionVerdict =
  | { ok: true; id: string; expiresAt: number; pending: PendingDecision }
  | { ok: false; code: DecisionRejection }

/** One pending request awaiting a decision. */
export interface PendingDecision {
  /** The decision id; unguessable, minted per request. */
  id: string
  /** When the request was issued, epoch ms. */
  createdAt: number
  /** When the link stops being usable, epoch ms. */
  expiresAt: number
  /** Optional human summary for the push message / GUI. Never signed, never trusted. */
  summary?: string
  /** Optional subject (tool name, agent id, …). Never signed, never trusted. */
  subject?: string
}

/** Caller-supplied context for one issuance. */
export interface DecisionRequest {
  /** Human summary to carry alongside the pending row. */
  summary?: string
  /** Subject to carry alongside the pending row. */
  subject?: string
  /** Lifetime override in milliseconds. */
  ttlMs?: number
}

/** What {@link DecisionStore.issue} hands back: the two URL parameters plus display data. */
export interface IssuedDecision {
  /** The decision id, to be sent as `?d=<id>` (docs/00-contract.md §5 R2). */
  id: string
  /** The base64url token, to be sent as `?t=<token>`. */
  t: string
  /** Expiry of this link, epoch ms. */
  expiresAt: number
  /** The pending row, for the push message and the GUI list. */
  pending: PendingDecision
}

/** A URL's worth of a decision link: the id parameter and the token parameter. */
export interface DecisionLinkInput {
  /** The `?d=` value. */
  id: string
  /** The `?t=` value. */
  t: string
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

/** Strict base64url decode; returns undefined for anything that is not canonical. */
function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

/** HMAC over the encoded body string (the shipped idiom). */
function signatureOf(key: Buffer, body: string): Buffer {
  return createHmac('sha256', key).update(body).digest()
}

/**
 * Sign one payload into a token. Pure: the key is injected, the clock is not read.
 *
 * @param key - an {@link decisionKey} result.
 * @param payload - id + expiry (+ version).
 * @returns `v1.<body>.<signature>`.
 */
export function signDecision(key: Buffer, payload: DecisionPayload): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${TOKEN_VERSION}.${body}.${encodeBase64Url(signatureOf(key, body))}`
}

/** Whether a decoded payload has exactly the fields this module signs. */
function isDecisionPayload(value: unknown): value is DecisionPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record['version'] === 1 &&
    typeof record['id'] === 'string' &&
    record['id'].length > 0 &&
    Number.isSafeInteger(record['expiresAt'])
  )
}

/**
 * Verify a token without any state: format, MAC (constant time), and expiry.
 *
 * This half never touches a pending table, so t10 can call it on its own (for
 * example to reject garbage before consulting state). The MAC comparison uses
 * `timingSafeEqual` on equal-length buffers — the shipped credential code takes
 * the same care (`docs/evidence/dsh-client-connection__lib__index.js:279-283`,
 * `:312-313`).
 *
 * @param key - an {@link decisionKey} result.
 * @param token - the `?t=` value.
 * @param now - epoch ms; the caller owns the clock so boundaries are testable.
 * @param expectedId - when given, the URL's `?d=` value, which must equal the signed id.
 * @returns the payload, or the state-free rejection code.
 */
export function verifyDecisionSignature(
  key: Buffer,
  token: string,
  now: number,
  expectedId?: string,
): SignatureVerdict {
  if (typeof token !== 'string') return { ok: false, code: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, code: 'malformed' }
  const [version, body, encodedSignature] = parts as [string, string, string]
  if (version !== TOKEN_VERSION) return { ok: false, code: 'malformed' }

  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return { ok: false, code: 'malformed' }
  const expectedSignature = signatureOf(key, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength) return { ok: false, code: 'bad-signature' }
  if (!timingSafeEqual(actualSignature, expectedSignature)) return { ok: false, code: 'bad-signature' }

  const bodyBytes = decodeBase64Url(body)
  if (bodyBytes === undefined) return { ok: false, code: 'malformed' }

  let decoded: unknown
  try {
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return { ok: false, code: 'malformed' }
  }
  if (!isDecisionPayload(decoded)) return { ok: false, code: 'malformed' }

  // The signature proves the id inside the payload; the URL's own `?d=` must
  // agree with it, or this is a valid signature attached to another request.
  if (expectedId !== undefined && decoded.id !== expectedId) return { ok: false, code: 'bad-signature' }

  // `now === expiresAt` is already expired: a link is valid for `now < expiresAt`.
  if (now >= decoded.expiresAt) return { ok: false, code: 'expired' }

  return { ok: true, payload: decoded }
}

/** Options for {@link DecisionStore}. */
export interface DecisionStoreOptions {
  /** Signing secret; see {@link decisionKey}. Required, never hardcoded here. */
  secret: SecretMaterial
  /** Clock override, epoch ms. Defaults to `Date.now`. */
  now?: () => number
  /** Default link lifetime in milliseconds. */
  ttlMs?: number
  /** Bound on pending rows; the oldest is dropped beyond it. */
  pendingLimit?: number
  /** Bound on remembered consumed ids (the in-process replay window). */
  usedLimit?: number
}

/**
 * The pending table plus the one-time rule.
 *
 * State is process-local on purpose: a restart empties the table, and every
 * outstanding link then fails as `unknown` rather than being honoured — the
 * fail-closed direction. (This is why the module never persists capabilities.)
 */
export class DecisionStore {
  private readonly key: Buffer
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly pendingLimit: number
  private readonly usedLimit: number
  private readonly rows = new Map<string, PendingDecision>()
  private readonly used = new Set<string>()

  constructor(options: DecisionStoreOptions) {
    this.key = decisionKey(options.secret)
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.pendingLimit = options.pendingLimit ?? DEFAULT_PENDING_LIMIT
    this.usedLimit = options.usedLimit ?? DEFAULT_USED_LIMIT
  }

  /**
   * Mint one one-time link bound to a fresh id.
   *
   * @param request - optional display context and lifetime override.
   * @returns the id/token pair, its expiry, and the pending row.
   */
  issue(request: DecisionRequest = {}): IssuedDecision {
    const createdAt = this.now()
    const ttl = request.ttlMs ?? this.ttlMs
    if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('decision: ttlMs must be a positive integer')
    const expiresAt = createdAt + ttl
    const id = randomUUID()

    const pending: PendingDecision = { id, createdAt, expiresAt }
    if (request.summary !== undefined) pending.summary = request.summary
    if (request.subject !== undefined) pending.subject = request.subject

    // Expired rows must not consume the bound: prune before inserting, so the
    // eviction below only ever drops a row that is still live.
    this.prune(createdAt)
    this.rows.set(id, pending)
    while (this.rows.size > this.pendingLimit) {
      const oldest = this.rows.keys().next().value
      if (oldest === undefined) break
      this.rows.delete(oldest)
    }

    return { id, t: signDecision(this.key, { version: 1, id, expiresAt }), expiresAt, pending }
  }

  /**
   * Verify one link and, on success, consume it.
   *
   * Check order: format → signature → existence → replay → expiry (see the
   * module comment). Only a fully valid, unused, unexpired link consumes its id.
   *
   * @param input - the URL's `?d=` and `?t=` values.
   * @param nowOverride - epoch ms override for this call (tests, replay of a past decision).
   * @returns the verdict; `ok: true` means this call cast the decision.
   */
  verify(input: DecisionLinkInput, nowOverride?: number): DecisionVerdict {
    const now = nowOverride ?? this.now()

    if (typeof input !== 'object' || input === null) return { ok: false, code: 'malformed' }
    const { id, t } = input as Partial<DecisionLinkInput>
    if (typeof id !== 'string' || typeof t !== 'string' || id.length === 0 || t.length === 0) {
      return { ok: false, code: 'malformed' }
    }

    const signatureVerdict = verifyDecisionSignature(this.key, t, now, id)
    if (!signatureVerdict.ok) return { ok: false, code: signatureVerdict.code }

    // Replay before existence: consuming an id deletes its row, so the table
    // cannot answer "already used" — the bounded used-set must.
    if (this.used.has(id)) return { ok: false, code: 'used' }

    const pending = this.rows.get(id)
    if (pending === undefined) return { ok: false, code: 'unknown' }
    // The signed expiry is authoritative; a disagreement means the row and the
    // link were not minted together.
    if (pending.expiresAt !== signatureVerdict.payload.expiresAt) return { ok: false, code: 'bad-signature' }
    if (now >= pending.expiresAt) return { ok: false, code: 'expired' }

    this.markUsed(id)
    return { ok: true, id, expiresAt: pending.expiresAt, pending }
  }

  /** Remember a consumed id, keeping the replay window bounded. */
  private markUsed(id: string): void {
    this.rows.delete(id)
    this.used.add(id)
    while (this.used.size > this.usedLimit) {
      const oldest = this.used.values().next().value
      if (oldest === undefined) break
      this.used.delete(oldest)
    }
  }

  /** Pending rows, oldest first. */
  pending(): readonly PendingDecision[] {
    return [...this.rows.values()]
  }

  /** Whether an id has already been consumed (diagnostics only). */
  isUsed(id: string): boolean {
    return this.used.has(id)
  }

  /** Drop expired pending rows (an id decided never reaches here). */
  prune(nowOverride?: number): number {
    const now = nowOverride ?? this.now()
    let dropped = 0
    for (const [id, row] of [...this.rows]) {
      if (now >= row.expiresAt) {
        this.rows.delete(id)
        dropped += 1
      }
    }
    return dropped
  }
}

/** Outcome of turning a verification verdict plus a raw answer into a decision. */
export interface ResolvedDecision {
  /** True only when the link verified: this call cast the decision. */
  ok: boolean
  /** The decided request, when the link verified. */
  id?: string
  /** The word to hand the approval service; `unavailable` on every failure. */
  word: Decision
  /** `ok`, or the closed rejection class. */
  code: DecisionRejection | 'ok'
}

/**
 * Fail-closed composition of one verification verdict and one untrusted answer.
 *
 * This is the only place a wiring layer needs to call, and it encodes the rule
 * the task freezes: **a refusal can never carry anything but `unavailable`, and
 * an unrecognized answer is never a grant.** A verified link whose answer word is
 * garbage is still a decision — it resolves the request as `unavailable` (the
 * request is lost, nobody approved it) rather than being silently dropped.
 *
 * @param verdict - the store's answer for this link.
 * @param rawWord - the answer word as it arrived (query parameter, JSON body, …).
 * @returns the decision to report upstream.
 */
export function resolveDecision(verdict: DecisionVerdict, rawWord: unknown): ResolvedDecision {
  if (!verdict.ok) return { ok: false, word: FALLBACK_DECISION, code: verdict.code }
  return { ok: true, id: verdict.id, word: normalizeDecision(rawWord), code: 'ok' }
}
