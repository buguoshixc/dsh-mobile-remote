/**
 * Approval answering (P3): the `approval/request` waterfall listener, the pending
 * decision table, and the phone push hook.
 *
 * The one-time, id-bound, expiry-bound HMAC capability lives in `./decision.ts`
 * (t20); this module only gives it an approval lifecycle:
 *
 *   ask()    -> mint a pending row + a `?d=&t=` link, start a fail-closed timer
 *   answer() -> verify the link once, normalize the word, settle the waiter
 *   timeout  -> `unavailable` (never `allow`)
 *   listener -> handle only when eligible, otherwise `next()` straight through
 *
 * The closed vocabulary is `decision.ts`'s (`allow`/`deny`/`cancel`/
 * `unavailable`, anything else `unavailable`); `pushTopic` empty means the push
 * hook is absent, but the waiter still exists — the GUI answer path keeps working.
 *
 * @module dsh-mobile-remote/approval
 */

import {
  DecisionStore,
  FALLBACK_DECISION,
  resolveDecision,
  type Decision,
  type DecisionStoreOptions,
} from './decision.ts'

/** Audit/log event name for one approval trip. */
export const APPROVAL_EVENT = 'mobile-remote/approval'

/** Default decision-link lifetime; equals the contract's `approvalTimeoutMs`. */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000

/** One pending approval, as the phone/push/GUI surfaces it. */
export interface PendingApproval {
  id: string
  summary?: string
  subject?: string
  createdAt: number
  expiresAt: number
  /** Path a phone can open: `/mobile-remote/decide?d=<id>&t=<token>`. */
  decidePath: string
  /** The raw token, for the push payload only (never for logs/audit). */
  token: string
}

/** Outcome of one approval round. */
export interface ApprovalOutcome {
  id: string
  word: Decision
  code: 'ok' | 'timeout' | 'unavailable' | 'malformed' | 'bad-signature' | 'unknown' | 'used' | 'expired' | 'denied-unknown-id'
}

/** Options for {@link ApprovalService}. */
export interface ApprovalServiceOptions extends DecisionStoreOptions {
  /** Timeout in ms; `unavailable` when it elapses. */
  timeoutMs?: number
  /** Timer injection, for deterministic tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  /** Push hook; absent/undefined = push subsystem silently disabled. */
  push?: (pending: PendingApproval) => void | Promise<void>
  /** Audit sink for approval events (never carries the token). */
  onEvent?: (event: { id: string; result: string; word?: Decision }) => void
}

/** One in-flight approval. */
interface Waiter {
  pending: PendingApproval
  settle: (outcome: ApprovalOutcome) => void
  timer: unknown
}

/**
 * The approval lifecycle on top of the one-time decision capability.
 *
 * Fail-closed by construction: every exit path that is not a verified
 * `allow`/`deny`/`cancel` answer becomes `unavailable`.
 */
export class ApprovalService {
  private readonly store: DecisionStore
  private readonly timeoutMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly push?: (pending: PendingApproval) => void | Promise<void>
  private readonly onEvent: (event: { id: string; result: string; word?: Decision }) => void
  private readonly waiters = new Map<string, Waiter>()

  constructor(options: ApprovalServiceOptions) {
    this.store = new DecisionStore(options)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('approval: timeoutMs must be a positive integer')
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.push = options.push
    this.onEvent = options.onEvent ?? (() => {})
  }

  /** Whether a push channel exists at all. */
  get pushEnabled(): boolean { return typeof this.push === 'function' }

