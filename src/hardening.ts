/**
 * Hardening (P4): remote-source classification, the dangerous-prefix
 * second-confirmation gate, and the request-body cap.
 *
 * Three rules, all frozen in `docs/06-hardening-contract.md`:
 *
 *  1. **Where a request came from** is decided by {@link classifySource}, which
 *     consumes the audit module's `sourceFacts()` and never re-derives an
 *     address. It implements the T9 gate frozen in
 *     `docs/00-contract.md` 搂7.0.2 `CHANGE-t21-C`: `source` may be treated as
 *     the real remote client **only** when `viaForwarded` is true *and* the
 *     socket peer is the loopback the reverse proxy owns. Any inconsistency
 *     (`source` claims loopback while the kernel saw a routable peer, or no
 *     socket peer at all) fails safe **as remote** 鈥?a hardening decision may
 *     never take a client-supplied header's word for it.
 *  2. **Dangerous calls need a second pair of eyes**: a tool name under
 *     {@link DEFAULT_RISKY_PREFIXES} called from a remote source must be
 *     confirmed out-of-band. {@link SecondConfirmationGate} implements that by
 *     opening a normal approval round (so the phone push and the one-time
 *     decision link are the same machinery) and consuming the approval exactly
 *     once.
 *  3. **Bodies are capped** ({@link readLimitedBody}): a JSON route reads at most
 *     `maxBodyBytes` and answers 413 beyond it, instead of growing the process
 *     heap on request.
 *
 * @module dsh-mobile-remote/hardening
 */

import type { ApprovalOutcome, ApprovalService, PendingApproval } from './approval.ts'
import { headerValue, type AuditHeaderBag, type SourceFacts } from './audit.ts'

/** The prefixes frozen by `docs/06-hardening-contract.md` 搂4. */
export const DEFAULT_RISKY_PREFIXES: readonly string[] = ['terminal.', 'credentials.', 'pluginManager.']

/** Header a remote caller uses to present its redeemed confirmation id. */
export const SECOND_CONFIRMATION_HEADER = 'x-dsmr-confirm'

/**
 * Whether an address is the loopback.
 *
 * Accepts the shapes Node actually reports (`127.0.0.1`, `::1`) plus the
 * IPv4-mapped form (`::ffff:127.0.0.1`) and the `localhost` literal.
 *
 * @param value - a normalized address from `sourceFacts()`.
 * @returns true for loopback forms only.
 */
export function isLoopbackAddress(value: string): boolean {
  const bare = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  if (bare === 'localhost' || bare === '::1') return true
  const v4 = bare.startsWith('::ffff:') ? bare.slice('::ffff:'.length) : bare
  const parts = v4.split('.')
  if (parts.length !== 4 || parts[0] !== '127') return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** How the source address was established. */
export type SourceBasis =
  | 'proxied'
  | 'loopback'
  | 'direct'
  | 'inconsistent'

/** The classified source of one request. */
export interface SourceClass extends SourceFacts {
  /** Which of the four cases this request is. */
  basis: SourceBasis
  /** Whether the request must be treated as coming from another host. */
  remote: boolean
  /** False when the two source halves disagree (then `remote` is fail-safe). */
  trusted: boolean
}

/**
 * Classify one request's source under the frozen gate.
 *
 * @param facts - the output of `sourceFacts()` for this request.
 * @returns the classification, with `remote` already fail-safed.
 */
export function classifySource(facts: SourceFacts, headers?: AuditHeaderBag | undefined): SourceClass {
  const socketPeer = typeof facts.socketPeer === 'string' ? facts.socketPeer : 'unknown'
  const source = typeof facts.source === 'string' && facts.source.length > 0 ? facts.source : 'unknown'
  const base: SourceFacts = { source, socketPeer, viaForwarded: facts.viaForwarded === true }

  if (socketPeer === 'unknown') {
    // No kernel evidence at all: nothing may be trusted, so treat it as remote.
    return { ...base, basis: 'inconsistent', remote: true, trusted: false }
  }
  const socketLoopback = isLoopbackAddress(socketPeer)
  const sourceLoopback = isLoopbackAddress(source)

  if (!socketLoopback) {
    // A direct connection: the peer is the source, unless the two disagree.
    if (sourceLoopback) return { ...base, basis: 'inconsistent', remote: true, trusted: false }
    return { ...base, basis: 'direct', remote: true, trusted: true }
  }
  if (base.viaForwarded) {
    // **F1 (t29) 鈥?a forwarded request is remote, period.**
    //
    // The previous reading took the *leftmost* XFF entry as the client and then
    // asked "is that a loopback?", which let a client that writes its own
    // `X-Forwarded-For: 127.0.0.1` be classified as local whenever the proxy
    // appends rather than replaces (t14 measured the bypasses). Loopback-shaped
    // spellings are unbounded 鈥?distance forms, IPv6 forms, whitespace 鈥?so the
    // allow-list can never keep up. The safe rule is the contract's own
    // principle (`docs/00-contract.md` 搂7.0.2, `CHANGE-t21-C`, extended by
    // `CHANGE-t29-A`): if a forwarding header is what named the client, the
    // request is remote. A local operator hits 127.0.0.1 **without** XFF, so
    // this costs no legitimate local access.
    return { ...base, basis: 'proxied', remote: true, trusted: true }
  }
  // Proxies that set only `Forwarded:` (RFC 7239) and no XFF: no address to
  // attribute, but the shape is still a forwarded request 鈥?never local.
  const forwarded = headerValue(headers, 'forwarded')
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return { ...base, basis: 'proxied', remote: true, trusted: false }
  }
  return { ...base, basis: 'loopback', remote: false, trusted: true }
}

