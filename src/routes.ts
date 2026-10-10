/**
 * The plugin's HTTP surface on the *existing* host webserver.
 *
 * Two rules come straight from the frozen contract (docs/00-contract.md §5) and
 * are the reason this file exists as its own module:
 *
 *  1. **Reuse `ctx.webServer`.** A cordis service name can be registered once, so
 *     starting a second HTTP server would throw `service "webServer" has been
 *     registered` — and would also break the "one resident server on 19387"
 *     rule. Routes are claimed with `register({kind: 'exact', path, handler})`.
 *  2. **Admission is not free.** The shipped fence only guards the `/api`
 *     prefix, so a handler on our own path must call `ctx.connection.admit(req)`
 *     itself, *first*, and every refusal must be information-free: the body is
 *     the single word `unauthorized` or `forbidden`, never a URL, a token or an
 *     authority. Admission is *recognised*, never assumed: only the fence's own
 *     success shape opens the URL path ({@link readAdmission}).
 *
 * The handler is built from injected thunks rather than captured services, so a
 * reload that swaps a service is observed on the next request instead of pinning
 * a stale object.
 *
 * @module dsh-mobile-remote/routes
 */

import { createHash } from 'node:crypto'

import {
  type AuditHeaderBag,
  type AuditLog,
  headerValue,
  pathnameOnly,
  sanitizeError,
  sourceFacts,
} from './audit.ts'
import type { ApprovalService } from './approval.ts'
import { isBareAuthority, isPairingConfigured, type MobileRemoteConfig } from './config.ts'
import type { DeviceRegistry } from './device.ts'
import {
  SECOND_CONFIRMATION_HEADER,
  classifySource,
  confirmationRequirement,
  readLimitedBody,
  type SecondConfirmationGate,
} from './hardening.ts'
import { buildPairUrl, resolvePairPort, type ServiceLookup } from './pair.ts'

/** The pairing route (P1). */
export const PAIR_ROUTE_PATH = '/mobile-remote/pair'
/** The one-time decision link (P3). */
export const DECIDE_ROUTE_PATH = '/mobile-remote/decide'
/** Device table + pending approvals, read-only (P4). */
export const STATE_ROUTE_PATH = '/mobile-remote/state'
/** Single-device revocation and grant rotation (P4). */
export const REVOKE_ROUTE_PATH = '/mobile-remote/device/revoke'
/** Device-grant issuance (P4); operator-only (fence admission). */
export const REGISTER_ROUTE_PATH = '/mobile-remote/device/register'

/** Request facts this module reads (structurally satisfied by `http.IncomingMessage`). */
export interface RouteRequest {
  method?: string | undefined
  url?: string | undefined
  headers?: AuditHeaderBag | undefined
  socket?: { remoteAddress?: string | undefined } | undefined
}

/** Response facts this module writes (structurally satisfied by `http.ServerResponse`). */
export interface RouteResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/** A handler owns the full response lifecycle. */
export type RouteHandler = (req: RouteRequest, res: RouteResponse) => void

/** The slice of `@deepseek-ai/dsh-host-webserver` this plugin uses. */
export interface WebServerLike {
  register(route: { kind: 'exact'; path: string; handler: RouteHandler }): (() => void) | undefined
}

/** The slice of `@deepseek-ai/dsh-client-connection` the route needs. */
export interface AdmitterLike {
  admit(request: unknown): unknown
}

/** What the route reads from the live plugin context. */
export interface PairRouteDeps {
  /** Current config (re-read per request so a reload is honoured). */
  configOf: () => MobileRemoteConfig
  /** Service lookup off the plugin context. */
  getService: ServiceLookup
  /** Audit sink for hits and refusals. */
  audit: AuditLog
  /**
   * The approval service, once the credentials-derived secret was available.
   * Optional so the P1 surface keeps working in a document-less harness: every
   * P3/P4 route fails closed (503) while it is absent.
   */
  approvalOf?: () => ApprovalService | undefined
  /** The device registry, same condition. */
  devicesOf?: () => DeviceRegistry | undefined
  /** The second-confirmation gate, same condition. */
  gateOf?: () => SecondConfirmationGate | undefined
}

