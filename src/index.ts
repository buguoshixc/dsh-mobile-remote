/**
 * dsh-mobile-remote — host half.
 *
 * The plugin lets an Android phone reach this desktop DSH Web GUI over
 * Tailscale: it hands out the authenticated launch URL (no manual token
 * copying), serves the self-authenticated `/mobile-remote/*` routes the phone
 * talks to, pushes approvals, and keeps a device-level revocation audit.
 *
 * This file is assembly only (docs/00-contract.md §10): identity, dependencies,
 * the frozen config schema, and the wiring of the pieces —
 *
 * | module | responsibility |
 * |---|---|
 * | `config.ts` | the five frozen keys, their defaults, authority canonicalization |
 * | `pair.ts` | pairing ports, URL assembly, the frozen tool result shape |
 * | `routes.ts` | `/mobile-remote/pair` on the host webserver, with its own admission |
 * | `tools.ts` | the `mobile_pair_url` tool |
 * | `audit.ts` | structured records, source-address precedence, redaction |
 *
 * It also publishes the one setting the browser half cannot read for itself —
 * `mobileCss` — through the shipped structured index-injection table (see
 * {@link MOBILE_CSS_GLOBAL}).
 *
 * @module dsh-mobile-remote
 */

import type { Context } from '@deepseek-ai/cordis'

import { ApprovalService, type PendingApproval } from './approval.ts'
import { AuditLog, sanitizeError, truncateForDisplay } from './audit.ts'
import { Config, decisionTtlOf, resolveConfig, type MobileRemoteConfig } from './config.ts'
import { DeviceRegistry } from './device.ts'
import { SecondConfirmationGate } from './hardening.ts'
import { registerMobileRoutes } from './routes.ts'
import { registerPairTool } from './tools.ts'

/** Plugin display name; equals package.json `name` and the patch row's `name`. */
export const name = 'dsh-mobile-remote'

/**
 * Required services. Both are provided by the shipped Web composition
 * (`frontend-static` declares the same pair), and a plugin without them cannot
 * work at all — without `webServer` there is no route table to claim, and
 * without `connection` there is no admission fence and no launch URL.
 *
 * `tools` is deliberately NOT listed here: the tool registration is an optional
 * surface and goes through `ctx.inject(['tools'], …)` in `tools.ts`.
 */
export const inject: string[] = ['webServer', 'connection']

/**
 * Page global carrying this row's `mobileCss` switch.
 *
 * The browser half cannot read the host's composition config, so the host
 * publishes the one setting it needs through DSH's own structured index
 * injection table (docs/00-contract.md §3 freezes the key's *meaning*; the
 * transport is not contract-frozen and this is the shipped mechanism):
 *
 * - `@deepseek-ai/dsh-host-webserver` gathers rows via one
 *   `webserver/index-inject` emit per index response (`collectIndexInjections`),
 * - renders a `{ kind: 'global', name, value }` row as
 *   `<script>globalThis["<name>"] = <json></script>` in `<head>` — before any
 *   module script — and
 * - the page settles `__DSH_BOOT_READY__` before plugin factories run, so the
 *   client half reads this value synchronously inside its factory.
 *
 * The value is a real boolean (`{"mobileCss":true}`), which is exactly what the
 * consumer expects; the name is part of the frozen host↔client interface, so it
 * lives here as one exported constant rather than a literal in two files.
 */
export const MOBILE_CSS_GLOBAL = '__DSH_MOBILE_REMOTE__'

export { Config }
export type { MobileRemoteConfig }

/** Read one service off the live context without assuming it exists. */
function serviceLookup(ctx: Context): (serviceName: string) => unknown {
  const host = ctx as unknown as { get?: (serviceName: string) => unknown }
  if (typeof host.get !== 'function') return () => undefined
  return (serviceName: string) => host.get?.(serviceName)
}

