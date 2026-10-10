/**
 * T9/P4 tests — device grants, remote-source classification, the
 * second-confirmation gate and the body cap (`node --test`).
 *
 * The kernel-level cases drive `src/device.ts` and `src/hardening.ts` directly;
 * the route-level cases drive the real wiring through `apply()` with a stub host
 * (fence always admits, credentials carry the shipped 32-byte secret), which is
 * exactly how the composition mounts it.
 *
 * @module dsh-mobile-remote/test/host-device
 */

import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { redact } from '../src/audit.ts'
import { DeviceRegistry, deviceKey, signDeviceGrant } from '../src/device.ts'
import {
  classifySource,
  confirmationRequirement,
  isRiskyToolName,
  readLimitedBody,
  SecondConfirmationGate,
} from '../src/hardening.ts'
import { apply } from '../src/index.ts'
import { deviceCookieName } from '../src/routes.ts'
import { ApprovalService } from '../src/approval.ts'

const AUTHORITY = 'demo.tailnet-example.ts.net'
const SECRET_BYTES = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
const SECRET = SECRET_BYTES.toString('base64url')
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

test('device: a grant verifies, tampering and expiry are refused, revocation hits one device only', () => {
  let clock = 1_000_000
  const registry = new DeviceRegistry({ secret: SECRET_BYTES, now: () => clock, ttlMs: 60_000, limit: 8 })
  const a = registry.register('phone-A')
  const b = registry.register('phone-B')

  assert.equal(registry.verify(a.token).ok, true)
  assert.equal(registry.verify(a.token).device.label, 'phone-A')

  // Tampering: one character of the signature.
  const tampered = `${a.token.slice(0, -1)}${a.token.endsWith('A') ? 'B' : 'A'}`
  assert.deepEqual(registry.verify(tampered), { ok: false, code: 'bad-signature' })
  // Garbage shapes.
  assert.equal(registry.verify('v1.not-base64!.!').code, 'malformed')
  assert.equal(registry.verify('nonsense').code, 'malformed')

  // Expiry.
  clock += 61_000
  assert.equal(registry.verify(a.token).code, 'expired')
  clock -= 61_000

  // Revocation is per device.
  assert.equal(registry.revoke(a.device.id), true)
  assert.equal(registry.verify(a.token).code, 'revoked')
  assert.equal(registry.verify(b.token).ok, true, 'the other device is untouched')

  // Rotation invalidates every outstanding grant, including the fresh one.
  registry.rotateGrants()
  assert.equal(registry.verify(a.token).code, 'rotated')
  assert.equal(registry.verify(b.token).code, 'rotated')
  const reissued = registry.register('phone-B', { deviceId: b.device.id })
  assert.equal(registry.verify(reissued.token).ok, true, 'a re-issued grant is current again')

  // A well-signed grant for a device that was never registered.
  const forged = signDeviceGrant(deviceKey(SECRET_BYTES), {
    version: 1,
    deviceId: 'not-registered',
    issuedAt: clock,
    expiresAt: clock + 60_000,
    grantSeq: registry.grantSequence(),
  })
  assert.equal(registry.verify(forged).code, 'unknown-device')
})

test('hardening: source classification follows the frozen gate (proxied / loopback / direct / inconsistent)', () => {
  const proxied = classifySource({ source: '100.64.0.2', socketPeer: '127.0.0.1', viaForwarded: true })
  assert.equal(proxied.basis, 'proxied')
  assert.equal(proxied.remote, true)
  assert.equal(proxied.trusted, true)

  const proxiedLoopback = classifySource({ source: '127.0.0.1', socketPeer: '127.0.0.1', viaForwarded: true })
  assert.equal(proxiedLoopback.basis, 'proxied')
  assert.equal(proxiedLoopback.remote, true, 't29/F1: a forwarded request is remote, however the XFF is spelled')

  const local = classifySource({ source: '127.0.0.1', socketPeer: '127.0.0.1', viaForwarded: false })
  assert.equal(local.basis, 'loopback')
  assert.equal(local.remote, false)

  const direct = classifySource({ source: '100.64.0.9', socketPeer: '100.64.0.9', viaForwarded: false })
  assert.equal(direct.basis, 'direct')
  assert.equal(direct.remote, true)

  // A header claiming loopback while the kernel saw another host fails safe.
  const inconsistent = classifySource({ source: '127.0.0.1', socketPeer: '100.64.0.9', viaForwarded: true })
  assert.equal(inconsistent.basis, 'inconsistent')
  assert.equal(inconsistent.trusted, false)
  assert.equal(inconsistent.remote, true, 'never trusted down to local')

  // No socket evidence at all is remote too.
  const unknown = classifySource({ source: 'unknown', socketPeer: 'unknown', viaForwarded: false })
  assert.equal(unknown.remote, true)
  assert.equal(unknown.trusted, false)
})