/** Text bodies, frozen to the shipped fence's own two words. */
export const REFUSAL_BODY_UNAUTHORIZED = 'unauthorized'
export const REFUSAL_BODY_FORBIDDEN = 'forbidden'

/**
 * What this route takes from `admit`'s answer.
 *
 * The two refusal words are the shipped fence's own; `admission-unrecognized` is
 * the audit-only label for an answer this route could not read as an admission
 * (a thenable, a non-object, or an object without a truthy `peer`) — it is still
 * answered with `401 unauthorized`, so nothing about the shape reaches a caller.
 */
export interface AdmissionVerdict {
  admitted: boolean
  status?: 401 | 403
  result?: 'unauthenticated' | 'forbidden' | 'admission-unrecognized'
}

/**
 * Read `admit`'s answer, admitting **only** a shape that is positively
 * recognised as an admission.
 *
 * The shipped fence answers `{ peer }` or `{ rejection: 401 | 403 }`, and its
 * own `/api` handler switches on `'rejection' in admission`
 * (`docs/evidence/dsh-client-connection__lib__index.js:648`). A normalization
 * that admits "anything without a numeric rejection" therefore inverts that
 * semantics and fails **open**: `{ rejection: '403' }`, `{}`, `undefined`,
 * `true`, `'denied'`, `[]` and a pending promise all reached the success path
 * and minted a token-bearing URL (review F1, 9 shapes). So:
 *
 *  - not an object (or `null`) ⇒ refuse 401;
 *  - a thenable ⇒ refuse 401 — `admit` is synchronous in the shipped fence, and
 *    an answer we would have to await is an answer we cannot read *now*;
 *  - `'rejection' in answer` ⇒ refuse, writing `403` only for exactly `403`
 *    (any other value, including a non-number, is normalized to `401`);
 *  - otherwise `peer` must be **truthy** ⇒ admit.
 *
 * @param admission - whatever `ctx.connection.admit(req)` returned.
 * @returns the verdict: admit, or the status and audit label to refuse with.
 */
export function readAdmission(admission: unknown): AdmissionVerdict {
  const refuse = (result: 'unauthenticated' | 'forbidden' | 'admission-unrecognized'): AdmissionVerdict => ({
    admitted: false,
    status: result === 'forbidden' ? 403 : 401,
    result,
  })

  if (admission === null || typeof admission !== 'object') return refuse('admission-unrecognized')
  if (typeof (admission as { then?: unknown }).then === 'function') return refuse('admission-unrecognized')

  const answer = admission as { rejection?: unknown; peer?: unknown }
  if ('rejection' in answer) {
    // The fence only ever answers 401 or 403; anything else is normalized to the
    // fail-closed default so a broken service cannot widen the answer.
    return answer.rejection === 403 ? refuse('forbidden') : refuse('unauthenticated')
  }
  return answer.peer ? { admitted: true } : refuse('admission-unrecognized')
}

/** Whether a looked-up service can admit requests. */
function isAdmitter(value: unknown): value is AdmitterLike {
  return value !== null && typeof value === 'object' && typeof (value as { admit?: unknown }).admit === 'function'
}

/** Write one text response; HEAD gets the headers and no body. */
function writeText(res: RouteResponse, status: number, body: string, head: boolean): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(head ? undefined : body)
}

/** Write one JSON response; HEAD gets the headers and no body. */
function writeJson(res: RouteResponse, status: number, body: string, head: boolean): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(head ? undefined : body)
}

/**
 * Build the `/mobile-remote/pair` handler.
 *
 * Decision order, and why:
 *
 *  1. `admit` — the contract and the fence's own `/api` handler both refuse
 *     before doing any work, and doing it first keeps configuration state
 *     (configured or not) invisible to an unauthenticated caller;
 *  2. method — GET and HEAD only;
 *  3. configuration — an unconfigured or non-canonical authority answers 503
 *     `pairing not configured` with no URL;
 *  4. only then the authenticated launch URL.
 *
 * @param deps - config, service lookup and audit sink.
 * @returns the route handler.
 */
