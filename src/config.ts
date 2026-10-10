/**
 * Composition config: the five frozen keys plus the pure value helpers the rest
 * of the host half shares.
 *
 * Frozen by docs/00-contract.md §3 — key names, types and defaults are part of
 * the interface contract, not an implementation detail. `Config` must stay a
 * *native* schemastery schema (`Symbol.for("schemastery")`), or the launcher's
 * startup audit reports the plugin row as `unsupported`.
 *
 * Everything here is pure so it can be exercised without a cordis context; the
 * only reason `resolveConfig` exists is that a composed row's config arrives as
 * plain values in one DSH line and as reactive per-field accessors in another.
 *
 * @module dsh-mobile-remote/config
 */

import Schema from '@deepseek-ai/schemastery'

/**
 * The five frozen composition keys (docs/00-contract.md §3).
 *
 * Values are user configuration written literally in the profile's patch file,
 * never expressions, and every key carries a safe default — so the row may mount
 * with `config: {}` (which is exactly what this package's cordis.patch.yml ships).
 */
export interface MobileRemoteConfig {
  /**
   * Bare authority the phone uses to reach this GUI, e.g.
   * `demo.tailnet-example.ts.net` (`host` or `host:port`, no scheme, no path).
   * Empty string switches pairing off entirely: the tool answers a readable
   * "not configured" result and `/mobile-remote/pair` answers 503.
   */
  pairingAuthority: string
  /** Master switch for the narrow-screen CSS the client half injects. */
  mobileCss: boolean
  /**
   * Approval-push target (ntfy topic/URL). Empty string keeps the push
   * subsystem silent; approvals are still answered inside the GUI.
   */
  pushTopic: string
  /**
   * Upper bound on how long an approval waits, in milliseconds. A timeout is
   * always `unavailable` (fail closed) — never an implicit allow.
   */
  approvalTimeoutMs: number
  /** Master switch for the `/mobile-remote/*` audit trail. */
  auditLog: boolean
  /**
   * Bound on the device table (P4). The table is **process-local** — no file is
   * written anywhere — so this is a size bound, not a location
   * (docs/06-hardening-contract.md §3).
   */
  deviceTableLimit: number
  /** Default device-grant lifetime in ms; 30 days, matching the shipped cookie. */
  deviceGrantTtlMs: number
  /** Decision-link lifetime in ms; defaults to `approvalTimeoutMs`. */
  decisionTtlMs: number
  /** Bound on live pending decision rows (oldest is dropped beyond it). */
  pendingLimit: number
  /** Bound on remembered consumed decision ids — the in-process replay window. */
  usedLimit: number
  /** Request-body cap in bytes for every JSON route this plugin serves. */
  maxBodyBytes: number
  /**
   * Tool-name prefixes whose calls from a **remote** source need a second
   * confirmation (P4). Compared with `startsWith`, case-sensitively.
   */
  riskyToolPrefixes: string[]
  /** Master switch for the remote second-confirmation gate. */
  requireSecondConfirmation: boolean
}

/** Schemastery schema for this plugin's composition config. */
export const Config: Schema<MobileRemoteConfig> = Schema.object({
  pairingAuthority: Schema.string()
    .default('')
    .description('手机侧访问用的裸 authority（host 或 host:port，无 scheme、无路径）；空串 = 配对功能关闭'),
  mobileCss: Schema.boolean().default(true).description('窄屏 CSS 总开关；false 时客户端零注入'),
  pushTopic: Schema.string().default('').description('审批推送目标（ntfy 主题/URL）；空串 = 推送子系统静默关闭'),
  approvalTimeoutMs: Schema.natural().default(120000).description('审批等待上限（毫秒）；超时一律 unavailable（fail closed）'),
  auditLog: Schema.boolean().default(true).description('审计总开关；true 时每次命中与拒绝都写一条结构化记录'),
  deviceTableLimit: Schema.natural().default(32).description('设备表上限（进程内存表，不落盘）'),
  deviceGrantTtlMs: Schema.natural().default(2592000000).description('设备凭据默认有效期（毫秒，30 天）'),
  decisionTtlMs: Schema.natural().default(0).description('决策链接有效期（毫秒）；0 = 跟随 approvalTimeoutMs'),
  pendingLimit: Schema.natural().default(64).description('待决决策表上限（超出丢最旧）'),
  usedLimit: Schema.natural().default(512).description('已消费决策 id 的记忆上限（进程内重放窗口）'),
  maxBodyBytes: Schema.natural().default(65536).description('JSON 路由请求体上限（字节）；超过即 413'),
  riskyToolPrefixes: Schema.array(Schema.string())
    .default(['terminal.', 'credentials.', 'pluginManager.'])
    .description('需要二次确认的危险工具名前缀（仅对远程来源生效）'),
  requireSecondConfirmation: Schema.boolean().default(true).description('远程来源危险调用二次确认总开关'),
})

