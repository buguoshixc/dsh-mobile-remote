/**
 * The one model-callable tool: `mobile_pair_url`.
 *
 * The user's sentence is "give me a pairing link for my phone"; the tool turns
 * that into an authenticated launch URL, or into a readable explanation of what
 * is missing. It is deliberately **read-only**: the launch token is a
 * process-level value owned by `client-connection`, so asking twice returns the
 * same URL and mints nothing (`expiresAt` is therefore always `null` — expiry
 * belongs to the cookie layer, not to this URL).
 *
 * Registration goes through `ctx.inject(['tools'], …)` rather than a hard
 * service dependency: `tools` is an optional surface, and a plugin that refuses
 * to mount when the tool registry is absent would lose its HTTP routes too
 * (docs/00-contract.md §3 补充约束 / §10 T-2).
 *
 * ## Why the definition is a literal instead of `defineTool(...)`
 *
 * `@deepseek-ai/dsh-tools` is not imported at runtime. The shipped `defineTool`
 * is a small helper, but reaching it means the host artifact carries a
 * module-scope import of a package that resolves a chain of harness-internal
 * peers (`@deepseek-ai/dsh-scope`, `dsh-agent`, …). In production the launcher's
 * profile resolution intercepts that specifier and serves the installation's own
 * copy, so it works there; in plain Node — which is exactly where `pnpm test`
 * and any host-side unit test run — it would resolve to this repo's
 * devDependency and fail on a peer a plugin repo has no business installing. A
 * host artifact that cannot be imported without a DSH installation is a worse
 * trade than writing the two schemas out, so {@link PAIR_RESULT_SCHEMA} holds the
 * compiled JSON Schema and {@link HostToolDefinition} is a local structural type.
 *
 * The literal is the compiled form of this author-DSL shape (a property's
 * `required: true` becomes the object's `required` array):
 *
 * ```ts
 * defineTool({ parameters: {}, output: { schema: {
 *   type: 'object', additionalProperties: false,
 *   properties: { ok: { type: 'boolean', required: true }, … },
 * } } })
 * ```
 *
 * It was checked against the real package that ships in `app.asar`: the shipped
 * `assertSupportedJsonSchema` accepts it, `valueSchemaSpecToJsonSchema` produces
 * exactly it from the author form, and every result the tool can return passes
 * the shipped `validateJsonSchemaValue`.
 *
 * @module dsh-mobile-remote/tools
 */

import type { Context } from '@deepseek-ai/cordis'

import { sanitizeError } from './audit.ts'
import { isBareAuthority, isPairingConfigured, type MobileRemoteConfig } from './config.ts'
import {
  buildPairUrl,
  fenceNote,
  pairAuthorityInvalid,
  pairNotConfigured,
  pairSuccess,
  pairUnavailable,
  renderPairResult,
  resolvePairPort,
  type PairResult,
  type ServiceLookup,
} from './pair.ts'

/** The frozen tool name (docs/00-contract.md §4). */
export const PAIR_TOOL_NAME = 'mobile_pair_url'

/**
 * The registered-tool shape this plugin hands the registry.
 *
 * Declared locally rather than imported: `ToolDefinition` extends `ToolSchema`
 * from `@deepseek-ai/dsh-llm`, which a plugin repo does not carry, so the
 * imported type is only partly resolvable here. The fields below are the ones
 * the shipped `defineTool` emits — `parameters` and `output.schema` are already
 * compiled JSON Schema — and the built values are verified against the real
 * package's validators, which is a stronger check than the opaque type.
 */
export interface HostToolDefinition {
  readonly name: string
  readonly description: string
  /** Compiled JSON Schema for the (empty) argument object root. */
  readonly parameters: unknown
  readonly output: {
    /** Compiled JSON Schema enforced against every returned value. */
    readonly schema: unknown
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
  }
  execute(args: unknown, exec: unknown): Promise<PairResult>
}

/** The minimum of `@deepseek-ai/dsh-tools`' registry this plugin uses. */
export interface ToolsLike {
  register(tool: HostToolDefinition): unknown
}

/** What the tool reads from the live plugin context. */
export interface PairToolDeps {
  /** Current config (re-read per call, so a reload is honoured). */
  configOf: () => MobileRemoteConfig
  /** Service lookup off the plugin context. */
  getService: ServiceLookup
  /** The `webRuntime` service, for the browser-trust note. */
  runtimeOf: () => unknown
}

/** The tool takes no arguments: the parameter object root is empty. */
const PAIR_PARAMETERS = { type: 'object', properties: {} }