  /**
   * Open one approval: mint the capability, register the pending row, fire the
   * push hook (when configured), and return a promise that settles exactly once.
   */
  ask(request: { summary?: string; subject?: string } = {}): { pending: PendingApproval; wait: Promise<ApprovalOutcome> } {
    const issued = this.store.issue({ ...(request.summary === undefined ? {} : { summary: request.summary }), ...(request.subject === undefined ? {} : { subject: request.subject }) })
    const pending: PendingApproval = {
      id: issued.id,
      ...(issued.pending.summary === undefined ? {} : { summary: issued.pending.summary }),
      ...(issued.pending.subject === undefined ? {} : { subject: issued.pending.subject }),
      createdAt: issued.pending.createdAt,
      expiresAt: issued.expiresAt,
      decidePath: `/mobile-remote/decide?d=${encodeURIComponent(issued.id)}&t=${encodeURIComponent(issued.t)}`,
      token: issued.t,
    }
    const wait = new Promise<ApprovalOutcome>((resolve) => {
      const timer = this.setTimer(() => {
        this.waiters.delete(pending.id)
        this.onEvent({ id: pending.id, result: 'timeout', word: FALLBACK_DECISION })
        resolve({ id: pending.id, word: FALLBACK_DECISION, code: 'timeout' })
      }, this.timeoutMs)
      this.waiters.set(pending.id, { pending, settle: resolve, timer })
    })
    this.onEvent({ id: pending.id, result: 'pending' })
    if (this.push !== undefined) {
      try { void this.push(pending) } catch { this.onEvent({ id: pending.id, result: 'push-error' }) }
    }
    return { pending, wait }
  }

  /**
   * Cast one answer through a decision link.
   *
   * `id` and `token` come from the URL; `word` is the untrusted answer. The
   * capability is consumed on success (replay then fails as `used`), and any
   * refusal resolves as `unavailable` with the closed rejection code.
   */
  answer(input: { id?: string; t?: string; word?: unknown; now?: number }): ApprovalOutcome {
    const id = typeof input.id === 'string' ? input.id : ''
    const verdict = this.store.verify({ id, t: typeof input.t === 'string' ? input.t : '' }, input.now)
    const resolved = resolveDecision(verdict, input.word)
    const open = this.waiters.get(id)
    if (!resolved.ok) {
      this.onEvent({ id, result: resolved.code })
      const outcome: ApprovalOutcome = { id, word: FALLBACK_DECISION, code: resolved.code }
      if (open !== undefined && resolved.code === 'used') {
        // A replay must not settle a fresh approval twice; the first answer did.
      }
      return outcome
    }
    if (open === undefined) {
      this.onEvent({ id, result: 'denied-unknown-id' })
      return { id, word: FALLBACK_DECISION, code: 'denied-unknown-id' }
    }
    this.clearTimer(open.timer)
    this.waiters.delete(id)
    this.onEvent({ id, result: 'answered', word: resolved.word })
    open.settle({ id, word: resolved.word, code: 'ok' })
    return { id, word: resolved.word, code: 'ok' }
  }

  /** Drop a pending approval without an answer (request cancelled upstream). */
  cancel(id: string): boolean {
    const open = this.waiters.get(id)
    if (open === undefined) return false
    this.clearTimer(open.timer)
    this.waiters.delete(id)
    this.onEvent({ id, result: 'cancelled', word: 'cancel' })
    open.settle({ id, word: 'cancel', code: 'ok' })
    return true
  }

  /** Pending rows, oldest first (no tokens except in `token`). */
  pending(): readonly PendingApproval[] {
    return [...this.waiters.values()].map((waiter) => waiter.pending)
  }

  private clearTimer(timer: unknown): void {
    if (typeof timer === 'object' && timer !== null && typeof (timer as { unref?: unknown }).unref === 'function') {
      clearTimeout(timer as Parameters<typeof clearTimeout>[0])
    }
  }
}

/**
 * Build one `approval/request` waterfall listener.
 *
 * The listener returns `next()` for anything it does not own, so a later
 * responder (or the shipped policy) still gets its turn; when it does own the
 * request it pushes and awaits the decision, and a timeout is `unavailable`.
 */
export function approvalWaterfallListener(
  service: ApprovalService,
  options: {
    /** Whether this plugin should answer this request at all. */
    eligible?: (request: unknown) => boolean
    /** Map a request to the display context for the pending row. */
    describe?: (request: unknown) => { summary?: string; subject?: string }
  } = {},
): (request: unknown, next: () => unknown) => unknown {
  const eligible = options.eligible ?? (() => true)
  const describe = options.describe ?? (() => ({}))
  return (request: unknown, next: () => unknown) => {
    if (!eligible(request)) return next()
    const { wait } = service.ask(describe(request))
    return wait.then((outcome) => outcome.word)
  }
}