/**
 * Publish this row's `mobileCss` switch to the page through the shipped
 * index-injection table.
 *
 * `ctx.on` is fiber-owned (cordis disposes the listener with this plugin), and
 * the table is rebuilt on every index response, so a reload replaces the row
 * instead of accumulating duplicates. The listener is deliberately tolerant: a
 * foreign or missing table must never break an index response for the whole GUI.
 *
 * @param ctx - the host plugin context.
 * @param config - the resolved composition config.
 */
function publishMobileCss(ctx: Context, config: MobileRemoteConfig): void {
  const host = ctx as unknown as {
    on?: (event: string, listener: (table: unknown) => void) => unknown
  }
  if (typeof host.on !== 'function') return
  host.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table)) return
    table.push({ kind: 'global', name: MOBILE_CSS_GLOBAL, value: { mobileCss: config.mobileCss } })
  })
}

/**
 * The shipped approval service's **closed outcome vocabulary**
 * (`dsh-user-approval` `decide()` normalizes anything else to `unavailable`).
 *
 * Our decision words are `allow/deny/cancel/unavailable`; the service only
 * accepts `allowed-once` (the sole grant), `rejected`, `cancelled`,
 * `unavailable`. The mapping is one-way and total: a word we do not recognise is
 * `unavailable`, never a grant.
 */
const SERVICE_OUTCOME: Record<string, string> = {
  allow: 'allowed-once',
  deny: 'rejected',
  cancel: 'cancelled',
  unavailable: 'unavailable',
}

/** Audit path for approval lifecycle events (no HTTP request behind them). */
const APPROVAL_EVENT_PATH = '/mobile-remote/approval'

/** The credential record holding the shipped browser-session secret. */
const AUTH_RECORD_KEY = 'client-connection/browser-session'

/** The host-half security kernel, once the credential secret was readable. */
interface SecurityKernel {
  devices: DeviceRegistry
  approval: ApprovalService
  gate: SecondConfirmationGate
}

/** Decode the 32-byte secret out of a credential record, without trusting it. */
function sessionSecretFrom(record: unknown): Uint8Array | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const payload = (record as { payload?: unknown }).payload
  const holder = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : record as Record<string, unknown>
  if (holder['version'] !== undefined && holder['version'] !== 1) return undefined
  const raw = holder['secret']
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const bytes = Buffer.from(raw.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  return bytes.byteLength > 0 ? bytes : undefined
}

/**
 * Read the browser-session secret from `ctx.credentials`.
 *
 * The read is deliberately conservative: the documented read-decide-replace
 * accessor is only tried with an updater that returns the **current** record, so
 * this plugin can never *create* the credential record it does not own. Any
 * failure (missing service, missing record, provider error) yields `undefined`
 * and the caller fails closed.
 *
 * @param credentials - the live credentials service.
 * @returns the secret bytes, or undefined when it cannot be read.
 */
async function loadCredentialSecret(credentials: unknown): Promise<Uint8Array | undefined> {
  const service = credentials as {
    readRecord?: (key: string) => Promise<unknown>
    getRecord?: (key: string) => Promise<unknown>
    modifyRecord?: (key: string, update: (current: unknown) => unknown) => Promise<unknown>
  }
  for (const name of ['readRecord', 'getRecord'] as const) {
    const reader = service?.[name]
    if (typeof reader !== 'function') continue
    try {
      const secret = sessionSecretFrom(await reader.call(service, AUTH_RECORD_KEY))
      if (secret !== undefined) return secret
    } catch {
      // fall through to the next accessor
    }
  }
  if (typeof service?.modifyRecord === 'function') {
    try {
      const record = await service.modifyRecord(AUTH_RECORD_KEY, (current) => current)
      return sessionSecretFrom(record)
    } catch {
      return undefined
    }
  }
  return undefined
}

/** The push request's title. **ASCII only** — see {@link asciiHeader}. */
const PUSH_TITLE = 'DSH approval'

