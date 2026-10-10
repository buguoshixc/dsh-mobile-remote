/**
 * T9/P3 tests — the approval responder, the closed vocabulary, and the one-time
 * decision link (`node --test`).
 *
 * Everything here runs the **real wiring**: `apply()` from `src/index.ts` mounts
 * against a stub host context whose `credentials` service returns the shipped
 * 32-byte browser-session record, so the test drives the same code path the
 * composition does — the waterfall listener, the approval service and the
 * `/mobile-remote/decide` handler are all the shipped ones.
 *
 * What is covered (contract order): the four refusal classes of the decision
 * link (bad signature / tampered / expired / replayed), the id-unknown case, the
 * timeout ⇒ `unavailable` path, `next()` for requests this plugin does not own,
 * and the vocabulary mapping into the shipped service's outcome words.
 *
 * @module dsh-mobile-remote/test/host-approval
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { ApprovalService } from '../src/approval.ts'
import { decisionTtlOf, resolveConfig } from '../src/config.ts'
import { decisionKey, signDecision } from '../src/decision.ts'
import { apply } from '../src/index.ts'

const AUTHORITY = 'demo.tailnet-example.ts.net'
/** The 32-byte secret in the clear: exactly what the credential record decodes to. */
const SECRET_BYTES = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
/** The same secret in the record's stored form (base64url). */
const SECRET = SECRET_BYTES.toString('base64url')

/** Let the asynchronous credential load settle (generous: the suite runs in parallel). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250))

/**
 * Poll a condition instead of racing a fixed sleep: the suite runs every file in
 * parallel, so wall-clock delays are not a synchronization primitive.
 *
 * @param predicate - the condition to wait for.
 * @param timeoutMs - how long to wait before giving up.
 * @returns true when the predicate held within the budget.
 */