test('hardening: the dangerous-prefix gate fires only for a remote source', () => {
  const remote = classifySource({ source: '100.64.0.2', socketPeer: '127.0.0.1', viaForwarded: true })
  const local = classifySource({ source: '127.0.0.1', socketPeer: '127.0.0.1', viaForwarded: false })
  const prefixes = ['terminal.', 'credentials.', 'pluginManager.']

  assert.equal(isRiskyToolName('terminal.exec', prefixes), true)
  assert.equal(isRiskyToolName('credentials.read', prefixes), true)
  assert.equal(isRiskyToolName('pluginManager.device.revoke', prefixes), true)
  assert.equal(isRiskyToolName('mobile_pair_url', prefixes), false)
  assert.equal(isRiskyToolName(undefined, prefixes), false)

  assert.deepEqual(
    confirmationRequirement({ toolName: 'terminal.exec', source: remote, enabled: true, prefixes }),
    { required: true, reason: 'remote-risky' },
  )
  assert.equal(confirmationRequirement({ toolName: 'terminal.exec', source: local, enabled: true, prefixes }).required, false)
  assert.equal(confirmationRequirement({ toolName: 'mobile_pair_url', source: remote, enabled: true, prefixes }).required, false)
  assert.deepEqual(
    confirmationRequirement({ toolName: 'terminal.exec', source: remote, enabled: false, prefixes }),
    { required: false, reason: 'disabled' },
  )
})

test('hardening: the body cap refuses an oversized body while reading it', async () => {
  assert.deepEqual(await readLimitedBody({ body: 'x'.repeat(10) }, 16), { ok: true, text: 'xxxxxxxxxx' })
  assert.deepEqual(await readLimitedBody({ body: 'x'.repeat(17) }, 16), { ok: false, code: 'too-large' })

  const stream = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('a'.repeat(10), 'utf8')
      yield Buffer.from('b'.repeat(10), 'utf8')
    },
  }
  assert.equal((await readLimitedBody(stream, 32)).ok, true)
  const small = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('a'.repeat(10), 'utf8')
      yield Buffer.from('b'.repeat(10), 'utf8')
    },
  }
  assert.deepEqual(await readLimitedBody(small, 12), { ok: false, code: 'too-large' })
  // No body stream at all is an empty body, not an error.
  assert.deepEqual(await readLimitedBody({}, 8), { ok: true, text: '' })
})

test('gate: a confirmation is approved once, consumed once, and never by a non-allow answer', async () => {
  // Short default wait: the first round below stays unanswered on purpose.
  const approval = new ApprovalService({ secret: SECRET_BYTES, timeoutMs: 200 })
  // `cooldownMs: 0` — the rate bound is exercised by its own test below.
  const gate = new SecondConfirmationGate(approval, { cooldownMs: 0 })

  const first = gate.request({ toolName: 'pluginManager.device.revoke' })
  assert.equal(gate.consume(first.id), false, 'nothing is approved before an answer')
  const denied = gate.request({ toolName: 'terminal.exec' })
  approval.answer({ id: denied.id, t: denied.pending.token, word: 'deny' })
  assert.equal(await denied.wait, false)
  assert.equal(gate.consume(denied.id), false)

  const allowed = gate.request({ toolName: 'terminal.exec' })
  approval.answer({ id: allowed.id, t: allowed.pending.token, word: 'allow' })
  assert.equal(await allowed.wait, true)
  assert.equal(gate.isApproved(allowed.id), true)
  assert.equal(gate.consume(allowed.id), true, 'first redemption')
  assert.equal(gate.consume(allowed.id), false, 'and never a second one')
})