/**
 * Canonical output schema — the JSON shape frozen by docs/00-contract.md §4,
 * as enforced JSON Schema.
 *
 * `url` is `string | null` and always present; `expiresAt` is present (and null)
 * only on success, matching the contract's two result rows exactly. `notes` is
 * listed as required because every result carries it — an empty array when there
 * is nothing to warn about — which keeps the success row's shape independent of
 * the fence's configuration (review F3 / CHANGE-t21-A).
 */
export const PAIR_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'configured', 'url', 'notes'],
  properties: {
    ok: { type: 'boolean', description: '是否拿到了可用的配对链接' },
    configured: { type: 'boolean', description: 'pairingAuthority 是否已配置' },
    url: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      description: '可直接点开的配对 URL；失败时为 null',
    },
    authority: { type: 'string', description: '手机侧访问用的裸 authority（host 或 host:port）' },
    expiresAt: { type: 'null', description: 'launchToken 无过期时间，成功时恒为 null' },
    code: { type: 'string', description: 'not-configured | connection-unavailable | internal' },
    message: { type: 'string', description: '失败原因（不含令牌）' },
    notes: { type: 'array', items: { type: 'string' }, description: '配置层面的提醒' },
  },
}

/** Read `trustedHosts` off the web-runtime service without trusting its shape. */
function trustedHostsOf(runtime: unknown): unknown {
  if (runtime === null || typeof runtime !== 'object') return undefined
  return (runtime as { trustedHosts?: unknown }).trustedHosts
}

/**
 * Resolve one call into the frozen result shape.
 *
 * Never throws: every failure path is a *value* the model can read and act on
 * (docs/00-contract.md §4 "绝不抛异常", 失败即关闭).
 *
 * @param deps - config and service lookups.
 * @returns the canonical tool result.
 */
export function resolvePairResult(deps: PairToolDeps): PairResult {
  const config = deps.configOf()
  if (!isPairingConfigured(config)) return pairNotConfigured()
  if (!isBareAuthority(config.pairingAuthority)) return pairAuthorityInvalid(config.pairingAuthority)

  const resolution = resolvePairPort(deps.getService)
  if (!resolution.ok) return pairUnavailable(resolution.code, resolution.message, true)

  let url: string
  try {
    url = buildPairUrl(resolution.connection, config.pairingAuthority)
  } catch (error) {
    // Never the exception's raw text: the message is a value the model reads and
    // the text channel is rendered into the session record (review F2), so both
    // go through the same sanitizer the audit `detail` uses.
    return pairUnavailable('internal', `生成配对链接失败：${sanitizeError(error, 'internal')}`, true)
  }

  const notes: string[] = []
  const note = fenceNote(config.pairingAuthority, trustedHostsOf(deps.runtimeOf()))
  if (note !== undefined) notes.push(note)
  return pairSuccess(config.pairingAuthority, url, notes)
}

/** The registry-ready definition (no arguments, so no argument validation is needed). */
export function pairToolDefinition(deps: PairToolDeps): HostToolDefinition {
  return {
    name: PAIR_TOOL_NAME,
    description:
      'Return the pairing URL that lets a phone open this DSH Web GUI over Tailscale without copying a token by hand. '
      + 'The URL carries the process launch token, so hand it to the phone directly. '
      + 'Call it when the user asks for a phone/mobile pairing link or QR code target.',
    parameters: PAIR_PARAMETERS,
    output: {
      schema: PAIR_RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderPairResult(value as unknown as PairResult) }],
    },
    execute: async () => resolvePairResult(deps),
  }
}

/**
 * Register `mobile_pair_url` when the tool registry appears.
 *
 * @param ctx - the plugin context.
 * @param deps - config and service lookups.
 */
export function registerPairTool(ctx: Context, deps: PairToolDeps): void {
  const host = ctx as unknown as {
    inject?: (services: string[], callback: (scoped: unknown) => void) => unknown
  }
  if (typeof host.inject !== 'function') return

  host.inject(['tools'], (scoped) => {
    const tools = (scoped as { tools?: ToolsLike } | null | undefined)?.tools
    if (tools === undefined || typeof tools.register !== 'function') return

    const install = (): (() => void) => {
      const registered = tools.register(pairToolDefinition(deps))
      return () => {
        if (typeof registered === 'function') (registered as () => void)()
      }
    }

    // The registration is owned by the fiber that waited for `tools`; binding it
    // explicitly keeps the disposer path identical to every other resource this
    // plugin acquires (docs/00-contract.md §10 T-4).
    const scopedCtx = scoped as { effect?: (execute: () => (() => void), label?: string) => unknown }
    if (typeof scopedCtx.effect === 'function') scopedCtx.effect(install, 'dsh-mobile-remote: mobile_pair_url')
    else install()
  })
}