export function createPairHandler(deps: PairRouteDeps): RouteHandler {
  const { configOf, getService, audit } = deps

  return (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const head = method === 'HEAD'
    const path = pathnameOnly(req.url)
    const facts = sourceFacts(req.headers, req.socket?.remoteAddress)
    // Every record carries both halves of the source story, so a later hardening
    // decision (T9/P4) never has to trust a client-supplied header alone (F4).
    const base = {
      method,
      path,
      source: facts.source,
      socketPeer: facts.socketPeer,
      viaForwarded: facts.viaForwarded,
    }

    const connection = getService('connection')
    if (!isAdmitter(connection)) {
      // Fail closed: without the fence we cannot tell a phone from anything else.
      audit.record({ ...base, result: 'connection-unavailable', status: 403 })
      writeText(res, 403, REFUSAL_BODY_FORBIDDEN, head)
      return
    }

    let admission: unknown
    try {
      admission = connection.admit(req)
    } catch (error) {
      audit.record({
        ...base,
        result: 'admission-error',
        status: 403,
        detail: sanitizeError(error, 'admission-error'),
      })
      writeText(res, 403, REFUSAL_BODY_FORBIDDEN, head)
      return
    }

    // Fail closed: only a positively recognised admission opens the URL path.
    const verdict = readAdmission(admission)
    if (!verdict.admitted) {
      const status = verdict.status ?? 401
      audit.record({ ...base, result: verdict.result ?? 'admission-unrecognized', status })
      writeText(res, status, status === 403 ? REFUSAL_BODY_FORBIDDEN : REFUSAL_BODY_UNAUTHORIZED, head)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      audit.record({ ...base, result: 'method-not-allowed', status: 405 })
      writeText(res, 405, 'method not allowed', head)
      return
    }

    const config = configOf()
    const authority = config.pairingAuthority
    if (!isPairingConfigured(config) || !isBareAuthority(authority)) {
      // One answer for "switched off" and for "written wrong": the route stays
      // quiet about configuration details, and the tool is where an operator
      // gets the readable explanation.
      audit.record({
        ...base,
        result: isPairingConfigured(config) ? 'authority-invalid' : 'not-configured',
        status: 503,
      })
      writeText(res, 503, 'pairing not configured', head)
      return
    }

    const resolution = resolvePairPort(getService)
    if (!resolution.ok) {
      audit.record({ ...base, result: resolution.code, status: 503 })
      writeText(res, 503, 'pairing not configured', head)
      return
    }

    let url: string
    try {
      url = buildPairUrl(resolution.connection, authority)
    } catch (error) {
      audit.record({
        ...base,
        result: 'internal',
        status: 500,
        detail: sanitizeError(error, 'internal'),
      })
      writeText(res, 500, 'internal error', head)
      return
    }

    audit.record({ ...base, result: 'ok', status: 200 })
    // Body shape is frozen (T-7): exactly url / authority / expiresAt.
    writeJson(res, 200, JSON.stringify({ url, authority, expiresAt: null }), head)
  }
}

/**
 * The cookie name a **device grant** is presented under.
 *
 * Deliberately *not* the shipped `dsh-auth-<sha256(authority)>` name: that name
 * carries the fence's own browser-session cookie, and writing our grant there
 * would clobber the cookie the shipped fence verifies — the operator's GUI
 * session would start answering 401. The authority binding the reviewer asked
 * for is kept anyway: the digest is in the name, and the grant payload is
 * authority-scoped (`audience`), so a grant from another authority cannot be
 * replayed here. See docs/06-hardening-contract.md §2.
 *
 * @param authority - the configured bare authority.
 * @returns the cookie name for this authority.
 */
export function deviceCookieName(authority: string): string {
  return `dsmr-device-${createHash('sha256').update(authority, 'utf8').digest('hex').slice(0, 16)}`
}