/**
 * Mount the plugin against a stub host (fence always admits).
 *
 * @param config - composition config overrides.
 * @returns the route table, audit lines and a request helper.
 */
function mount(config = {}) {
  const routes = new Map()
  const auditLines = []
  const pushed = []
  // The push hook must never reach the network from a test: stub it and keep
  // what the phone would have received.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    pushed.push(String(init?.body ?? ''))
    return { ok: true, status: 200 }
  }
  after(() => {
    globalThis.fetch = originalFetch
  })
  const services = {
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    connection: { admit: () => ({ peer: { id: 'operator' } }), authenticatedUrl: (base) => base },
    webRuntime: { trustedHosts: [AUTHORITY] },
    credentials: { readRecord: async () => ({ kind: 'grant', payload: { version: 1, secret: SECRET } }) },
    approval: { config: { policy: 'ask' } },
    tools: { register: () => () => {} },
  }
  const ctx = {
    ...services,
    get: (name) => services[name],
    effect: (fn) => { const d = fn(); return () => d?.() },
    on: () => () => {},
    inject: (_names, callback) => { callback(ctx); return () => {} },
    logger: { info: (line) => auditLines.push(String(line)), warn: () => {}, error: () => {} },
  }
  apply(ctx, { pairingAuthority: AUTHORITY, pushTopic: 'dsmr-test', approvalTimeoutMs: 400, auditLog: true, ...config })

  return {
    auditLines,
    pushed,
    auditRecords: () => auditLines.filter((line) => line.startsWith('{"ts"')).map((line) => JSON.parse(line)),
    async request({ method = 'GET', url, headers = {}, remoteAddress = '127.0.0.1', body } = {}) {
      const path = String(url ?? '/').split('?')[0]
      const route = routes.get(path)
      assert.ok(route, `route ${path} is not registered`)
      const chunks = []
      let status = 0
      let outHeaders = {}
      const res = {
        writeHead(code, responseHeaders) { status = code; outHeaders = responseHeaders ?? {}; return this },
        end(payload) { if (payload !== undefined && payload !== null) chunks.push(String(payload)) },
      }
      route.handler({ method, url, headers, socket: { remoteAddress }, body }, res)
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
      return { status, headers: outHeaders, body: chunks.join('') }
    },
  }
}

const REMOTE = { remoteAddress: '127.0.0.1' }
const REMOTE_HEADERS = { 'x-forwarded-for': '100.64.0.2' }