/** The defaults this plugin guarantees when a key is absent. */
export const CONFIG_DEFAULTS: MobileRemoteConfig = {
  pairingAuthority: '',
  mobileCss: true,
  pushTopic: '',
  approvalTimeoutMs: 120000,
  auditLog: true,
  deviceTableLimit: 32,
  deviceGrantTtlMs: 2592000000,
  decisionTtlMs: 0,
  pendingLimit: 64,
  usedLimit: 512,
  maxBodyBytes: 65536,
  riskyToolPrefixes: ['terminal.', 'credentials.', 'pluginManager.'],
  requireSecondConfirmation: true,
}

/**
 * Keep only usable prefixes, falling back to the frozen defaults.
 *
 * The fallback is load-bearing, not cosmetic: filtering an unusable value down
 * to `[]` used to **disable** the second-confirmation gate silently — writing
 * `riskyToolPrefixes: 'terminal.'` (a string, not a list) switched the
 * protection off with no diagnostic at all (t33). An empty result therefore
 * falls back to the frozen defaults; deliberately switching the gate off is what
 * `requireSecondConfirmation: false` is for.
 *
 * @param value - the raw config field, in whatever shape it arrived.
 * @returns a non-empty prefix list.
 */
function usablePrefixes(value: unknown): string[] {
  const kept = (Array.isArray(value) ? value : []).filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  )
  return kept.length > 0 ? kept : [...CONFIG_DEFAULTS.riskyToolPrefixes]
}

/**
 * Coerce a config field that must be a **positive** safe integer.
 *
 * `Schema.natural()` is `.min(0)`, so `0` is a *legal* schema value that the
 * kernel constructors reject: `new ApprovalService({timeoutMs: 0})` and
 * `DeviceRegistry.register` both throw on a non-positive bound. A profile writing
 * `approvalTimeoutMs: 0` therefore took down kernel installation instead of
 * producing the readable refusal this module promises (t33). Anything unusable
 * falls back to the frozen default, which is also the fail-closed direction: both
 * defaults are the most patient values the plugin ships.
 *
 * @param value - the raw field, after the accessor/plain-value resolution.
 * @param fallback - the frozen default for this key.
 * @returns a positive safe integer.
 */
function positiveOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/**
 * Read one config field that may arrive as a plain value or as a reactive
 * accessor (`config.field.get()` in the 0.2 line). An unreadable accessor falls
 * back rather than throwing, because a broken config projection must not take
 * the plugin down.
 *
 * @param value - the raw field value off the config object.
 * @param fallback - what to use when the field is absent or unreadable.
 * @returns the resolved value.
 */
export function fieldOf<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    try {
      const live = (value as { get: () => unknown }).get()
      return (live === undefined ? fallback : live) as T
    } catch {
      return fallback
    }
  }
  return (value === undefined ? fallback : value) as T
}

/**
 * Resolve the composed config into plain values.
 *
 * @param raw - whatever the loader handed `apply` (plain object or accessors).
 * @returns the five keys, each defaulted.
 */