/** One `cookie` header value by name. */
function cookieOf(headers: AuditHeaderBag | undefined, name: string): string | undefined {
  const raw = headerValue(headers, 'cookie')
  if (raw === undefined || name.length === 0) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** How a P3/P4 route admits one request. */
type SurfaceAdmission =
  | { ok: true; via: 'device'; deviceId: string }
  | { ok: true; via: 'operator' }
  | { ok: false; status: 401 | 403 | 503; result: string; detail?: string }

/**
 * Admission for the P3/P4 routes: **a presented device grant decides**, and only
 * when none is presented does the shipped fence get to answer.
 *
 * That order is the point of device-level revocation: a revoked grant must not
 * be rescued by the operator's shared browser cookie. `allowInvalidFallback`
 * exists for the one route that must let an *expired* device re-register (R5);
 * a **revoked** device never falls through, on any route.
 *
 * @param deps - route dependencies.
 * @param req - the request.
 * @param cookieName - the device cookie name for the live authority ('' = skip).
 * @param options - fallback policy for an unusable grant.
 * @returns the admission verdict.
 */
function admitSurface(
  deps: PairRouteDeps,
  req: RouteRequest,
  cookieName: string,
  options: { allowInvalidFallback: boolean },
): SurfaceAdmission {
  const devices = deps.devicesOf?.()
  const presented = cookieName.length > 0 ? cookieOf(req.headers, cookieName) : undefined

  if (presented !== undefined && presented.length > 0) {
    if (devices === undefined) return { ok: false, status: 503, result: 'hardening-unavailable' }
    const verdict = devices.verify(presented)
    if (!verdict.ok) {
      if (verdict.code === 'revoked') return { ok: false, status: 403, result: 'device-revoked' }
      if (!options.allowInvalidFallback) return { ok: false, status: 401, result: `device-${verdict.code}` }
    } else {
      return { ok: true, via: 'device', deviceId: verdict.device.id }
    }
  }

  const connection = deps.getService('connection')
  if (!isAdmitter(connection)) return { ok: false, status: 403, result: 'connection-unavailable' }
  let admission: unknown
  try {
    admission = connection.admit(req)
  } catch (error) {
    return { ok: false, status: 403, result: 'admission-error', detail: sanitizeError(error, 'admission-error') }
  }
  const verdict = readAdmission(admission)
  if (!verdict.admitted) {
    return { ok: false, status: verdict.status ?? 401, result: verdict.result ?? 'admission-unrecognized' }
  }
  return { ok: true, via: 'operator' }
}

/** The refusal body for a status the fence vocabulary covers. */
function refusalBody(status: number): string {
  return status === 403 ? REFUSAL_BODY_FORBIDDEN : REFUSAL_BODY_UNAUTHORIZED
}

/** Parse a request target without ever throwing. */
function parseTarget(target: string | undefined): URL | undefined {
  try {
    return new URL(typeof target === 'string' && target.length > 0 ? target : '/', 'http://127.0.0.1')
  } catch {
    return undefined
  }
}

/** Write one HTML response; `no-store` and `nosniff` are mandatory here. */
function writeHtml(res: RouteResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/**
 * The one-time decision page (R2).
 *
 * No cookie is consulted — the signed link *is* the capability. Every refusal
 * class (bad signature, malformed, expired, already used, unknown id) answers
 * the **same** 403 with the **same** body, so the page cannot be used to probe
 * which ids exist. The audit record names the class but never the token.
 *
 * @param deps - config, audit and the approval service.
 * @returns the route handler.
 */
export function createDecideHandler(deps: PairRouteDeps): RouteHandler {
  const { audit, approvalOf } = deps

  return (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const path = pathnameOnly(req.url)
    const facts = sourceFacts(req.headers, req.socket?.remoteAddress)
    const base = { method, path, source: facts.source, socketPeer: facts.socketPeer, viaForwarded: facts.viaForwarded }

    if (method !== 'GET') {
      audit.record({ ...base, result: 'method-not-allowed', status: 405 })
      writeText(res, 405, 'method not allowed', false)
      return
    }

    const target = parseTarget(req.url)
    const id = target?.searchParams.get('d') ?? ''
    const token = target?.searchParams.get('t') ?? ''
    if (id === '' || token === '') {
      audit.record({ ...base, result: 'decide-missing-params', status: 400 })
      writeText(res, 400, 'bad request', false)
      return
    }

    const approval = approvalOf?.()
    if (approval === undefined) {
      audit.record({ ...base, result: 'decide-unavailable', status: 503 })
      writeText(res, 503, 'decision links unavailable', false)
      return
    }

    const outcome = approval.answer({ id, t: token, word: target?.searchParams.get('w') })
    if (outcome.code !== 'ok') {
      // Four refusal classes, one answer: no id oracle, no decision content.
      audit.record({ ...base, result: `decide-${outcome.code}`, status: 403 })
      writeText(res, 403, REFUSAL_BODY_FORBIDDEN, false)
      return
    }

    audit.record({ ...base, result: 'decide-ok', status: 200, detail: `decision=${outcome.word}` })
    writeHtml(
      res,
      200,
      `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 审批结果</title></head>
<body style="font:16px/1.6 system-ui;margin:2rem"><p>审批已记录：<strong>${outcome.word}</strong></p></body></html>`,
    )
  }
}

/**
 * Device table and pending approvals (R3) — read-only, no tokens in the body.
 *
 * @param deps - config, audit, device registry and approval service.
 * @returns the route handler.
 */
export function createStateHandler(deps: PairRouteDeps): RouteHandler {
  const { configOf, audit, approvalOf, devicesOf } = deps

  return (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const head = method === 'HEAD'
    const path = pathnameOnly(req.url)
    const facts = sourceFacts(req.headers, req.socket?.remoteAddress)
    const base = { method, path, source: facts.source, socketPeer: facts.socketPeer, viaForwarded: facts.viaForwarded }
    const config = configOf()
    const authority = config.pairingAuthority
    const cookieName = isPairingConfigured(config) && isBareAuthority(authority) ? deviceCookieName(authority) : ''

    const admission = admitSurface(deps, req, cookieName, { allowInvalidFallback: false })
    if (!admission.ok) {
      audit.record({ ...base, result: admission.result, status: admission.status, ...(admission.detail === undefined ? {} : { detail: admission.detail }) })
      writeText(res, admission.status, admission.status === 503 ? 'hardening unavailable' : refusalBody(admission.status), head)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      audit.record({ ...base, result: 'method-not-allowed', status: 405 })
      writeText(res, 405, 'method not allowed', head)
      return
    }
    if (!isPairingConfigured(config) || !isBareAuthority(authority)) {
      audit.record({ ...base, result: 'not-configured', status: 503 })
      writeText(res, 503, 'pairing not configured', head)
      return
    }

    const devices = devicesOf?.()
    const approval = approvalOf?.()
    if (devices === undefined || approval === undefined) {
      audit.record({ ...base, result: 'hardening-unavailable', status: 503 })
      writeText(res, 503, 'hardening unavailable', head)
      return
    }

    const payload = {
      ok: true,
      devices: devices.devices().map((device) => ({
        id: device.id,
        label: device.label,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        ...(device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt }),
      })),
      pending: approval.pending().map((row) => ({
        id: row.id,
        ...(row.summary === undefined ? {} : { summary: row.summary }),
        ...(row.subject === undefined ? {} : { subject: row.subject }),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      })),
    }
    audit.record({ ...base, result: 'state', status: 200 })
    writeJson(res, 200, JSON.stringify(payload), head)
  }
}

/**
 * Single-device revocation and grant rotation (R4).
 *
 * A **remote** caller must present a redeemed second confirmation
 * (`x-dsmr-confirm: <approval id>`), because revoking a device is the one
 * destructive action this plugin exposes. Locally-issued revocations skip the
 * gate (the operator is at the machine).
 *
 * @param deps - config, audit, device registry, approval service and gate.
 * @returns the route handler.
 */
export function createRevokeHandler(deps: PairRouteDeps): RouteHandler {
  const { configOf, audit, devicesOf, gateOf } = deps

  const run = async (req: RouteRequest, res: RouteResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase()
    const path = pathnameOnly(req.url)
    const facts = sourceFacts(req.headers, req.socket?.remoteAddress)
    const base = { method, path, source: facts.source, socketPeer: facts.socketPeer, viaForwarded: facts.viaForwarded }
    const config = configOf()
    const authority = config.pairingAuthority
    const cookieName = isPairingConfigured(config) && isBareAuthority(authority) ? deviceCookieName(authority) : ''

    const admission = admitSurface(deps, req, cookieName, { allowInvalidFallback: false })
    if (!admission.ok) {
      audit.record({ ...base, result: admission.result, status: admission.status, ...(admission.detail === undefined ? {} : { detail: admission.detail }) })
      writeText(res, admission.status, admission.status === 503 ? 'hardening unavailable' : refusalBody(admission.status), false)
      return
    }

    if (method !== 'POST') {
      audit.record({ ...base, result: 'method-not-allowed', status: 405 })
      writeText(res, 405, 'method not allowed', false)
      return
    }

    const devices = devicesOf?.()
    if (devices === undefined) {
      audit.record({ ...base, result: 'hardening-unavailable', status: 503 })
      writeText(res, 503, 'hardening unavailable', false)
      return
    }

    const action = 'pluginManager.device.revoke'
    const source = classifySource(facts, req.headers)
    const requirement = confirmationRequirement({
      toolName: action,
      source,
      enabled: config.requireSecondConfirmation,
      prefixes: config.riskyToolPrefixes,
    })
    if (requirement.required) {
      const presented = headerValue(req.headers, SECOND_CONFIRMATION_HEADER) ?? ''
      const gate = gateOf?.()
      if (gate === undefined) {
        audit.record({ ...base, result: 'confirm-unavailable', status: 503 })
        writeText(res, 503, 'hardening unavailable', false)
        return
      }
      if (presented === '') {
        // Mint the round so the phone/GUI can answer it, then refuse uniformly.
        const round = gate.request({ toolName: action, summary: `远程来源请求吊销设备（${source.source}）` })
        if (round === undefined) {
          // F5 (t29): the gate is rate-bounded — answer 403 and mint nothing, so
          // a flood cannot evict legitimate pending rows.
          audit.record({ ...base, result: 'confirm-throttled', status: 403 })
          writeText(res, 403, REFUSAL_BODY_FORBIDDEN, false)
          return
        }
        audit.record({ ...base, result: 'confirm-required', status: 403, detail: `confirmation=${round.id}` })
        writeText(res, 403, REFUSAL_BODY_FORBIDDEN, false)
        return
      }
      if (!gate.consume(presented)) {
        audit.record({ ...base, result: 'confirm-invalid', status: 403 })
        writeText(res, 403, REFUSAL_BODY_FORBIDDEN, false)
        return
      }
    }

    const read = await readLimitedBody(req, config.maxBodyBytes)
    if (!read.ok) {
      const status = read.code === 'too-large' ? 413 : 400
      audit.record({ ...base, result: read.code === 'too-large' ? 'body-too-large' : 'body-error', status })
      writeText(res, status, read.code === 'too-large' ? 'payload too large' : 'bad request', false)
      return
    }

    let body: unknown
    try {
      body = read.text.length === 0 ? {} : JSON.parse(read.text)
    } catch {
      audit.record({ ...base, result: 'body-not-json', status: 400 })
      writeText(res, 400, 'bad request', false)
      return
    }
    const record = (body ?? {}) as Record<string, unknown>

    if (record['rotate'] === true) {
      const sequence = devices.rotateGrants()
      audit.record({ ...base, result: 'rotated', status: 200, detail: `grantSeq=${sequence}` })
      writeJson(res, 200, JSON.stringify({ ok: true, rotated: sequence }), false)
      return
    }

    const deviceId = record['deviceId']
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      audit.record({ ...base, result: 'bad-request', status: 400 })
      writeText(res, 400, 'bad request', false)
      return
    }
    if (!devices.revoke(deviceId)) {
      audit.record({ ...base, result: 'unknown-device', status: 404 })
      writeJson(res, 404, JSON.stringify({ ok: false, code: 'unknown-device' }), false)
      return
    }
    audit.record({ ...base, result: 'revoked', status: 200 })
    writeJson(res, 200, JSON.stringify({ ok: true, revoked: deviceId }), false)
  }

  return (req, res) => {
    void run(req, res)
  }
}