/**
 * Whether a tool name is under one of the dangerous prefixes.
 *
 * @param name - the tool name (untrusted).
 * @param prefixes - the configured prefixes.
 * @returns true when the name starts with one of them.
 */
export function isRiskyToolName(name: unknown, prefixes: readonly string[]): boolean {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (trimmed.length === 0) return false
  return prefixes.some((prefix) => typeof prefix === 'string' && prefix.length > 0 && trimmed.startsWith(prefix))
}

/** Why (not) a call needs a second confirmation. */
export interface ConfirmationRequirement {
  required: boolean
  reason: 'not-required' | 'disabled' | 'local' | 'remote-risky'
}

/**
 * Decide whether one call needs a second confirmation.
 *
 * @param input - the tool name, the classified source, the switch and prefixes.
 * @returns whether confirmation is required and the stable reason.
 */
export function confirmationRequirement(input: {
  toolName: unknown
  source: SourceClass
  enabled: boolean
  prefixes: readonly string[]
}): ConfirmationRequirement {
  if (!input.enabled) return { required: false, reason: 'disabled' }
  if (!isRiskyToolName(input.toolName, input.prefixes)) return { required: false, reason: 'not-required' }
  if (!input.source.remote) return { required: false, reason: 'local' }
  return { required: true, reason: 'remote-risky' }
}

/** What one body read produced. */
export type BodyRead = { ok: true; text: string } | { ok: false; code: 'too-large' | 'error' }

/**
 * Read a request body, refusing anything over the cap.
 *
 * The cap is checked *while* reading, so an oversized body is never buffered
 * whole. A body already materialized by the host (`req.body` as a string) is
 * judged by its length alone.
 *
 * @param req - the request (node `IncomingMessage`-shaped, or a test stub).
 * @param limit - maximum accepted bytes.
 * @returns the text, or the stable failure code.
 */
export async function readLimitedBody(req: unknown, limit: number): Promise<BodyRead> {
  const bound = Number.isSafeInteger(limit) && limit > 0 ? limit : 65536
  const record = (req ?? {}) as { body?: unknown; [Symbol.asyncIterator]?: unknown }

  if (typeof record.body === 'string') {
    return record.body.length > bound ? { ok: false, code: 'too-large' } : { ok: true, text: record.body }
  }
  if (typeof record[Symbol.asyncIterator] !== 'function') {
    // No body stream at all (GET-shaped stub): an empty body is a valid body.
    return { ok: true, text: '' }
  }
  const chunks: string[] = []
  let total = 0
  try {
    for await (const chunk of record as AsyncIterable<unknown>) {
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      total += Buffer.byteLength(text, 'utf8')
      if (total > bound) return { ok: false, code: 'too-large' }
      chunks.push(text)
    }
  } catch {
    return { ok: false, code: 'error' }
  }
  return { ok: true, text: chunks.join('') }
}

/** One confirmation round the gate opened. */
export interface ConfirmationRound {
  /** The approval id (also what the caller presents back). */
  id: string
  /** The phone-facing pending row. */
  pending: PendingApproval
  /** Resolves true only for an `allow` answer. */
  wait: Promise<boolean>
}