test('routes: register issues a device cookie with the shipped attributes, then state accepts it', async () => {
  const harness = mount()
  await settle()

  const registered = await harness.request({ method: 'POST', url: '/mobile-remote/device/register', headers: {}, body: '{"label":"phone-A"}' })
  assert.equal(registered.status, 200)
  const cookie = registered.headers['set-cookie']
  assert.match(cookie, /^dsmr-device-[0-9a-f]{16}=v1\./)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  assert.match(cookie, /Path=\//)
  assert.ok(!/Secure/.test(cookie), 'the shipped cookie is deliberately not Secure (loopback HTTP)')
  assert.equal(registered.headers['cache-control'], 'no-store')

  const name = deviceCookieName(AUTHORITY)
  const value = /^([^=]+)=([^;]+)/.exec(cookie)[2]
  const state = await harness.request({ url: '/mobile-remote/state', headers: { cookie: `${name}=${value}` } })
  assert.equal(state.status, 200)
  const table = JSON.parse(state.body)
  assert.equal(table.devices.length, 1)
  assert.equal(table.devices[0].label, 'phone-A')
  assert.ok(!JSON.stringify(table).includes(value), 'the state view never echoes the grant')
})

test('routes: a remote revocation needs a redeemed confirmation, and only then takes effect', async () => {
  const harness = mount()
  await settle()
  const name = deviceCookieName(AUTHORITY)

  const registers = []
  for (const label of ['phone-A', 'phone-B']) {
    registers.push(await harness.request({ method: 'POST', url: '/mobile-remote/device/register', headers: {}, body: `{"label":"${label}"}` }))
  }
  const cookieOf = (registered) => `${name}=${/^([^=]+)=([^;]+)/.exec(registered.headers['set-cookie'])[2]}`
  const aCookie = cookieOf(registers[0])
  const bCookie = cookieOf(registers[1])
  const aId = JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie: aCookie } })).body).devices[0].id
  const bId = JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie: bCookie } })).body).devices[1].id

  // Remote caller, no confirmation: refused, and a round is minted for the phone.
  const refused = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: { ...REMOTE_HEADERS, cookie: aCookie },
    body: JSON.stringify({ deviceId: aId }),
    ...REMOTE,
  })
  assert.equal(refused.status, 403)
  assert.equal(refused.body, 'forbidden')
  assert.ok(harness.auditRecords().some((record) => record.result === 'confirm-required'), 'a confirmation round was opened')

  // The phone sees the round in the pending table (and via the push link); the
  // id is a UUID, which the audit deliberately redacts.
  const pendingState = JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie: aCookie } })).body)
  assert.equal(pendingState.pending.length, 1)
  assert.ok(!('token' in pendingState.pending[0]), 'the pending view never carries the token')
  const confirmationId = pendingState.pending[0].id
  assert.ok(harness.pushed.some((body) => body.includes(confirmationId)), 'the push carries the same round')

  // An unanswered confirmation id is worthless.
  const bogus = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: { ...REMOTE_HEADERS, cookie: aCookie, 'x-dsmr-confirm': '00000000-0000-4000-8000-000000000000' },
    body: JSON.stringify({ deviceId: aId }),
    ...REMOTE,
  })
  assert.equal(bogus.status, 403)

  // The phone answers the round through the pushed one-time link …
  const link = /\/mobile-remote\/decide\?[^\s]+/.exec(harness.pushed[0])[0]
  const answered = await harness.request({ url: `${link}&w=allow` })
  assert.equal(answered.status, 200)

  // … and only then does the same request (with the redeemed id) take effect.
  const redeemed = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: { ...REMOTE_HEADERS, cookie: aCookie, 'x-dsmr-confirm': confirmationId },
    body: JSON.stringify({ deviceId: bId }),
    ...REMOTE,
  })
  assert.equal(redeemed.status, 200)
  assert.equal(JSON.parse(redeemed.body).revoked, bId)

  // B is revoked: its grant no longer opens the state route even though the
  // fence would admit it. A is untouched.
  const bAfter = await harness.request({ url: '/mobile-remote/state', headers: { cookie: bCookie } })
  assert.equal(bAfter.status, 403, 'a revoked device is refused, never rescued by the fence')
  assert.equal(bAfter.body, 'forbidden')
  const aAfter = await harness.request({ url: '/mobile-remote/state', headers: { cookie: aCookie } })
  assert.equal(aAfter.status, 200, 'the other device is unaffected')

  // A redeemed confirmation is spent: it cannot authorize a second action.
  const replay = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: { ...REMOTE_HEADERS, cookie: aCookie, 'x-dsmr-confirm': confirmationId },
    body: JSON.stringify({ deviceId: aId }),
    ...REMOTE,
  })
  assert.equal(replay.status, 403)
  assert.equal(JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie: aCookie } })).body).devices.length, 2)

  // Local revocation skips the gate entirely (the operator is at the machine).
  const localRevoke = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: { cookie: aCookie },
    body: JSON.stringify({ deviceId: aId }),
  })
  assert.equal(localRevoke.status, 200)
  assert.equal(JSON.parse(localRevoke.body).revoked, aId)
})

test('routes: an oversized body is refused with 413 before it is parsed', async () => {
  const harness = mount({ maxBodyBytes: 64 })
  await settle()
  const answer = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: {},
    body: JSON.stringify({ deviceId: 'x'.repeat(200) }),
  })
  assert.equal(answer.status, 413)
  assert.equal(answer.body, 'payload too large')
  assert.ok(harness.auditRecords().some((record) => record.result === 'body-too-large'))
})