/**
 * Device-grant issuance (R5).
 *
 * Admission is the shipped fence (or an existing, **non-revoked** grant for a
 * re-issue). A revoked grant never falls through to the fence, so revocation
 * cannot be undone by the device itself. The `Set-Cookie` mirrors the shipped
 * cookie's deliberate attributes — `HttpOnly`, `SameSite=Strict`, `Path=/`, and
 * no `Secure` (the fence serves loopback HTTP as well) — nothing is weakened.
 *
 * @param deps - config, audit and the device registry.
 * @returns the route handler.
 */
export function createRegisterHandler(deps: PairRouteDeps): RouteHandler {
  const { configOf, audit, devicesOf } = deps

  const run = async (req: RouteRequest, res: RouteResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase()
    const path = pathnameOnly(req.url)
    const facts = sourceFacts(req.headers, req.socket?.remoteAddress)
    const base = { method, path, source: facts.source, socketPeer: facts.socketPeer, viaForwarded: facts.viaForwarded }
    const config = configOf()
    const authority = config.pairingAuthority
    const cookieName = isPairingConfigured(config) && isBareAuthority(authority) ? deviceCookieName(authority) : ''

    const admission = admitSurface(deps, req, cookieName, { allowInvalidFallback: true })
    if (!admission.ok) {
      audit.record({ ...base, result: admission.result, status: admission.status, ...(admission.detail === undefined ? {} : { detail: admission.detail }) })
      writeText(res, admission.status, admission.status === 503 ? 'hardening unavailable' : refusalBody(admission.status), false)
      return
    }

    if (method !== 'POST') {
      audit.record({ ...base, result: 'method-not-allowed', status: 405 })
      writeText(res, 405, 'method not allowed', false)
      return
    }
    if (!isPairingConfigured(config) || !isBareAuthority(authority)) {
      audit.record({ ...base, result: 'not-configured', status: 503 })
      writeText(res, 503, 'pairing not configured', false)
      return
    }

    const devices = devicesOf?.()
    if (devices === undefined) {
      audit.record({ ...base, result: 'hardening-unavailable', status: 503 })
      writeText(res, 503, 'hardening unavailable', false)
      return
    }

    const read = await readLimitedBody(req, config.maxBodyBytes)
    if (!read.ok) {
      const status = read.code === 'too-large' ? 413 : 400
      audit.record({ ...base, result: read.code === 'too-large' ? 'body-too-large' : 'body-error', status })
      writeText(res, status, read.code === 'too-large' ? 'payload too large' : 'bad request', false)
      return
    }
    let label = 'phone'
    let deviceId: string | undefined
    let unrevoke = false
    if (read.text.length > 0) {
      try {
        const parsed = JSON.parse(read.text) as Record<string, unknown>
        if (typeof parsed['label'] === 'string' && parsed['label'].trim().length > 0) label = parsed['label'].trim().slice(0, 64)
        if (typeof parsed['deviceId'] === 'string' && parsed['deviceId'].length > 0) deviceId = parsed['deviceId']
        unrevoke = parsed['unrevoke'] === true
      } catch {
        audit.record({ ...base, result: 'body-not-json', status: 400 })
        writeText(res, 400, 'bad request', false)
        return
      }
    }
    if (admission.via === 'device') deviceId = admission.deviceId

    // F2 (t29): re-registering a **revoked** device id must not resurrect it.
    // The id arrives from the caller, so honouring it silently would let anyone
    // holding the shared fence cookie undo a revocation (t14 measured exactly
    // that: 200 + a fresh credential, `revokedAt` back to null). Reversal is a
    // separate, explicit, local-operator action and is audited as such.
    if (deviceId !== undefined && devices.isRevoked(deviceId)) {
      if (!unrevoke) {
        audit.record({ ...base, result: 'device-revoked', status: 409, detail: `device=${deviceId}` })
        writeJson(res, 409, JSON.stringify({ ok: false, code: 'device-revoked' }), false)
        return
      }
      if (classifySource(facts, req.headers).remote) {
        audit.record({ ...base, result: 'unrevoke-remote-refused', status: 403, detail: `device=${deviceId}` })
        writeText(res, 403, REFUSAL_BODY_FORBIDDEN, false)
        return
      }
      if (!devices.unrevoke(deviceId)) {
        audit.record({ ...base, result: 'unknown-device', status: 404 })
        writeJson(res, 404, JSON.stringify({ ok: false, code: 'unknown-device' }), false)
        return
      }
      audit.record({ ...base, result: 'device-unrevoked', status: 200, detail: `device=${deviceId}` })
    }

    const issued = devices.register(label, deviceId === undefined ? {} : { deviceId })
    const ttlSeconds = Math.max(1, Math.floor((issued.expiresAt - Date.now()) / 1000))
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': `${cookieName}=${issued.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}`,
    })
    res.end(JSON.stringify({
      ok: true,
      device: { id: issued.device.id, label: issued.device.label, createdAt: issued.device.createdAt },
      expiresAt: issued.expiresAt,
    }))
    audit.record({ ...base, result: 'device-registered', status: 200, detail: `device=${issued.device.id}` })
  }

  return (req, res) => {
    void run(req, res)
  }
}