/**
 * Map a header value onto a ByteString-safe ASCII string.
 *
 * t4's F1: `fetch` builds headers through undici, which requires a ByteString,
 * so `title: 'DSH 手机审批'` threw `TypeError: Cannot convert argument to a
 * ByteString …` *before any byte left the process*. The hook degraded it to one
 * warn line and every unit test stayed green while the phone received nothing.
 * Every header this module writes goes through here, and everything outside
 * `0x20–0x7e` is replaced (which also removes CR/LF, so a value can never smuggle
 * a second header). Human-readable, non-ASCII text belongs in the **body**.
 *
 * @param value - the intended value.
 * @param fallback - what to use when nothing printable is left.
 * @returns an ASCII-safe header value.
 */
function asciiHeader(value: string, fallback: string): string {
  const cleaned = value.replace(/[^\x20-\x7e]/g, '?')
  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * Topic names a public ntfy relay is likely to be guessed from (F3 / t29).
 */
const GUESSABLE_TOPICS = new Set(['test', 'dsh', 'demo', 'admin', 'phone', 'approval', 'approve', 'mobile', 'mobile-remote', 'ntfy'])

/**
 * Warn when the configured push topic looks guessable.
 *
 * F3 (t29): the push body carries a **one-time `allow` link**, so anyone who
 * knows or guesses the topic can read that link and approve the approval — the
 * topic name *is* a credential. Staying silent about that was the accident this
 * warning exists to prevent; it is a startup line, not only a documentation
 * note.
 *
 * @param pushTopic - the configured topic (name or URL).
 * @param logger - host logger.
 */
function reportPushTopicRisk(
  pushTopic: string,
  logger?: { info?: (message: string) => void; warn?: (message: unknown) => void },
): void {
  const topic = pushTopic.trim()
  if (topic === '' || /^https?:\/\//i.test(topic)) return
  const weak = topic.length < 16
    || GUESSABLE_TOPICS.has(topic.toLowerCase())
    || /^[a-z][a-z-]*$/i.test(topic)
  if (!weak) return
  logger?.warn?.(
    `[dsh-mobile-remote] ⚠ pushTopic "${truncateForDisplay(topic, 40)}" 看起来可猜：推送体含**一次性 allow 链接**，任何知道/猜到该主题的人都能读到它并直接批准审批 ⇒ 主题名等同凭据。请改用不可猜主题（建议 ≥32 位随机串），或改用需要凭据的端点（URL 里写 user:pass@，插件会转成 HTTP Basic 头）。见 docs/06-hardening-contract.md §1 H-2。`,
  )
}

/**
 * Build the push hook, or nothing when `pushTopic` is empty.
 *
 * The hook posts the decision link to an ntfy-compatible endpoint. The link
 * carries the one-time token by design — that is what the phone opens — so the
 * hook never logs the URL: a failure is reported through the shared sanitizer.
 *
 * @param options - topic, live authority and logger.
 * @returns the hook, or undefined when the subsystem is off.
 */
function createPushHook(options: {
  pushTopic: string
  authorityOf: () => string
  logger?: { info?: (message: string) => void; warn?: (message: unknown) => void }
}): (pending: PendingApproval) => Promise<void> {
  const topic = options.pushTopic.trim()
  let endpoint = /^https?:\/\//i.test(topic) ? topic : `https://ntfy.sh/${encodeURIComponent(topic)}`
  // A protected endpoint can carry its credentials in the URL's userinfo
  // (`https://user:pass@relay.example/topic`); ntfy and most relays accept HTTP
  // Basic. The header is base64 (ASCII by construction), so it stays
  // ByteString-safe like every other one — and the URL is never logged.
  let authorization: string | undefined
  try {
    const parsed = new URL(endpoint)
    if (parsed.username !== '' || parsed.password !== '') {
      authorization = `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`, 'utf8').toString('base64')}`
      parsed.username = ''
      parsed.password = ''
      endpoint = parsed.href
    }
  } catch {
    // Not URL-shaped: keep it verbatim and let `fetch` report the failure.
  }
  const headers: Record<string, string> = {
    'content-type': asciiHeader('text/plain; charset=utf-8', 'text/plain'),
    title: asciiHeader(PUSH_TITLE, 'DSH approval'),
    priority: asciiHeader('high', 'high'),
    tags: asciiHeader('iphone', 'iphone'),
    ...(authorization === undefined ? {} : { authorization: asciiHeader(authorization, 'Basic ') }),
  }
  return async (pending: PendingApproval): Promise<void> => {
    const authority = options.authorityOf()
    const link = authority === '' ? pending.decidePath : `https://${authority}${pending.decidePath}`
    const message = `${pending.summary ?? '审批请求'}\n${link}`
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers,
        body: message,
        signal: AbortSignal.timeout(5000),
      })
      options.logger?.info?.(`[dsh-mobile-remote] approval pushed (id=${pending.id})`)
    } catch (error) {
      // Never the URL and never the token: the shared sanitizer only.
      options.logger?.warn?.(`[dsh-mobile-remote] approval push failed: ${sanitizeError(error, 'push')}`)
    }
  }
}