test('sanitizer: a 29-character bare token no longer survives (F6 regression)', () => {
  const short = 'tok-ABCDEFGHIJKLMNOPQRSTUVWXY'
  assert.equal(short.length, 29, 'the regression value is 29 characters, under the old 32 floor')
  const line = `boom ${short} ?token=${short}`
  const cleaned = redact(line)
  assert.ok(!cleaned.includes(short), 'the bare token must not survive')
  assert.match(cleaned, /<redacted>/)
  // A 24-character run is covered too, and a dotted authority is not mangled.
  assert.match(redact('x'.repeat(24)), /<redacted>/)
  assert.equal(redact(AUTHORITY), AUTHORITY)
})

// ---------------------------------------------------------------------------
// t29 regressions (t14 findings F1 / F2 / F5).
// ---------------------------------------------------------------------------

test('F1 (t29): a forwarded request is remote even when the XFF claims loopback', async () => {
  // The leftmost entry is the *client-controlled* one; a loopback-shaped value
  // must never buy a local classification (t14 measured the bypasses).
  const forged = classifySource({ source: '127.0.0.1', socketPeer: '127.0.0.1', viaForwarded: true })
  assert.equal(forged.remote, true, 'a forwarded request is remote, period')
  assert.equal(forged.basis, 'proxied')
  // A `Forwarded:`-only proxy shape carries no address but is still forwarded.
  const forwardedOnly = classifySource(
    { source: '127.0.0.1', socketPeer: '127.0.0.1', viaForwarded: false },
    { forwarded: 'for=100.64.0.9;proto=https' },
  )
  assert.equal(forwardedOnly.remote, true, 'Forwarded without XFF is not local')
  // The genuine local operator hits the loopback without any forwarding header.
  const local = classifySource({ source: '127.0.0.1', socketPeer: '127.0.0.1', viaForwarded: false }, {})
  assert.equal(local.remote, false)

  // End to end: a remote caller forging a loopback XFF still needs confirmation.
  const harness = mount()
  await settle()
  const name = deviceCookieName(AUTHORITY)
  const registered = await harness.request({ method: 'POST', url: '/mobile-remote/device/register', headers: {}, body: '{"label":"phone-A"}' })
  const cookie = `${name}=${/^([^=]+)=([^;]+)/.exec(registered.headers['set-cookie'])[2]}`
  const deviceId = JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie } })).body).devices[0].id

  const forgedAnswer = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/revoke',
    headers: { 'x-forwarded-for': '127.0.0.1', cookie },
    body: JSON.stringify({ deviceId }),
    remoteAddress: '127.0.0.1',
  })
  assert.equal(forgedAnswer.status, 403, 'the forged loopback shape must not skip the gate')
  assert.equal(forgedAnswer.body, 'forbidden')
  assert.ok(harness.auditRecords().some((record) => record.result === 'confirm-required'))
})

test('F2 (t29): re-registering a revoked device cannot revive it', async () => {
  // Kernel level: `register` keeps `revokedAt` and the fresh token stays invalid.
  const registry = new DeviceRegistry({ secret: SECRET_BYTES, limit: 8 })
  const issued = registry.register('phone-A')
  registry.revoke(issued.device.id)
  const reissued = registry.register('phone-A', { deviceId: issued.device.id })
  assert.equal(registry.verify(reissued.token).code, 'revoked', 'a reissue is not an amnesty')
  assert.equal(registry.isRevoked(issued.device.id), true)
  // Explicit, separate reversal does work.
  assert.equal(registry.unrevoke(issued.device.id), true)
  assert.equal(registry.verify(reissued.token).ok, true)

  // Route level: the operator path gets 409 unless it asks for the reversal.
  const harness = mount()
  await settle()
  const name = deviceCookieName(AUTHORITY)
  const registered = await harness.request({ method: 'POST', url: '/mobile-remote/device/register', headers: {}, body: '{"label":"phone-A"}' })
  const cookie = `${name}=${/^([^=]+)=([^;]+)/.exec(registered.headers['set-cookie'])[2]}`
  const deviceId = JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie } })).body).devices[0].id
  assert.equal((await harness.request({ method: 'POST', url: '/mobile-remote/device/revoke', headers: { cookie }, body: JSON.stringify({ deviceId }) })).status, 200)

  const blindReissue = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/register',
    headers: {},
    body: JSON.stringify({ deviceId }),
  })
  assert.equal(blindReissue.status, 409, 'naming a revoked id must not resurrect it')
  assert.equal(JSON.parse(blindReissue.body).code, 'device-revoked')
  const stillRevoked = await harness.request({ url: '/mobile-remote/state', headers: {} })
  assert.equal(JSON.parse(stillRevoked.body).devices[0].revokedAt !== undefined, true, 'the revocation record survives')
})