/**
 * Register the route on the host webserver and return its disposer.
 *
 * @param ctx - the plugin context (only `webServer` is read).
 * @param deps - route dependencies.
 * @returns the disposer removing the route; a no-op when no webserver is present.
 */
export function registerPairRoute(
  ctx: unknown,
  deps: PairRouteDeps,
): () => void {
  const webServer = (ctx as { webServer?: WebServerLike } | null | undefined)?.webServer
  if (webServer === undefined || typeof webServer.register !== 'function') return () => {}
  const dispose = webServer.register({
    kind: 'exact',
    path: PAIR_ROUTE_PATH,
    handler: createPairHandler(deps),
  })
  return () => {
    if (typeof dispose === 'function') dispose()
  }
}

/** One exact route plus its handler. */
interface RouteSpec {
  path: string
  handler: (deps: PairRouteDeps) => RouteHandler
}

/** Every route this plugin owns, in registration order. */
const ROUTE_SPECS: readonly RouteSpec[] = [
  { path: PAIR_ROUTE_PATH, handler: createPairHandler },
  { path: DECIDE_ROUTE_PATH, handler: createDecideHandler },
  { path: STATE_ROUTE_PATH, handler: createStateHandler },
  { path: REVOKE_ROUTE_PATH, handler: createRevokeHandler },
  { path: REGISTER_ROUTE_PATH, handler: createRegisterHandler },
]

/**
 * Register every `/mobile-remote/*` route on the host webserver.
 *
 * One `register` per exact path: the shipped route table refuses a duplicate
 * `(kind, path)`, so a partial failure still leaves a clean disposer for the
 * routes that did register.
 *
 * @param ctx - the plugin context (only `webServer` is read).
 * @param deps - route dependencies.
 * @returns the disposer removing every route this call registered.
 */
export function registerMobileRoutes(ctx: unknown, deps: PairRouteDeps): () => void {
  const webServer = (ctx as { webServer?: WebServerLike } | null | undefined)?.webServer
  if (webServer === undefined || typeof webServer.register !== 'function') return () => {}

  const disposers: Array<() => void> = []
  for (const spec of ROUTE_SPECS) {
    const dispose = webServer.register({ kind: 'exact', path: spec.path, handler: spec.handler(deps) })
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** The routes this plugin registers, for diagnostics and tests. */
export const ROUTE_PATHS: readonly string[] = ROUTE_SPECS.map((spec) => spec.path)