export function resolveConfig(raw: unknown): MobileRemoteConfig {
  const source = (raw ?? {}) as Record<string, unknown>
  const prefixes = fieldOf(source['riskyToolPrefixes'], CONFIG_DEFAULTS.riskyToolPrefixes)
  return {
    pairingAuthority: fieldOf(source['pairingAuthority'], CONFIG_DEFAULTS.pairingAuthority),
    mobileCss: fieldOf(source['mobileCss'], CONFIG_DEFAULTS.mobileCss),
    pushTopic: fieldOf(source['pushTopic'], CONFIG_DEFAULTS.pushTopic),
    approvalTimeoutMs: positiveOf(fieldOf(source['approvalTimeoutMs'], CONFIG_DEFAULTS.approvalTimeoutMs), CONFIG_DEFAULTS.approvalTimeoutMs),
    auditLog: fieldOf(source['auditLog'], CONFIG_DEFAULTS.auditLog),
    deviceTableLimit: fieldOf(source['deviceTableLimit'], CONFIG_DEFAULTS.deviceTableLimit),
    deviceGrantTtlMs: positiveOf(fieldOf(source['deviceGrantTtlMs'], CONFIG_DEFAULTS.deviceGrantTtlMs), CONFIG_DEFAULTS.deviceGrantTtlMs),
    decisionTtlMs: fieldOf(source['decisionTtlMs'], CONFIG_DEFAULTS.decisionTtlMs),
    pendingLimit: fieldOf(source['pendingLimit'], CONFIG_DEFAULTS.pendingLimit),
    usedLimit: fieldOf(source['usedLimit'], CONFIG_DEFAULTS.usedLimit),
    maxBodyBytes: fieldOf(source['maxBodyBytes'], CONFIG_DEFAULTS.maxBodyBytes),
    // A non-array (or array holding non-strings) must not widen the gate, and an
    // empty result must not switch it off either — see `usablePrefixes`.
    riskyToolPrefixes: usablePrefixes(prefixes),
    requireSecondConfirmation: fieldOf(source['requireSecondConfirmation'], CONFIG_DEFAULTS.requireSecondConfirmation),
  }
}

/**
 * The decision-link lifetime actually in force: `decisionTtlMs` when set, else
 * the approval timeout — never longer than the wait it decides.
 *
 * The bound is the point of this function, not a detail: a configured
 * `decisionTtlMs` larger than `approvalTimeoutMs` used to be returned verbatim,
 * so a link outlived its own round and a tap after the timeout hit
 * `denied-unknown-id` — a live-looking link answering 403 against a round that no
 * longer existed (t33).
 *
 * @param config - the resolved config.
 * @returns the lifetime in milliseconds, bounded by the approval timeout.
 */
export function decisionTtlOf(config: MobileRemoteConfig): number {
  const wait = config.approvalTimeoutMs
  const link = config.decisionTtlMs > 0 ? config.decisionTtlMs : wait
  return Math.min(link, wait)
}

/** Whether pairing is switched on at all (the empty authority means "off"). */
export function isPairingConfigured(config: MobileRemoteConfig): boolean {
  return typeof config.pairingAuthority === 'string' && config.pairingAuthority.length > 0
}

/**
 * WHATWG parse of a Host-header-shaped authority.
 *
 * Mirrors the shipped fence's own parser (`parseAuthority` in
 * `docs/evidence/dsh-client-connection__lib__index.js`): lowercase hostname,
 * default port stripped, IPv6 bracketed, or `undefined` when unparsable.
 *
 * @param authority - the raw authority text.
 * @returns the parsed URL, or undefined when it is not an authority at all.
 */
export function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`.
 *
 * Mirrors `canonicalAuthority` in the same evidence file: the port is judged
 * through URL parses under both special schemes, never from the raw string.
 */
export function canonicalAuthority(entry: string, parsed: URL): string {
  const port = parsed.port !== '' ? parsed.port : new URL(`https://${entry}`).port
  return port === '' ? parsed.hostname : `${parsed.hostname}:${port}`
}

/**
 * Whether a configured authority is a bare `host[:port]` in canonical form.
 *
 * Same rule the shipped fence applies to its own `trustedHosts` entries
 * (docs/00-contract.md §1.2 B-2): anything WHATWG parsing would silently rewrite
 * (a path, userinfo, surrounding whitespace, a dangling colon, a zero-padded
 * port, a non-canonical host spelling) is refused instead of being accepted with
 * a different meaning than the author wrote.
 *
 * This is a *use-site* check, deliberately not a schema validator: a bad value
 * must produce a readable refusal from the tool and a quiet 503 from the route,
 * not a plugin that fails to mount and takes the whole row down.
 *
 * @param entry - the configured value, verbatim.
 * @returns true when the value is a canonical bare authority.
 */
export function isBareAuthority(entry: string): boolean {
  const parsed = parseAuthority(entry)
  if (parsed === undefined) return false
  return canonicalAuthority(entry, parsed) === entry.toLowerCase()
}

/**
 * The clean browser URL a phone should land on: the authority root, with a
 * trailing slash so the shipped auth handoff can redirect to the
 * directory-relative `./`.
 *
 * @param authority - the configured bare authority.
 * @returns `https://<authority>/`.
 */
export function pairingBaseUrl(authority: string): string {
  return `https://${authority}/`
}