/** Default minimum interval between confirmation rounds; `0` = no time bound. */
export const DEFAULT_CONFIRMATION_COOLDOWN_MS = 0

/**
 * Default ceiling on live pending rounds the gate will add to (F5 / t29).
 *
 * The bound is *pressure*-based, not time-based: while the approval service
 * already holds this many pending rows, the gate refuses to mint another, so a
 * remote flood cannot walk the pending table toward its eviction edge (where
 * the oldest row 鈥?possibly a legitimate one 鈥?gets dropped). Distinct,
 * answered-in-sequence requests are unaffected, which a wall-clock cooldown
 * would have throttled with no security gain.
 */
export const DEFAULT_MAX_PENDING_ROUNDS = 32

/** Options for {@link SecondConfirmationGate}. */
export interface SecondConfirmationGateOptions {
  /** Minimum ms between two rounds; `0` (default) disables the time bound. */
  cooldownMs?: number
  /** Refuse to mint while this many rounds are already pending. */
  maxPendingRounds?: number
  /** Clock override, epoch ms. */
  now?: () => number
}

/**
 * The out-of-band second confirmation.
 *
 * A confirmation is an ordinary approval round (`ApprovalService.ask`), so it
 * rides the same pending table, phone push and one-time decision link as every
 * other approval. It is then **consumed exactly once**: a redeemed id cannot
 * authorize a second action, and an answer other than `allow` never approves.
 *
 * F5 (t29): rounds are rate-bounded. `request()` returns `undefined` while the
 * cooldown is in force, so a remote flood cannot mint an unbounded number of
 * pending rows and evict legitimate ones; the route answers 403 without opening
 * a new round.
 */
export class SecondConfirmationGate {
  private readonly service: ApprovalService
  private readonly cooldownMs: number
  private readonly maxPendingRounds: number
  private readonly now: () => number
  private readonly states = new Map<string, 'pending' | 'approved' | 'refused'>()
  private lastRoundAt = Number.NEGATIVE_INFINITY
  private throttled = 0

  constructor(service: ApprovalService, options: SecondConfirmationGateOptions = {}) {
    this.service = service
    this.cooldownMs = options.cooldownMs ?? DEFAULT_CONFIRMATION_COOLDOWN_MS
    this.maxPendingRounds = options.maxPendingRounds ?? DEFAULT_MAX_PENDING_ROUNDS
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Open one confirmation round for a dangerous call.
   *
   * Refuses (returns `undefined`) while either bound is in force: the optional
   * time cooldown, or the pending-pressure ceiling (F5 鈥?a flood must not walk
   * the approval table toward its eviction edge).
   *
   * @param action - the dangerous action being confirmed.
   * @returns the round, or `undefined` when a bound is in force.
   */
  request(action: { toolName: string; summary?: string }): ConfirmationRound | undefined {
    const at = this.now()
    if (this.cooldownMs > 0 && at - this.lastRoundAt < this.cooldownMs) {
      this.throttled += 1
      return undefined
    }
    if (this.service.pending().length >= this.maxPendingRounds) {
      this.throttled += 1
      return undefined
    }
    this.lastRoundAt = at
    const summary = action.summary ?? `鍗遍櫓璋冪敤闇€瑕佷簩娆＄‘璁わ細${action.toolName}`
    const { pending, wait } = this.service.ask({ summary, subject: action.toolName })
    this.states.set(pending.id, 'pending')
    const guard = wait.then(
      (outcome: ApprovalOutcome) => {
        const approved = outcome.word === 'allow' && outcome.code === 'ok'
        this.states.set(pending.id, approved ? 'approved' : 'refused')
        return approved
      },
      () => {
        this.states.set(pending.id, 'refused')
        return false
      },
    )
    return { id: pending.id, pending, wait: guard }
  }

  /** Whether an id has been approved and not yet consumed. */
  isApproved(id: string): boolean {
    return this.states.get(id) === 'approved'
  }

  /** Consume one approval; true at most once per id. */
  consume(id: string): boolean {
    if (this.states.get(id) !== 'approved') return false
    this.states.delete(id)
    return true
  }

  /** Live rounds (for diagnostics and the state route). */
  openRounds(): number {
    return [...this.states.values()].filter((state) => state === 'pending').length
  }

  /** How many requests were refused by the cooldown (diagnostics). */
  throttledCount(): number {
    return this.throttled
  }
}