async function until(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

/**
 * Re-aim one decide link at a single word, **replacing** the word it carries.
 *
 * Since t33 a minted link carries `&w=allow` of its own and the route reads the
 * first `w`, so appending a different word no longer overrides it (t33).
 *
 * @param path - a decide path.
 * @param word - the decision word; the empty string removes it.
 * @returns the same path carrying exactly that word.
 */
function withWord(path, word) {
  const url = new URL(`http://local.invalid${path}`)
  if (word === '') url.searchParams.delete('w')
  else url.searchParams.set('w', word)
  return `${url.pathname}${url.search}`
}

/**
 * Mount the plugin against a stub host and return its observable surface.
 *
 * @param config - composition config overrides.
 * @returns routes, listeners, the audit lines and the requests helper.
 */
function mount(config = {}) {
  const routes = new Map()
  const listeners = new Map()
  const auditLines = []
  const warnLines = []
  const services = {
    webServer: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`)
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    connection: {
      admit: () => ({ peer: { id: 'operator' } }),
      authenticatedUrl: (base) => `${base}?token=launch-token`,
    },
    webRuntime: { trustedHosts: [AUTHORITY] },
    credentials: { readRecord: async () => ({ kind: 'grant', payload: { version: 1, secret: SECRET } }) },
    approval: { config: { policy: 'ask' } },
    tools: { register: () => () => {} },
  }
  const ctx = {
    ...services,
    get: (name) => services[name],
    effect: (fn) => {
      const disposer = fn()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => list.splice(list.indexOf(listener), 1)
    },
    inject: (_names, callback) => {
      callback(ctx)
      return () => {}
    },
    logger: {
      info: (line) => auditLines.push(String(line)),
      error: () => {},
      debug: () => {},
      warn: (line) => warnLines.push(String(line)),
    },
  }
  // A short default wait: a test that leaves a request unanswered must not keep
  // the process alive with a two-minute timer.
  const resolved = { pairingAuthority: AUTHORITY, pushTopic: '', approvalTimeoutMs: 3000, auditLog: true, ...config }
  apply(ctx, resolved)

  return {
    routes,
    listeners,
    auditLines,
    warnLines,
    auditRecords: () => auditLines.filter((line) => line.startsWith('{"ts"')).map((line) => JSON.parse(line)),
    /** One HTTP exchange against a registered route. */
    async request({ method = 'GET', url, headers = {}, remoteAddress = '127.0.0.1', body } = {}) {
      const path = String(url ?? '/').split('?')[0]
      const route = routes.get(path)
      assert.ok(route, `route ${path} is not registered`)
      const chunks = []
      let status = 0
      let outHeaders = {}
      const res = {
        writeHead(code, responseHeaders) {
          status = code
          outHeaders = responseHeaders ?? {}
          return this
        },
        end(payload) {
          if (payload !== undefined && payload !== null) chunks.push(String(payload))
        },
      }
      route.handler({ method, url, headers, socket: { remoteAddress }, body }, res)
      // revoke/register handlers are async; give them a few event-loop turns.
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
      return { status, headers: outHeaders, body: chunks.join('') }
    },
  }
}

/**
 * The approval listener this plugin registered.
 *
 * Waits for it instead of trusting a fixed sleep: the kernel is installed from
 * an asynchronous credential read, so under parallel load the mount can settle
 * later than any fixed delay.
 *
 * @param harness - the mounted harness.
 * @returns the registered listener.
 */
async function responderOf(harness) {
  const registered = await until(() => (harness.listeners.get('approval/request')?.length ?? 0) === 1)
  assert.ok(registered, `exactly one approval/request responder; warns: ${harness.warnLines.join(' | ')}`)
  return harness.listeners.get('approval/request')[0]
}

/** Pull the decision link out of the push message (the phone's own path). */
function linkOf(pushed) {
  const match = /(\/mobile-remote\/decide\?[^\s]+)/.exec(pushed)
  assert.ok(match, `no decision link in the push payload: ${pushed}`)
  return match[1]
}

test('responder: a request it can describe opens a decision; one it cannot is handed to next()', async () => {
  const harness = mount()
  await settle()
  const responder = await responderOf(harness)

  // Not our shape: next() is the only acceptable answer.
  let asked = 0
  const handed = responder({ hello: 'world' }, () => {
    asked += 1
    return 'next-value'
  })
  assert.equal(handed, 'next-value', 'a foreign request must be passed straight through')
  assert.equal(asked, 1)

  // Our shape: a pending decision is created and the listener waits.
  const pending = responder({ toolName: 'shell.exec', reason: '运行脚本' }, () => 'next-value')
  assert.equal(typeof pending?.then, 'function', 'the responder must await the decision')
  const state = await harness.request({ url: '/mobile-remote/state', headers: {} })
  const body = JSON.parse(state.body)
  assert.equal(body.pending.length, 1, 'the decision is visible in the pending table')
  assert.equal(body.pending[0].subject, 'shell.exec')
  assert.ok(!('token' in body.pending[0]), 'the pending view never carries the token')
})

test('decide: a verified answer settles as allowed-once and the link then fails as used', async () => {
  const pushed = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    pushed.push(String(init?.body ?? ''))
    return { ok: true, status: 200 }
  }
  try {
    const harness = mount({ pushTopic: 'dsmr-test' })
    await settle()
    const responder = await responderOf(harness)
    const answerPromise = responder({ toolName: 'shell.exec', reason: '运行脚本' }, () => 'next-value')
    assert.ok(await until(() => pushed.length === 1), 'the decision link is pushed once')
    const link = linkOf(pushed[0])
    const first = await harness.request({ url: `${link}&w=allow`, headers: {} })
    assert.equal(first.status, 200)
    assert.match(first.body, /allow/)
    assert.equal(first.headers['cache-control'], 'no-store')
    assert.equal(await answerPromise, 'allowed-once', 'allow maps to the service grant word')

    // Replay: the same link twice must fail, exactly like every other refusal.
    const replay = await harness.request({ url: `${link}&w=allow`, headers: {} })
    assert.equal(replay.status, 403)
    assert.equal(replay.body, 'forbidden')

    // The audit never carries the token, and never the query string.
    for (const line of harness.auditLines) {
      assert.ok(!line.includes('&t='), `audit leaked the token: ${line}`)
      assert.ok(!line.includes('?'), `audit kept a query string: ${line}`)
    }
    const records = harness.auditRecords()
    assert.ok(records.some((record) => record.result === 'decide-ok' && record.status === 200))
    assert.ok(records.some((record) => record.result === 'decide-used' && record.status === 403))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('decide: tampered and unknown links are refused without leaking anything', async () => {
  const pushed = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    pushed.push(String(init?.body ?? ''))
    return { ok: true, status: 200 }
  }
  try {
    const harness = mount({ pushTopic: 'dsmr-test' })
    await settle()
    const responder = await responderOf(harness)
    void responder({ toolName: 'shell.exec' }, () => 'next-value')
    assert.ok(await until(() => pushed.length === 1), 'the decision link is pushed')
    const link = linkOf(pushed[0])
    const url = new URL(`http://127.0.0.1${link}`)
    const id = url.searchParams.get('d')
    const token = url.searchParams.get('t')
    assert.ok(id && token)

    const refused = []
    // One character of the signature flipped — deliberately the **first** one, not
    // the last. A base64url group's final character carries padding bits, so
    // flipping it can leave the decoded bytes identical and the verdict `malformed`
    // rather than `bad-signature`: a ~1-in-64 flake this suite had been carrying
    // (t33). Flipping the leading character always changes the digest.
    const signatureAt = token.lastIndexOf('.') + 1
    const flipped = `${token.slice(0, signatureAt)}${token[signatureAt] === 'A' ? 'B' : 'A'}${token.slice(signatureAt + 1)}`
    refused.push(await harness.request({ url: `/mobile-remote/decide?d=${id}&t=${flipped}&w=allow`, headers: {} }))
    // A well-signed link for an id that was never issued: refused as unknown.
    const unknownId = '00000000-0000-4000-8000-000000000000'
    const unknownToken = signDecision(decisionKey(SECRET_BYTES), { version: 1, id: unknownId, expiresAt: Date.now() + 60_000 })
    refused.push(await harness.request({ url: `/mobile-remote/decide?d=${unknownId}&t=${unknownToken}&w=allow`, headers: {} }))

    for (const answer of refused) {
      assert.equal(answer.status, 403)
      assert.equal(answer.body, 'forbidden', 'refusals share one body')
      assert.ok(!answer.body.includes(id), 'a refusal never names the decision')
      assert.ok(!answer.body.includes(token), 'a refusal never carries the token')
    }
    const results = harness.auditRecords().map((record) => record.result)
    assert.ok(results.includes('decide-bad-signature'), `expected a signature refusal, saw ${results.join(',')}`)
    assert.ok(results.includes('decide-unknown'), `expected an unknown-id refusal, saw ${results.join(',')}`)
    assert.ok(!results.includes('decide-ok'), 'no refusal may be recorded as a decision')

    // Missing parameters are the contract's 400, not a 403 oracle.
    const missing = await harness.request({ url: '/mobile-remote/decide', headers: {} })
    assert.equal(missing.status, 400)
    const noMethod = await harness.request({ url: `/mobile-remote/decide?d=${id}&t=${token}`, method: 'POST', headers: {} })
    assert.equal(noMethod.status, 405)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('decide: an expired link is refused, and the responder keeps waiting (never allow)', async () => {
  const pushed = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    pushed.push(String(init?.body ?? ''))
    return { ok: true, status: 200 }
  }
  try {
    // Link lifetime deliberately shorter than the approval wait.
    const harness = mount({ pushTopic: 'dsmr-test', decisionTtlMs: 30, approvalTimeoutMs: 300 })
    await settle()
    const responder = await responderOf(harness)
    const answerPromise = responder({ toolName: 'shell.exec' }, () => 'next-value')
    assert.ok(await until(() => pushed.length === 1), 'the decision link is pushed')
    const link = linkOf(pushed[0])
    await new Promise((resolve) => setTimeout(resolve, 120))

    const expired = await harness.request({ url: `${link}&w=allow`, headers: {} })
    assert.equal(expired.status, 403)
    assert.equal(expired.body, 'forbidden')
    assert.ok(harness.auditRecords().some((record) => record.result === 'decide-expired'))
    // An expired link decides nothing: the request is still in flight, and its
    // own timeout then resolves `unavailable` — never an implicit allow.
    assert.equal(typeof answerPromise.then, 'function')
    assert.equal(await answerPromise, 'unavailable')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('decide: the vocabulary is closed — a garbage word never becomes an allow', async () => {
  const pushed = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    pushed.push(String(init?.body ?? ''))
    return { ok: true, status: 200 }
  }
  try {
    const harness = mount({ pushTopic: 'dsmr-test' })
    await settle()
    const responder = await responderOf(harness)
    const answerPromise = responder({ toolName: 'shell.exec' }, () => 'next-value')
    assert.ok(await until(() => pushed.length === 1), 'the decision link is pushed')
    const link = linkOf(pushed[0])

    const answer = await harness.request({ url: withWord(link, 'FROBNICATE'), headers: {} })
    assert.equal(answer.status, 200, 'a verified link is a decision even with a garbage word')
    assert.equal(await answerPromise, 'unavailable', 'and that decision is unavailable, not allow')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('responder: a timeout resolves unavailable and audits the timeout', async () => {
  const harness = mount({ approvalTimeoutMs: 30 })
  await settle()
  const responder = await responderOf(harness)
  const answer = await responder({ toolName: 'shell.exec' }, () => 'next-value')
  assert.equal(answer, 'unavailable', 'a timeout is never an implicit allow')
  assert.ok(harness.auditRecords().some((record) => record.result === 'timeout'))
})

test('decide: with no credential secret the whole P3 surface fails closed (503, no listener)', async () => {
  const routes = new Map()
  const listeners = new Map()
  const services = {
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    connection: { admit: () => ({ peer: {} }), authenticatedUrl: (base) => base },
    webRuntime: { trustedHosts: [AUTHORITY] },
    credentials: { readRecord: async () => undefined },
    tools: { register: () => () => {} },
  }
  const ctx = {
    ...services,
    get: (name) => services[name],
    effect: (fn) => fn(),
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return () => {}
    },
    inject: (_names, callback) => callback(ctx),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  apply(ctx, { pairingAuthority: AUTHORITY, approvalTimeoutMs: 1000, auditLog: true })
  await settle()

  assert.equal(listeners.get('approval/request'), undefined, 'no responder without a secret')
  const route = routes.get('/mobile-remote/decide')
  assert.ok(route)
  let status = 0
  let body = ''
  route.handler({ method: 'GET', url: '/mobile-remote/decide?d=x&t=y&w=allow', headers: {}, socket: {} }, {
    writeHead(code) { status = code; return this },
    end(payload) { body = String(payload ?? '') },
  })
  assert.equal(status, 503, 'fail closed, not a silent allow')
  assert.equal(body, 'decision links unavailable')
})

// ---------------------------------------------------------------------------
// t29 / F4 regression: the unsigned settlement path is gone.
// ---------------------------------------------------------------------------

test('F4 (t29): no unverified settlement path exists', async () => {
  const approval = new ApprovalService({ secret: SECRET_BYTES, timeoutMs: 5000 })
  assert.equal('settleFromGui' in approval, false, 'the unsigned allow path must be deleted')
  assert.equal(typeof approval.answer, 'function')

  // The only ways to settle are a verified link and the timeout.
  const { pending, wait } = approval.ask({ summary: 'x' })
  const forged = approval.answer({ id: pending.id, t: 'v1.forged.signature', word: 'allow' })
  assert.notEqual(forged.code, 'ok', 'a forged link decides nothing')
  const raced = await Promise.race([
    wait.then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('waiting'), 80)),
  ])
  assert.equal(raced, 'waiting', 'the wait is still open after a forged answer')
})

// ---------------------------------------------------------------------------
// P7 (t28) — the push path, measured against a REAL HTTP receiver.
//
// t4's F1 was a non-ASCII request header: `fetch` threw while building the
// request, the hook degraded it to one warn line, and every other test stayed
// green while the phone never received anything. Nothing here stubs `fetch`:
// the assertion is that bytes arrived at a real `node:http` server.
// ---------------------------------------------------------------------------

test('push (E2E): a real HTTP receiver gets the bytes — ASCII headers, readable body', async () => {
  const received = []
  const receiver = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
  })
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve))
  const port = receiver.address().port
  try {
    const harness = mount({ pushTopic: `http://127.0.0.1:${port}/dsh-approval` })
    await settle()
    const responder = await responderOf(harness)
    void responder({ toolName: 'shell.exec', reason: '运行脚本' }, () => 'next-value')

    assert.ok(
      await until(() => received.length === 1),
      `the receiver got no request; plugin warns: ${harness.warnLines.join(' | ')}`,
    )
    const hit = received[0]
    assert.equal(hit.method, 'POST')
    // Every header value must be ByteString-safe (code points 0x20–0x7e here);
    // an ntfy title in Chinese is what made undici throw before the fix.
    for (const [name, value] of Object.entries(hit.headers)) {
      assert.ok(/^[\x20-\x7e]*$/.test(String(value)), `header ${name} is not ASCII-safe: ${value}`)
    }
    assert.match(hit.headers.title, /^[\x20-\x7e]+$/, 'the title header must be readable ASCII')
    assert.match(String(hit.headers.title), /dsh/i)
    // The non-ASCII content belongs in the body, where the phone can read it.
    assert.match(hit.body, /运行脚本/)
    assert.match(hit.body, /\/mobile-remote\/decide\?d=[0-9a-f-]{36}&t=/)
  } finally {
    await new Promise((resolve) => receiver.close(resolve))
  }
})

test('push (E2E): an unreachable receiver only warns — the wait still ends unavailable', async () => {
  const probe = createServer(() => {})
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const deadPort = probe.address().port
  await new Promise((resolve) => probe.close(resolve))

  const harness = mount({ pushTopic: `http://127.0.0.1:${deadPort}/push`, approvalTimeoutMs: 300 })
  await settle()
  const answer = await (await responderOf(harness))({ toolName: 'shell.exec' }, () => 'next-value')

  assert.equal(answer, 'unavailable', 'a failed push must never become an allow')
  assert.ok(harness.warnLines.some((line) => line.includes('approval push failed')), 'the failure is reported')
  assert.ok(harness.auditRecords().some((record) => record.result === 'timeout'))
})

test('push: an empty pushTopic never touches the network', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, status: 200 }
  }
  try {
    const harness = mount({ pushTopic: '', approvalTimeoutMs: 300 })
    await settle()
    const answer = await (await responderOf(harness))({ toolName: 'shell.exec' }, () => 'next-value')
    assert.equal(calls, 0, 'the push subsystem is switched off')
    assert.equal(answer, 'unavailable', 'and the wait is still fail-closed')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ── t33 regressions: the link that is minted, and the config that reaches the kernel ──

test('t33: the minted decision link carries its own word and round-trips to allow', async () => {
  const approval = new ApprovalService({ secret: SECRET_BYTES, timeoutMs: 5000 })
  const { pending, wait } = approval.ask({ summary: 'probe' })
  const url = new URL(`http://local.invalid${pending.decidePath}`)

  assert.equal(url.pathname, '/mobile-remote/decide')
  assert.equal(url.searchParams.get('w'), 'allow', 'the link must carry its decision word (t33)')

  // Exactly the call the decide route makes when the pushed URL is opened verbatim.
  const outcome = approval.answer({
    id: url.searchParams.get('d'),
    t: url.searchParams.get('t'),
    word: url.searchParams.get('w'),
  })
  assert.equal(outcome.code, 'ok')
  assert.equal(outcome.word, 'allow', 'opening the minted link must allow, never settle unavailable')
  assert.equal((await wait).word, 'allow', 'and the waiter the caller is holding sees the allow')
})

test('t33: a pending round does not hold the event loop open', () => {
  const seen = []
  const approval = new ApprovalService({
    secret: SECRET_BYTES,
    timeoutMs: 60_000,
    // The injection seam the suite had never used — it is what makes timer
    // hygiene observable at all.
    setTimer: (fn, ms) => {
      const handle = setTimeout(fn, ms)
      const record = { handle, unrefCalled: false }
      seen.push(record)
      const original = handle.unref.bind(handle)
      handle.unref = () => {
        record.unrefCalled = true
        return original()
      }
      return handle
    },
  })
  approval.ask({ summary: 'probe' })
  assert.equal(seen.length, 1, 'one round, one timer')
  assert.equal(seen[0].unrefCalled, true, "the round timer must be unref'd, or a stray round pins the process")
  clearTimeout(seen[0].handle)
})

test('t33: a non-Node timer handle is still cleared when the round is answered', () => {
  const cleared = []
  const originalClear = globalThis.clearTimeout
  globalThis.clearTimeout = (handle) => {
    cleared.push(handle)
    return originalClear(handle)
  }
  try {
    const approval = new ApprovalService({
      secret: SECRET_BYTES,
      timeoutMs: 60_000,
      // A browser-style opaque handle has no `unref`; the old guard read that
      // absence as "not a timer" and skipped the clear, so an answered round could
      // still emit a `timeout` audit event later (t33).
      setTimer: () => 'opaque-handle',
    })
    const { pending } = approval.ask({ summary: 'probe' })
    assert.equal(approval.answer({ id: pending.id, t: pending.token, word: 'deny' }).code, 'ok')
    assert.deepEqual(cleared, ['opaque-handle'], 'the handle must be cleared whatever its type')
  } finally {
    globalThis.clearTimeout = originalClear
  }
})

test('t33: config values the kernel rejects are coerced before they reach it', () => {
  const defaults = resolveConfig({})
  assert.equal(defaults.approvalTimeoutMs, 120000)
  assert.equal(defaults.deviceGrantTtlMs, 2592000000)

  // `Schema.natural()` is `.min(0)`, so every one of these is schema-legal and
  // every one of them used to reach a constructor that throws.
  assert.equal(resolveConfig({ approvalTimeoutMs: 0 }).approvalTimeoutMs, 120000)
  assert.equal(resolveConfig({ approvalTimeoutMs: -1 }).approvalTimeoutMs, 120000)
  assert.equal(resolveConfig({ approvalTimeoutMs: 1.5 }).approvalTimeoutMs, 120000)
  assert.equal(resolveConfig({ deviceGrantTtlMs: 0 }).deviceGrantTtlMs, 2592000000)

  // A usable value is still honoured, plain or behind an accessor.
  assert.equal(resolveConfig({ approvalTimeoutMs: 3000 }).approvalTimeoutMs, 3000)
  assert.equal(resolveConfig({ approvalTimeoutMs: { get: () => 4000 } }).approvalTimeoutMs, 4000)

  // A typo must not switch the second-confirmation gate off.
  const frozen = ['terminal.', 'credentials.', 'pluginManager.']
  assert.deepEqual(resolveConfig({ riskyToolPrefixes: 'terminal.' }).riskyToolPrefixes, frozen)
  assert.deepEqual(resolveConfig({ riskyToolPrefixes: [] }).riskyToolPrefixes, frozen)
  assert.deepEqual(resolveConfig({ riskyToolPrefixes: ['terminal.'] }).riskyToolPrefixes, ['terminal.'])

  // A link must never outlive the wait it decides.
  assert.equal(decisionTtlOf({ ...defaults, decisionTtlMs: 600000, approvalTimeoutMs: 1000 }), 1000)
  assert.equal(decisionTtlOf({ ...defaults, decisionTtlMs: 30, approvalTimeoutMs: 300 }), 30)
  assert.equal(decisionTtlOf({ ...defaults, decisionTtlMs: 0, approvalTimeoutMs: 300 }), 300)
})