/** The shape of one shipped `approval/request` payload this plugin can answer. */
interface ApprovalShape {
  toolName: string
  summary: string
  subject: string
}

/** Read an approval request without trusting its shape. */
function approvalShape(request: unknown): ApprovalShape | undefined {
  if (request === null || typeof request !== 'object') return undefined
  const record = request as { toolName?: unknown; reason?: unknown }
  const toolName = typeof record.toolName === 'string' && record.toolName.trim().length > 0 ? record.toolName.trim() : undefined
  if (toolName === undefined) return undefined
  const reason = typeof record.reason === 'string' && record.reason.trim().length > 0 ? record.reason.trim() : undefined
  return {
    toolName,
    summary: truncateForDisplay(reason ?? `工具调用需要审批：${toolName}`, 200),
    subject: toolName,
  }
}

/**
 * Register the `approval/request` responder.
 *
 * One waterfall listener: a request this plugin can describe opens a pending
 * decision (push + one-time link) and waits; **anything else is handed straight
 * to `next()`**, so a later responder — or the shipped policy — still gets its
 * turn. The answer is mapped into the service's closed vocabulary, and a timeout
 * arrives as `unavailable` (docs/06-hardening-contract.md §5).
 *
 * @param ctx - the plugin context (only `on` is read).
 * @param approval - the live approval service.
 * @param logger - host logger.
 */
function registerApprovalResponder(
  ctx: Context,
  approval: ApprovalService,
  logger?: { info?: (message: string) => void; warn?: (message: unknown) => void },
): void {
  const host = ctx as unknown as { on?: (event: string, listener: (request: unknown, next: () => unknown) => unknown) => unknown }
  if (typeof host.on !== 'function') return
  host.on('approval/request', (request: unknown, next: () => unknown): unknown => {
    const shape = approvalShape(request)
    if (shape === undefined) return next()
    const { wait } = approval.ask(shape)
    return wait.then((outcome) => SERVICE_OUTCOME[outcome.word] ?? 'unavailable')
  })
  logger?.info?.('[dsh-mobile-remote] approval responder registered on approval/request')
}

/**
 * Log the two deployment facts that decide whether phone approvals can work.
 *
 * `never` is not a detail: the shipped service returns `rejected` **before** the
 * `approval/request` waterfall (`dsh-user-approval` `decide()`), so with the
 * `never` policy this responder is never consulted. Saying so at mount is the
 * difference between "the feature is off" and "the feature silently does
 * nothing".
 *
 * @param ctx - the plugin context (only `get` is read).
 * @param logger - host logger.
 * @param pushConfigured - whether a push hook exists.
 */