test('F2 (t29): only the local operator can unrevoke, and the reversal is audited', async () => {
  const harness = mount()
  await settle()
  const name = deviceCookieName(AUTHORITY)
  const registered = await harness.request({ method: 'POST', url: '/mobile-remote/device/register', headers: {}, body: '{"label":"phone-A"}' })
  const cookie = `${name}=${/^([^=]+)=([^;]+)/.exec(registered.headers['set-cookie'])[2]}`
  const deviceId = JSON.parse((await harness.request({ url: '/mobile-remote/state', headers: { cookie } })).body).devices[0].id
  await harness.request({ method: 'POST', url: '/mobile-remote/device/revoke', headers: { cookie }, body: JSON.stringify({ deviceId }) })

  // Remote: refused, even with the explicit flag.
  const remote = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/register',
    headers: { 'x-forwarded-for': '100.64.0.2' },
    body: JSON.stringify({ deviceId, unrevoke: true }),
    remoteAddress: '127.0.0.1',
  })
  assert.equal(remote.status, 403)
  assert.equal(remote.body, 'forbidden')
  assert.ok(harness.auditRecords().some((record) => record.result === 'unrevoke-remote-refused'))

  // Local operator (fence path — a revoked device's own cookie must not be the
  // thing that authorizes its restoration): allowed, audited, credential works.
  const local = await harness.request({
    method: 'POST',
    url: '/mobile-remote/device/register',
    headers: {},
    body: JSON.stringify({ deviceId, unrevoke: true }),
  })
  assert.equal(local.status, 200)
  assert.ok(harness.auditRecords().some((record) => record.result === 'device-unrevoked'))
  const fresh = `${name}=${/^([^=]+)=([^;]+)/.exec(local.headers['set-cookie'])[2]}`
  assert.equal((await harness.request({ url: '/mobile-remote/state', headers: { cookie: fresh } })).status, 200)
})

test('F5 (t29): the confirmation gate stops minting at the pending-pressure ceiling', async () => {
  const approval = new ApprovalService({ secret: SECRET_BYTES, timeoutMs: 60_000 })
  // One live round is the whole budget: the next request must be refused without
  // minting (the point is that a flood cannot push the table to its eviction edge).
  const gate = new SecondConfirmationGate(approval, { maxPendingRounds: 1 })
  const first = gate.request({ toolName: 'pluginManager.device.revoke' })
  assert.ok(first !== undefined)
  assert.equal(gate.request({ toolName: 'pluginManager.device.revoke' }), undefined, 'no round beyond the ceiling')
  assert.equal(gate.throttledCount(), 1)

  // Answer the live round: pressure drops, minting resumes.
  approval.answer({ id: first.id, t: first.pending.token, word: 'deny' })
  assert.equal(await first.wait, false)
  assert.ok(gate.request({ toolName: 'pluginManager.device.revoke' }) !== undefined, 'recovered once the table drains')
})

test('F5 (t29): an optional time cooldown is available and off by default', () => {
  const approval = new ApprovalService({ secret: SECRET_BYTES, timeoutMs: 60_000 })
  let clock = 1_000_000
  const gate = new SecondConfirmationGate(approval, { cooldownMs: 5000, now: () => clock })
  assert.ok(gate.request({ toolName: 'terminal.exec' }) !== undefined)
  assert.equal(gate.request({ toolName: 'terminal.exec' }), undefined, 'inside the cooldown')
  assert.equal(gate.throttledCount(), 1)
  clock += 6000
  assert.ok(gate.request({ toolName: 'terminal.exec' }) !== undefined)
})