function reportApprovalPolicy(
  ctx: Context,
  logger?: { info?: (message: string) => void; warn?: (message: unknown) => void },
  pushConfigured = false,
): void {
  if (!pushConfigured) {
    logger?.info?.('[dsh-mobile-remote] 审批推送未配置（pushTopic 为空）：推送子系统静默关闭，审批应答者仍工作，等待只在 GUI 内可见')
  }
  const service = (ctx as unknown as { get?: (name: string) => unknown }).get?.('approval') as { config?: { policy?: unknown } } | undefined
  const policy = service?.config?.policy
  const effective = policy !== null && typeof policy === 'object' && typeof (policy as { get?: unknown }).get === 'function'
    ? (policy as { get: () => unknown }).get()
    : policy
  if (effective === 'never') {
    logger?.warn?.('[dsh-mobile-remote] ⚠ 审批策略为 never：never 在 approval/request waterfall 之前短路，手机审批永远不会被询问。改回 ask 见 docs/06-hardening-contract.md §1')
  } else if (typeof effective === 'string') {
    logger?.info?.(`[dsh-mobile-remote] approval policy = ${effective}`)
  }
}

/**
 * Install the P3/P4 security kernel once the credential secret is readable.
 *
 * The secret is read from `ctx.credentials` (`client-connection/browser-session`,
 * 32 bytes) and is **never** hardcoded; rotation is "rotate the credential
 * record and reload the plugin" (docs/06-hardening-contract.md §2). While the
 * secret is unreadable the kernel stays absent and every P3/P4 surface fails
 * closed, which is the only safe direction.
 *
 * @param ctx - the plugin context.
 * @param config - the resolved composition config.
 * @param getService - service lookup.
 * @param logger - host logger.
 * @param audit - audit sink for approval lifecycle events.
 * @returns a getter for the live kernel (undefined until installed).
 */
function installSecurityLayer(
  ctx: Context,
  config: MobileRemoteConfig,
  getService: (name: string) => unknown,
  logger: { info?: (message: string) => void; warn?: (message: unknown) => void } | undefined,
  audit: AuditLog,
): () => SecurityKernel | undefined {
  const holder: { kernel?: SecurityKernel; reason?: string; installing?: boolean } = {}

  const attempt = (credentials: unknown): void => {
    if (holder.kernel !== undefined || holder.reason !== undefined || holder.installing === true || credentials === undefined) return
    // The live lookup and the `inject` callback can both arrive before the
    // asynchronous read settles: claim the slot first so exactly one kernel
    // (and exactly one waterfall responder) is ever created.
    holder.installing = true
    void loadCredentialSecret(credentials).then((secret) => {
      if (secret === undefined) {
        holder.installing = false
        holder.reason = 'credentials-unavailable'
        logger?.warn?.('[dsh-mobile-remote] P3/P4 加固层未启用：读不到 client-connection/browser-session 的 32 字节 secret（决策链接 / 设备凭据 / 审批应答者一律 fail-closed）')
        return
      }
      const devices = new DeviceRegistry({
        secret,
        ttlMs: config.deviceGrantTtlMs,
        limit: config.deviceTableLimit,
      })
      const push = config.pushTopic.trim() === ''
        ? undefined
        : createPushHook({ pushTopic: config.pushTopic, authorityOf: () => config.pairingAuthority, ...(logger === undefined ? {} : { logger }) })
      if (push !== undefined) reportPushTopicRisk(config.pushTopic, logger)
      const approval = new ApprovalService({
        secret,
        ttlMs: decisionTtlOf(config),
        timeoutMs: config.approvalTimeoutMs,
        pendingLimit: config.pendingLimit,
        usedLimit: config.usedLimit,
        ...(push === undefined ? {} : { push }),
        onEvent: (event) => {
          audit.record({
            method: 'EVENT',
            path: APPROVAL_EVENT_PATH,
            result: event.result,
            source: 'internal',
            ...(event.word === undefined ? {} : { detail: `decision=${event.word}` }),
          })
        },
      })
      holder.kernel = { devices, approval, gate: new SecondConfirmationGate(approval) }
      logger?.info?.(`[dsh-mobile-remote] security ready (decisionTtlMs=${decisionTtlOf(config)}, deviceGrantTtlMs=${config.deviceGrantTtlMs}, push=${push === undefined ? 'off' : 'configured'})`)
      registerApprovalResponder(ctx, approval, logger)
      reportApprovalPolicy(ctx, logger, push !== undefined)
    }, () => {
      holder.installing = false
      holder.reason = 'credentials-error'
      logger?.warn?.('[dsh-mobile-remote] P3/P4 加固层未启用：读取凭据记录时抛错')
    }).catch((error: unknown) => {
      // A throw inside the *fulfilment* handler lands here, never in the
      // rejection handler above: `.then(onOk, onErr)` routes only this promise's
      // own rejection to `onErr`, while a throw in `onOk` rejects the promise the
      // `.then` returned — which `void` discarded. A config the schema accepts but
      // the kernel rejects (`approvalTimeoutMs: 0`, `deviceGrantTtlMs: 0`) was
      // therefore an unhandled rejection: no response, no log, and P3/P4 dead for
      // the whole session (t33). `resolveConfig` now screens those values too; this
      // catch is what keeps any *other* throw from escaping.
      holder.installing = false
      holder.reason = 'kernel-install-failed'
      logger?.warn?.(`[dsh-mobile-remote] P3/P4 加固层未启用：安装安全内核时抛错（${sanitizeError(error, 'kernel')}）`)
    })
  }

  const live = getService('credentials')
  if (live !== undefined) attempt(live)
  const host = ctx as unknown as { inject?: (services: string[], callback: (scoped: unknown) => void) => unknown }
  if (typeof host.inject === 'function') {
    host.inject(['credentials'], (scoped) => {
      attempt((scoped as { credentials?: unknown } | null | undefined)?.credentials)
    })
  }
  return () => holder.kernel
}

/**
 * Mount the plugin.
 *
 * Every resource the plugin acquires is registered through one `ctx.effect`, so
 * a profile recomposition (dsh-hmr recomposes the tree in place) disposes the
 * route and the tool instead of leaving a stale registration behind — the
 * webserver answers `duplicate exact route` for a second registration on the
 * same path, which is exactly the failure a reload must not produce.
 *
 * @param ctx - the host plugin context.
 * @param config - the composition layer's config for this entry.
 */
export function apply(ctx: Context, config: MobileRemoteConfig): void {
  const resolved = resolveConfig(config)
  const getService = serviceLookup(ctx)
  const logger = (ctx as unknown as {
    logger?: { info?: (message: string) => void; warn?: (message: unknown) => void }
  }).logger
  const audit = new AuditLog({
    enabled: resolved.auditLog,
    sink: (line) => logger?.info?.(line),
  })
  const securityOf = installSecurityLayer(ctx, resolved, getService, logger, audit)

  ctx.effect(() => {
    const disposeRoutes = registerMobileRoutes(ctx, {
      configOf: () => resolved,
      getService,
      audit,
      approvalOf: () => securityOf()?.approval,
      devicesOf: () => securityOf()?.devices,
      gateOf: () => securityOf()?.gate,
    })
    registerPairTool(ctx, {
      configOf: () => resolved,
      getService,
      runtimeOf: () => getService('webRuntime'),
    })
    return () => {
      disposeRoutes()
    }
  }, 'dsh-mobile-remote: lifetime')

  // The page-facing switch: `mobileCss` is the one setting the browser half
  // cannot discover by itself, and `false` must mean "not one <style> node".
  publishMobileCss(ctx, resolved)

  // Through `ctx.logger` (never `console`): the banner is a host-side log line,
  // and T-4's discipline is that a plugin writes where the composition can route
  // it. The authority is bounded and summarised — a pathological 64 KiB value
  // must not become a 65,584-character log line (review F5). It is truncated
  // rather than run through `redact`: a value-redacting pass would swallow any
  // ≥32-character authority whole, hiding the one thing this line exists to show.
  logger?.info?.(
    `dsh-mobile-remote mounted (pairingAuthority=${resolved.pairingAuthority === '' ? '<unset>' : truncateForDisplay(resolved.pairingAuthority, 80)}, auditLog=${resolved.auditLog}, mobileCss=${resolved.mobileCss})`,
  )
}
