/**
 * T10 acceptance — independent verification of the T9 hardening surface
 * (docs/06-hardening-contract.md). Written by the verifier: it drives the
 * **built artifact** (`lib/index.js`) through stub services and real HTTP, and
 * reads only externally observable results — status codes, bodies, headers,
 * Set-Cookie values, captured push payloads and audit lines. No implementer
 * assertion is reused as evidence.
 *
 * Groups (one per acceptance criterion):
 *   1. full-surface regression + the frozen P1 pair behaviour
 *   2. approval fail-closed (no channel / empty topic / timeout) + `never` log
 *      (c) is also the F1 re-verification: real `node:http` receiver, real bytes,
 *      exactly one push, ASCII-safe headers, the decision link in the body
 *   3. decision link: once-only, four refusals, off-vocabulary normalisation
 *   4. device revocation isolation (A revoked, B fine, rotate, no fence fallback)
 *   5. source classification + remote second confirmation
 *   6. adversarial set (concurrency, timeout boundary, table races, header
 *      injection, confirmation bypass attempts)
 *   7. assembly-level fail-closed (an unreadable credential secret)
 *   8. the confirmation gate is rate-bounded (F5: a flood is refused without
 *      minting a new round)
 *
 * t29 semantics pinned here: a **forwarded** request is always remote (F1 — a
 * loopback-shaped `X-Forwarded-For`, duplicated or RFC 7239 `Forwarded:` included,
 * must not skip the gate), a revoked device id is **not** re-issued blindly (F2 —
 * 409 `device-revoked`; un-revoking is explicit, audited and local-only).
 *
 * Every link-driven test runs **two independent paths**: `linkFrom(push)` (the
 * bytes that really left the process, end-to-end) and `mintLink()` (the
 * verifier's own HKDF+HMAC over the id/expiry the state route exposes, which
 * exercises the decision mechanism with the push channel switched off entirely).
 *
 * @module dsh-mobile-remote/test/acceptance-hardening
 */
import assert from 'node:assert/strict'
import { createHmac, hkdfSync } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = await import(pathToFileURL(join(repoRoot, 'lib', 'index.js')).href)

/**
 * Every server/sink this file opens is closed here, so a failing assertion can
 * never leave a listening socket behind (which would hang the whole file).
 */
const openResources = new Set()
afterEach(async () => {
  const resources = [...openResources]
  openResources.clear()
  await Promise.allSettled(resources.map((resource) => resource.close()))
})

const AUTHORITY = 'demo.tailnet-example.ts.net'
const TOKEN = 'ACCEPTANCE-TOKEN-0123456789abcdef'
const FENCE_COOKIE = 'dsh-auth-acceptance=v1.acceptance'
/** 32 random bytes as base64url — the shape client-connection stores (docs/06 §2). */
const SECRET = Buffer.from(
  'e2f8b7c6a5d4938271605f4e3d2c1b0a99887766554433221100ffeeddccbbaa',
  'hex',
).toString('base64url')

/**
 * The shipped fence's decision order, kept **equivalent** to T6's copy
 * (`test/acceptance-t6.test.mjs`) and to the evidence (:205-219, :586-594).
 *
 * This copy used to stop after the trusted-host check, which meant every
 * conclusion drawn here was drawn against a fence weaker than the real one: a
 * `sec-fetch-site: cross-site` or foreign-`Origin` regression in the plugin could
 * not fail any assertion in this file (t33). The two checks and the test below
 * keep the copies from drifting apart again.
 */
function shippedRule(req, { trustedHosts = [AUTHORITY] } = {}) {
  const headers = req.headers ?? {}
  const hostHeader = headers['host']
  if (hostHeader === undefined) return { rejection: 403 }
  let hostUrl
  try {
    hostUrl = new URL(`http://${hostHeader}`)
  } catch {
    return { rejection: 403 }
  }
  const name = hostUrl.hostname
  const loopback = name === 'localhost' || name === '[::1]' || /^127\./.test(name)
  const trusted = trustedHosts.some((entry) => {
    try {
      return new URL(`http://${entry}`).host === hostUrl.host
    } catch {
      return false
    }
  })
  if (!loopback && !trusted) return { rejection: 403 }
  if (headers['sec-fetch-site'] === 'cross-site') return { rejection: 403 }
  const origin = headers['origin']
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== hostUrl.host) return { rejection: 403 }
    } catch {
      return { rejection: 403 }
    }
  }
  const cookie = String(headers['cookie'] ?? '')
  return cookie.includes(FENCE_COOKIE) ? { peer: { id: 'operator' } } : { rejection: 401 }
}

/** Mount the real host half over stub services; returns every captured surface. */
function mountPlugin({ config = {}, devices, approval, credentials: credentialsOverride } = {}) {
  const routes = []
  const tools = []
  const effects = []
  const logLines = []
  const listeners = new Map()
  const credentials = credentialsOverride ?? {
    payload: { version: 1, secret: SECRET },
    readRecord() {
      return { payload: { version: 1, secret: SECRET } }
    },
    getRecord() {
      return { payload: { version: 1, secret: SECRET } }
    },
    modifyRecord(_key, updater) {
      return updater({ payload: { version: 1, secret: SECRET } })
    },
  }
  const services = {
    webServer: {
      register: (route) => {
        if (routes.some((entry) => entry.kind === route.kind && entry.path === route.path)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        }
        routes.push(route)
        return () => routes.splice(routes.indexOf(route), 1)
      },
    },
    connection: {
      admit: (req) => shippedRule(req),
      authenticatedUrl: (base) => `${base}?token=${TOKEN}`,
    },
    webRuntime: { trustedHosts: [AUTHORITY] },
    credentials,
    tools: {
      register: (tool) => {
        tools.push(tool)
        return () => tools.splice(tools.indexOf(tool), 1)
      },
    },
    ...(approval === undefined ? {} : { approval }),
  }
  const ctx = {
    ...services,
    effect: (fn) => {
      const dispose = fn()
      effects.push(dispose)
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    get: (serviceName) => services[serviceName],
    logger: {
      info: (line) => logLines.push(String(line)),
      warn: (line) => logLines.push(`WARN ${String(line)}`),
      error: (line) => logLines.push(`ERROR ${String(line)}`),
    },
    inject: (_names, callback) => {
      // The real cordis inject callback receives a scoped context carrying every
      // service plus `on`/`get`/`effect`; the hardening assembly registers the
      // approval responder and the push hook inside that scope, so the stub must
      // hand over the full context or those surfaces stay silently absent.
      callback({ ...ctx })
      return () => {}
    },
  }
  host.apply(ctx, host.Config({ pairingAuthority: AUTHORITY, ...config }))
  return { routes, tools, logLines, listeners, devices }
}

/** One macrotask — the plugin's hardening assembly finishes on a later tick. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** Poll a predicate; throws with a label when it never becomes true. */
async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const wiringDone = (mounted) =>
  mounted.logLines.some(
    (line) => line.includes('approval responder registered') || line.includes('security ready'),
  )

/** Mount, then wait until the responder/push wiring is observable in the log. */
async function mountReady(options) {
  const mounted = mountPlugin(options)
  await waitFor(() => wiringDone(mounted), 'the hardening wiring')
  return mounted
}

/** Serve the captured route table on an ephemeral loopback port. */
async function serve(routes) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://local.invalid').pathname
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      route.handler(req, res)
    } catch {
      if (!res.headersSent) {
        res.writeHead(400)
        res.end()
      }
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const handle = {
    port: server.address().port,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
  openResources.add(handle)
  return handle
}

/** One HTTP request against a test server. `raw` sends a hand-built request line. */
const call = (port, path, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers }, agent: false },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    request.on('error', reject)
    if (body !== undefined) request.write(body)
    request.end()
  })

/** A raw TCP exchange, so header values Node would reject can still be attempted. */
function rawCall(port, requestText) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.setTimeout(3000, () => socket.destroy(new Error('raw socket timeout')))
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8')
    })
    socket.on('error', reject)
    socket.on('close', () => resolve(data))
    socket.write(requestText)
  })
}

/** An ntfy-like endpoint that records every push body it receives. */
async function startPushSink() {
  const pushes = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      pushes.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200)
      res.end('ok')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const handle = {
    url: `http://127.0.0.1:${server.address().port}/topic`,
    pushes,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
  openResources.add(handle)
  return handle
}

/**
 * Mint a decision link ourselves from a pending round's `id`/`expiresAt`.
 *
 * This is the verifier's own HKDF + HMAC implementation of the documented token
 * (`v1.<base64url(JSON{version,id,expiresAt})>.<base64url(HMAC-SHA256)>`, salt
 * `dsh-mobile-remote`, info `dsh-mobile-remote/decision-link/v1`) — the same
 * shapes the state route exposes. It gives the link tests a second, completely
 * independent path: one that never touches the push transport, so the decision
 * mechanism is exercised even if the notification channel is off.
 *
 * @param round - a pending row carrying `id` and `expiresAt`.
 * @returns `{id, token, path}`, the same shape `linkFrom()` returns.
 */
function mintLink({ id, expiresAt }) {
  const key = Buffer.from(
    hkdfSync('sha256', Buffer.from(SECRET, 'base64url'), Buffer.from('dsh-mobile-remote', 'utf8'), Buffer.from('dsh-mobile-remote/decision-link/v1', 'utf8'), 32),
  )
  const body = Buffer.from(JSON.stringify({ version: 1, id, expiresAt }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', key).update(body).digest('base64url')
  const token = `v1.${body}.${signature}`
  return { id, token, path: `/mobile-remote/decide?d=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}` }
}

/** Read the pending rounds the state route exposes (the body carries no tokens). */
async function listPending(port) {
  const response = await call(port, '/mobile-remote/state', {
    headers: { host: AUTHORITY, cookie: FENCE_COOKIE },
  })
  assert.equal(response.status, 200, `state must be readable locally, got ${response.status}: ${response.body}`)
  return JSON.parse(response.body).pending ?? []
}

/** Every pending id right now, so the round a later action opens can be told apart. */
async function pendingIds(port) {
  return new Set((await listPending(port)).map((entry) => entry.id))
}

/**
 * Wait for a pending round outside `exclude`, then mint its link. The id and
 * expiry come from the running plugin's own state route, never from a push body.
 */
async function pendingLink(port, { exclude = new Set(), timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const entry = (await listPending(port)).find((row) => !exclude.has(row.id))
    if (entry !== undefined) return { entry, link: mintLink(entry) }
    if (Date.now() > deadline) throw new Error('no pending round appeared on the state route')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Wait until push #index has arrived, then return it (pushes are fire-and-forget). */
async function waitForPush(sink, index = 0) {
  await waitFor(() => sink.pushes.length > index, `push #${index}`)
  return sink.pushes[index]
}

/** Wait for the push that follows `before`, then return it — index-stable. */
async function nextPush(sink, before) {
  await waitFor(() => sink.pushes.length > before, `the push after #${before}`)
  return sink.pushes[before]
}

/** Pull the `d`/`t` pair out of a captured push body. */
function linkFrom(push) {
  const match = /\/mobile-remote\/decide\?([^\s]+)/.exec(push.body)
  assert.ok(match, `push body must carry the decision link, got: ${push.body}`)
  const params = new URLSearchParams(match[1])
  return { id: params.get('d'), token: params.get('t'), path: `/mobile-remote/decide?${match[1]}` }
}

/**
 * Re-aim one link at a single word, **replacing** the word the link carries.
 *
 * Since t33 a minted/pushed link carries `&w=allow` of its own, and the route
 * reads the *first* `w`. Appending `&w=deny` to such a link therefore no longer
 * changes the decision — it has to be set. Keeping this explicit is the point:
 * which word a link decides with is a property of the link, not of what a test
 * appends.
 *
 * @param path - a decide path from `linkFrom`/`mintLink`.
 * @param word - the word to decide with; the empty string removes it entirely.
 * @returns the same path with exactly that word.
 */
function withWord(path, word) {
  const url = new URL(`http://local.invalid${path}`)
  if (word === '') url.searchParams.delete('w')
  else url.searchParams.set('w', word)
  return `${url.pathname}${url.search}`
}

/** Ask the responder for one decision and return a function resolving its outcome. */
function openRound(listeners, payload = { toolName: 'terminal.exec', sessionId: 's1' }) {
  const listener = listeners.get('approval/request')
  assert.equal(
    typeof listener,
    'function',
    'the responder must be registered on approval/request (mountReady should have waited for the wiring)',
  )
  const settled = Promise.resolve(listener(payload, () => 'delegated'))
  settled.catch(() => {})
  return settled
}

const SERVICE_WORDS = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable'])

// ── 1. full-surface regression + frozen P1 pair behaviour ────────────────────

test('regression: five exact routes, one tool, and the P1 pair response stays byte-identical', async () => {
  const mounted = await mountReady()
  assert.equal(mounted.routes.length, 5, 'pair + decide + state + device/revoke + device/register')
  assert.deepEqual(
    mounted.routes.map((route) => route.path).sort(),
    [
      '/mobile-remote/decide',
      '/mobile-remote/device/register',
      '/mobile-remote/device/revoke',
      '/mobile-remote/pair',
      '/mobile-remote/state',
    ],
  )
  assert.ok(mounted.routes.every((route) => route.kind === 'exact'))
  assert.equal(mounted.tools.length, 1, 'exactly one tool is registered')

  const server = await serve(mounted.routes)
  try {
    const refused = await call(server.port, '/mobile-remote/pair', { headers: { host: AUTHORITY } })
    assert.equal(refused.status, 401)
    assert.equal(refused.body, 'unauthorized')
    assert.equal(refused.headers['cache-control'], 'no-store')

    const ok = await call(server.port, '/mobile-remote/pair', {
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE },
    })
    assert.equal(ok.status, 200)
    assert.deepEqual(Object.keys(JSON.parse(ok.body)).sort(), ['authority', 'expiresAt', 'url'])
    assert.equal(JSON.parse(ok.body).authority, AUTHORITY)
    assert.match(JSON.parse(ok.body).url, /^https:\/\/demo\.tailnet-example\.ts\.net\/\?token=/)
  } finally {
    await server.close()
  }
})

// ── 2. approval fail-closed ──────────────────────────────────────────────────

test('approval: no push channel, empty topic and a timeout all end in unavailable (never allow)', async () => {
  // (a) empty pushTopic, no decision made → the wait must time out to unavailable.
  {
    const mounted = await mountReady({ config: { pushTopic: '', approvalTimeoutMs: 120 } })
    const outcome = await openRound(mounted.listeners)
    assert.equal(outcome, 'unavailable', 'an unanswered round must fail closed')
    assert.equal(outcome === 'allowed-once', false)
    assert.ok(
      mounted.logLines.some((line) => line.includes('推送') || line.includes('approval responder')),
      'an empty topic must be logged, not silently ignored',
    )
  }
  // (b) a push channel that cannot be reached → still unavailable.
  {
    const dead = await serve([]) // an ephemeral port with no route: pushes will 404/fail
    const mounted = await mountReady({
      config: { pushTopic: `http://127.0.0.1:${dead.port}/topic`, approvalTimeoutMs: 120 },
    })
    const outcome = await openRound(mounted.listeners)
    assert.equal(outcome, 'unavailable')
    await dead.close()
  }
  // (c) a working channel but nobody answers → the push really leaves the process,
  //     then the round times out to unavailable.
  {
    const sink = await startPushSink()
    const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 400 } })
    const outcome = openRound(mounted.listeners)
    // F1 re-verification, on the verifier's own receiver: the bytes must arrive.
    const delivered = await waitForPush(sink, 0)
    assert.equal(sink.pushes.length, 1, 'exactly one push per round')
    const title = String(delivered.headers.title ?? '')
    assert.match(title, /^[\x20-\x7e]+$/, `the title header must be ByteString-safe ASCII, got ${JSON.stringify(title)}`)
    for (const [name, value] of Object.entries(delivered.headers)) {
      assert.match(String(value), /^[\x20-\x7e]*$/, `header ${name} must be ASCII-safe too`)
    }
    assert.match(String(delivered.headers['content-type'] ?? ''), /text\/plain/)
    assert.match(delivered.body, /\/mobile-remote\/decide\?d=/, 'the body carries the decision link')
    assert.match(delivered.body, /t=v1\./, 'the body carries the v1 token')
    assert.equal(await outcome, 'unavailable', 'an unanswered round must fail closed')
    assert.equal(sink.pushes.length, 1, 'still exactly one push after the round settled')
    // Raw evidence for the report: the exact bytes the verifier's receiver saw.
    console.log(
      `[T10] push received by the verifier receiver: ${JSON.stringify({
        title,
        contentType: delivered.headers['content-type'],
        body: delivered.body,
      })}`,
    )
    assert.equal(
      mounted.logLines.some((line) => line.includes('approval push failed')),
      false,
      'no push failure may be logged once the header encoding is fixed',
    )
    await sink.close()
  }
})

test('approval: a `never` session policy is reported loudly instead of failing silently', async () => {
  const mounted = await mountReady({ approval: { config: { policy: 'never' } } })
  const warned = mounted.logLines.filter((line) => line.startsWith('WARN') && line.includes('never'))
  assert.equal(warned.length, 1, `expected exactly one never-policy warning, got: ${JSON.stringify(mounted.logLines)}`)
  assert.ok(warned[0].includes('ask'), 'the warning must name the remedy (policy ask)')
})

// ── 3. decision link: once-only, four refusals, vocabulary ───────────────────

test('decide: one link decides once, tampering/unknown/expired/missing are all refused', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 4000, decisionTtlMs: 0 } })
  const server = await serve(mounted.routes)
  try {
    // — path 1: the link the phone actually receives (the bytes off the wire) —
    const before = sink.pushes.length
    const round = openRound(mounted.listeners)
    const pushed = linkFrom(await nextPush(sink, before))
    assert.match(pushed.path, /^\/mobile-remote\/decide\?d=.+&t=.+$/, 'the push carries a decide path')
    assert.match(pushed.token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'the token keeps the v1 shape')

    const first = await call(server.port, `${pushed.path}&w=allow`)
    assert.equal(first.status, 200)
    assert.match(first.body, /<strong>allow<\/strong>/, 'the page reports the normalised word')
    assert.equal(await round, 'allowed-once')

    const replay = await call(server.port, `${pushed.path}&w=allow`)
    assert.equal(replay.status, 403, 'the same link must not decide twice')
    assert.equal(replay.body, 'forbidden')

    // — path 2: a link the verifier minted itself from the state route —
    const other = openRound(mounted.listeners)
    const minted = await pendingLink(server.port)
    const mintedFirst = await call(server.port, `${minted.link.path}&w=deny`)
    assert.equal(mintedFirst.status, 200, `a self-minted link must decide: ${mintedFirst.body}`)
    assert.match(mintedFirst.body, /<strong>deny<\/strong>/, 'the page reports the normalised word')
    assert.equal(await other, 'rejected')

    const mintedReplay = await call(server.port, `${minted.link.path}&w=deny`)
    assert.equal(mintedReplay.status, 403, 'a self-minted link is single-use too')

    // — tampered signature —
    const tampered = minted.link.token.slice(0, -2) + (minted.link.token.endsWith('A') ? 'BB' : 'AA')
    const badSig = await call(server.port, `/mobile-remote/decide?d=${minted.link.id}&t=${tampered}&w=allow`)
    assert.equal(badSig.status, 403)

    // — unknown id (a real signature attached to another id) —
    const unknown = await call(server.port, `/mobile-remote/decide?d=nope-${minted.link.id}&t=${minted.link.token}&w=allow`)
    assert.equal(unknown.status, 403)

    // — missing parameters —
    const missing = await call(server.port, '/mobile-remote/decide?d=&t=')
    assert.equal(missing.status, 400)

    // — wrong method —
    const wrongMethod = await call(server.port, `${minted.link.path}&w=allow`, { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
  } finally {
    await server.close()
    await sink.close()
  }

  // — expired: (a) the verifier signs a payload whose expiry is already past —
  {
    const expiring = await mountReady({ config: { approvalTimeoutMs: 500 } }) // no push channel at all
    const expiringServer = await serve(expiring.routes)
    try {
      const expiringRound = openRound(expiring.listeners)
      const stale = await pendingLink(expiringServer.port)
      const backdated = mintLink({ id: stale.entry.id, expiresAt: Date.now() - 1000 })
      const expired = await call(expiringServer.port, `${backdated.path}&w=allow`)
      assert.equal(expired.status, 403, 'a payload whose expiry has passed is refused')
      // (b) the round still has to end in a service word, and never as an allow.
      const late = await expiringRound
      assert.ok(SERVICE_WORDS.has(late), `the round must end in a service word, got ${late}`)
      assert.equal(late === 'allowed-once', false, 'an expired link must never allow')
    } finally {
      await expiringServer.close()
    }
  }

  // — expired: (b) a link the plugin issued with a short ttl, waited past it —
  {
    const shortSink = await startPushSink()
    const expiring = await mountReady({ config: { pushTopic: shortSink.url, approvalTimeoutMs: 700, decisionTtlMs: 100 } })
    const expiringServer = await serve(expiring.routes)
    try {
      const expiringRound = openRound(expiring.listeners)
      const expiringLink = linkFrom(await waitForPush(shortSink, 0))
      await new Promise((resolve) => setTimeout(resolve, 250))
      const expired = await call(expiringServer.port, `${expiringLink.path}&w=allow`)
      assert.equal(expired.status, 403, 'a link past its issued ttl is refused')
      const late = await expiringRound
      assert.equal(late === 'allowed-once', false, 'a stale link must never allow')
      assert.ok(SERVICE_WORDS.has(late), `the round must end in a service word, got ${late}`)
    } finally {
      await expiringServer.close()
      await shortSink.close()
    }
  }
})

test('decide: off-vocabulary words normalise to unavailable, deny/cancel keep their words', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 3000 } })
  const server = await serve(mounted.routes)
  const cases = [
    { word: 'yes', expected: 'unavailable', page: 'unavailable' },
    { word: 'Allow ', expected: 'unavailable', page: 'unavailable' },
    { word: '<script>alert(1)</script>', expected: 'unavailable', page: 'unavailable' },
    { word: 'deny', expected: 'rejected', page: 'deny' },
    { word: 'cancel', expected: 'cancelled', page: 'cancel' },
  ]
  // An empty word is deliberately **not** in this table any more: since t33 a
  // word-less link is refused with 400 *without* consuming the capability, so it
  // no longer fits this helper's "200 + normalised page" shape. That branch is
  // pinned by "t33: a decide link with no word is refused without consuming the
  // capability" at the end of this file.
  /** Open one round, decide it with `entry.word` using the link `obtain` returns. */
  const decide = async (entry, obtain) => {
    const before = sink.pushes.length
    const round = openRound(mounted.listeners)
    const link = await obtain(before)
    const answered = await call(server.port, withWord(link.path, entry.word))
    assert.equal(
      answered.status,
      200,
      `word ${JSON.stringify(entry.word)} must be answerable: ${answered.status} ${answered.body}`,
    )
    assert.equal(await round, entry.expected, `word ${JSON.stringify(entry.word)} normalises wrong`)
    // The page reports the *normalised* word, so an off-vocabulary answer is
    // never echoed back verbatim (and cannot reflect markup into the phone).
    assert.match(answered.body, new RegExp(`<strong>${entry.page}</strong>`))
    if (entry.word.length > 0 && entry.word !== entry.page) {
      assert.equal(
        answered.body.includes(entry.word),
        false,
        `the raw answer ${JSON.stringify(entry.word)} must not be reflected`,
      )
    }
  }
  try {
    // — path 1: the link delivered by the real push —
    for (const entry of cases) await decide(entry, async (before) => linkFrom(await nextPush(sink, before)))
    // — path 2: the verifier's own mint off the state route —
    for (const entry of cases) await decide(entry, async () => (await pendingLink(server.port)).link)
  } finally {
    await server.close()
    await sink.close()
  }
})

// ── 4. device revocation isolation ───────────────────────────────────────────

/** Register one device and return its cookie pair. */
async function registerDevice(port, label) {
  const response = await call(port, '/mobile-remote/device/register', {
    method: 'POST',
    headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  assert.equal(response.status, 200, `register ${label} must succeed: ${response.body}`)
  const body = JSON.parse(response.body)
  const setCookie = [response.headers['set-cookie']].flat().filter(Boolean)
  const deviceCookie = setCookie.find((value) => value.startsWith('dsmr-device-'))
  assert.ok(deviceCookie, `register must set a device cookie, got: ${JSON.stringify(setCookie)}`)
  assert.ok(deviceCookie.includes('HttpOnly') && deviceCookie.includes('SameSite=Strict'))
  return { id: body.device.id, cookie: deviceCookie.split(';')[0] }
}

test('devices: revoking A leaves B working, rotation invalidates everyone, no fence fallback', async () => {
  const mounted = await mountReady()
  const server = await serve(mounted.routes)
  const state = (cookie) =>
    call(server.port, '/mobile-remote/state', { headers: { host: AUTHORITY, cookie } })
  try {
    const a = await registerDevice(server.port, 'phone-A')
    const b = await registerDevice(server.port, 'phone-B')
    assert.notEqual(a.id, b.id, 'each registration is its own device')

    assert.equal((await state(a.cookie)).status, 200)
    assert.equal((await state(b.cookie)).status, 200)
    const listed = JSON.parse((await state(a.cookie)).body)
    assert.equal(listed.ok, true)
    assert.equal(listed.devices.length, 2)
    assert.equal(JSON.stringify(listed).includes(SECRET), false, 'no secret may appear in state')
    assert.equal(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{20,}/.test(JSON.stringify(listed)), false, 'no v1 token in state')

    // Local source (no X-Forwarded-For): no second confirmation is required.
    const revoked = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: a.id }),
    })
    assert.equal(revoked.status, 200)
    assert.deepEqual(JSON.parse(revoked.body), { ok: true, revoked: a.id })

    assert.equal((await state(a.cookie)).status, 403, 'A is revoked')
    assert.equal((await state(b.cookie)).status, 200, 'B must be untouched by A revocation')

    // A revoked device must not fall back to the fence cookie it also presents.
    const bothCookies = await call(server.port, '/mobile-remote/state', {
      headers: { host: AUTHORITY, cookie: `${a.cookie}; ${FENCE_COOKIE}` },
    })
    assert.equal(bothCookies.status, 403, 'a revoked credential never falls back to the fence')

    // — F2 (t29): re-issuing a revoked id must not resurrect it, and reversal is
    //   an explicit, audited, local-only action (t14 measured the pre-fix silent
    //   un-revoke: 200 + a fresh credential, `revokedAt` back to null). —
    const reissue = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone-A-reissued', deviceId: a.id }),
    })
    assert.equal(reissue.status, 409, 'a revoked id is not re-issued blindly')
    assert.deepEqual(JSON.parse(reissue.body), { ok: false, code: 'device-revoked' })
    assert.equal((await state(a.cookie)).status, 403, 'and A stays revoked')

    const remoteUnrevoke = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: {
        host: AUTHORITY,
        cookie: FENCE_COOKIE,
        'x-forwarded-for': '203.0.113.7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ label: 'phone-A-remote', deviceId: a.id, unrevoke: true }),
    })
    assert.equal(remoteUnrevoke.status, 403, 'a remote caller may never un-revoke')
    assert.ok(
      mounted.logLines.some((line) => line.includes('unrevoke-remote-refused')),
      'and the refusal is audited as unrevoke-remote-refused',
    )
    assert.equal((await state(a.cookie)).status, 403, 'A is still revoked after the remote attempt')

    const localUnrevoke = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone-A-local', deviceId: a.id, unrevoke: true }),
    })
    assert.equal(localUnrevoke.status, 200, 'the local operator can reverse a revocation explicitly')
    assert.ok(
      mounted.logLines.some((line) => line.includes('device-unrevoked')),
      'and that reversal is audited as device-unrevoked',
    )
    const reissued = [localUnrevoke.headers['set-cookie']]
      .flat()
      .find((value) => value?.startsWith('dsmr-device-'))
      ?.split(';')[0]
    assert.ok(reissued, 'an explicit un-revoke issues a fresh credential')
    assert.equal((await state(reissued)).status, 200, 'the re-issued credential works')
    assert.equal((await state(a.cookie)).status, 200, 'the un-revoked device is usable again')

    // Rotation invalidates every live credential (re-registration recovers).
    const rotated = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ rotate: true }),
    })
    assert.equal(rotated.status, 200)
    assert.equal(typeof JSON.parse(rotated.body).rotated, 'number')
    assert.equal((await state(b.cookie)).status, 401, 'B is invalidated by rotation')
    assert.equal((await state(FENCE_COOKIE)).status, 200, 'the fence cookie still admits locally')

    const unknown = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'not-a-device' }),
    })
    assert.equal(unknown.status, 404)
  } finally {
    await server.close()
  }
})

// ── 5. source classification + remote second confirmation ───────────────────

test('source: leftmost X-Forwarded-For wins, and a remote caller needs the confirmation round', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 3000 } })
  const server = await serve(mounted.routes)
  const auditSources = () =>
    mounted.logLines
      .filter((line) => line.includes('mobile-remote/'))
      .map((line) => {
        try {
          return JSON.parse(line).source
        } catch {
          return undefined
        }
      })
      .filter(Boolean)
  try {
    const remote = { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }
    const register = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: { ...remote, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone-C' }),
    })
    assert.equal(register.status, 200)
    const deviceId = JSON.parse(register.body).device.id

    assert.ok(auditSources().includes('203.0.113.7'), `leftmost XFF must be the source: ${auditSources()}`)

    // First remote revoke: refused, and an approval round is opened (pushed).
    const pushesBefore = sink.pushes.length
    const gated = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    })
    assert.equal(gated.status, 403, 'a remote revoke must be gated')
    assert.equal(gated.body, 'forbidden')
    const confirmationPush = await nextPush(sink, pushesBefore)
    assert.equal(sink.pushes.length, pushesBefore + 1, 'the confirmation round must be pushed to the phone')
    assert.ok(
      mounted.logLines.some((line) => line.includes('confirm-required')),
      'the audit must record confirm-required',
    )

    // — path 1: redeeming the pushed link with `allow` yields a one-time id —
    const link = linkFrom(confirmationPush)
    const approval = await call(server.port, `${link.path}&w=allow`)
    assert.equal(approval.status, 200)

    const confirmed = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'x-dsmr-confirm': link.id, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    })
    assert.equal(confirmed.status, 200, `a redeemed confirmation must authorise the revoke: ${confirmed.body}`)
    assert.deepEqual(JSON.parse(confirmed.body), { ok: true, revoked: deviceId })

    // The confirmation id is single-use: a different device cannot reuse it.
    const secondDevice = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: { ...remote, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone-D' }),
    })
    const secondId = JSON.parse(secondDevice.body).device.id
    const replayed = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'x-dsmr-confirm': link.id, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: secondId }),
    })
    assert.equal(replayed.status, 403, 'a confirmation id is consumed exactly once')

    // — path 2: a confirmation round decided with the verifier's own minted link —
    const active = await pendingIds(server.port)
    const secondGate = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: secondId }),
    })
    assert.equal(secondGate.status, 403, 'the second remote revoke is gated too')
    const minted = await pendingLink(server.port, { exclude: active })
    assert.equal((await call(server.port, `${minted.link.path}&w=allow`)).status, 200)
    const confirmedSecond = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'x-dsmr-confirm': minted.entry.id, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: secondId }),
    })
    assert.equal(confirmedSecond.status, 200, `a self-minted confirmation must authorise too: ${confirmedSecond.body}`)
    assert.deepEqual(JSON.parse(confirmedSecond.body), { ok: true, revoked: secondId })

    // A local caller (no XFF) is never asked for a confirmation — asserted with
    // the same action, on a third device, on this very server.
    const thirdDevice = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone-L' }),
    })
    const thirdId = JSON.parse(thirdDevice.body).device.id
    const localRevoke = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: thirdId }),
    })
    assert.equal(localRevoke.status, 200, 'a local source is never mis-gated')
  } finally {
    await server.close()
    await sink.close()
  }

  // The gate is driven by the configurable risky-prefix list, not by a blanket
  // "remote is always refused": with `pluginManager.` dropped from the list the
  // very same remote revoke goes straight through.
  {
    const prefixMount = await mountReady({ config: { riskyToolPrefixes: ['terminal.', 'credentials.'] } })
    const prefixServer = await serve(prefixMount.routes)
    try {
      const target = await registerDevice(prefixServer.port, 'phone-H')
      const direct = await call(prefixServer.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: {
          host: AUTHORITY,
          cookie: FENCE_COOKIE,
          'x-forwarded-for': '203.0.113.7',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ deviceId: target.id }),
      })
      assert.equal(direct.status, 200, `without the pluginManager. prefix the remote revoke is ungated: ${direct.body}`)
    } finally {
      await prefixServer.close()
    }
  }
})

// ── 6. adversarial set ───────────────────────────────────────────────────────

test('adversarial: concurrent decisions on one id — exactly one wins', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 3000 } })
  const server = await serve(mounted.routes)
  /** Fire `count` simultaneous decisions at one link and summarise the statuses. */
  const race = async (link, count) => {
    const attempts = await Promise.all(
      Array.from({ length: count }, () => call(server.port, `${link.path}&w=allow`)),
    )
    const statuses = attempts.map((entry) => entry.status)
    return {
      statuses,
      ok: attempts.filter((entry) => entry.status === 200),
      refused: attempts.filter((entry) => entry.status === 403),
    }
  }
  try {
    // — path 1: the pushed link —
    const before = sink.pushes.length
    const round = openRound(mounted.listeners)
    const pushed = linkFrom(await nextPush(sink, before))
    const pushedRace = await race(pushed, 8)
    assert.equal(
      pushedRace.ok.length,
      1,
      `exactly one concurrent decision may win, got ${pushedRace.ok.length} of ${JSON.stringify(pushedRace.statuses)}`,
    )
    assert.equal(pushedRace.refused.length, 7)
    assert.equal(await round, 'allowed-once')

    // — path 2: a self-minted link (same guarantee without the push transport) —
    const other = openRound(mounted.listeners)
    const minted = await pendingLink(server.port)
    const mintedRace = await race(minted.link, 8)
    assert.equal(
      mintedRace.ok.length,
      1,
      `exactly one concurrent decision may win on a minted link, got ${mintedRace.ok.length} of ${JSON.stringify(mintedRace.statuses)}`,
    )
    assert.equal(mintedRace.refused.length, 7)
    assert.equal(await other, 'allowed-once')
  } finally {
    await server.close()
    await sink.close()
  }
})

test('adversarial: the timeout boundary never produces an allow', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 400 } })
  const server = await serve(mounted.routes)
  try {
    // Inside the window (push path): honoured.
    let before = sink.pushes.length
    const early = openRound(mounted.listeners)
    const earlyLink = linkFrom(await nextPush(sink, before))
    assert.equal((await call(server.port, `${earlyLink.path}&w=allow`)).status, 200)
    assert.equal(await early, 'allowed-once', 'a decision inside the window is honoured')

    // Past the deadline (push path): the round settles first, the link is then
    // refused — asserted exactly, not as "one of two acceptable statuses".
    before = sink.pushes.length
    const late = openRound(mounted.listeners)
    const lateLink = linkFrom(await nextPush(sink, before))
    const lateOutcome = await late
    assert.equal(lateOutcome, 'unavailable', 'a round past its deadline fails closed')
    const tooLate = await call(server.port, `${lateLink.path}&w=allow`)
    assert.equal(tooLate.status, 403, `a link whose round is over must be refused: ${tooLate.status} ${tooLate.body}`)

    // At the boundary (mint path): a payload the verifier signed with an expiry
    // already in the past is refused, and the round still ends fail-closed.
    const boundary = openRound(mounted.listeners)
    const pending = await pendingLink(server.port)
    const backdated = mintLink({ id: pending.entry.id, expiresAt: Date.now() - 1 })
    const atBoundary = await call(server.port, `${backdated.path}&w=allow`)
    assert.equal(atBoundary.status, 403, `a token at or past its expiry is refused: ${atBoundary.status}`)
    const boundaryOutcome = await boundary
    assert.equal(boundaryOutcome === 'allowed-once', false, 'the boundary must never produce an allow')
    assert.equal(boundaryOutcome, 'unavailable')
  } finally {
    await server.close()
    await sink.close()
  }
})

test('adversarial: device table races — parallel registers stay consistent and bounded', async () => {
  const mounted = await mountReady({ config: { deviceTableLimit: 3 } })
  const server = await serve(mounted.routes)
  try {
    const registered = await Promise.all(
      Array.from({ length: 5 }, (_entry, index) => registerDevice(server.port, `bulk-${index}`)),
    )
    assert.equal(new Set(registered.map((entry) => entry.id)).size, 5, 'every register gets its own id')
    const listed = JSON.parse(
      (await call(server.port, '/mobile-remote/state', { headers: { host: AUTHORITY, cookie: FENCE_COOKIE } })).body,
    )
    assert.ok(listed.devices.length <= 3, `the table must respect deviceTableLimit, got ${listed.devices.length}`)
    // The two oldest registrations were evicted, so their credentials are unknown.
    const evicted = await call(server.port, '/mobile-remote/state', {
      headers: { host: AUTHORITY, cookie: registered[0].cookie },
    })
    assert.equal(evicted.status, 401, 'an evicted device credential is refused, never silently accepted')
  } finally {
    await server.close()
  }
})

test('adversarial: X-Forwarded-For with CRLF, multiple values and empty items', async () => {
  const mounted = await mountReady()
  const server = await serve(mounted.routes)
  const sources = () =>
    mounted.logLines
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return undefined
        }
      })
      .filter((entry) => entry !== undefined)
      .map((entry) => entry.source)
  try {
    // Multi-value with empty items: the leftmost non-empty item wins.
    await call(server.port, '/mobile-remote/state', {
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': ' , ,  198.51.100.9' },
    })
    assert.ok(sources().includes('198.51.100.9'), `leftmost non-empty item expected: ${sources()}`)

    // Whitespace-only header: falls back to the socket peer.
    await call(server.port, '/mobile-remote/state', {
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': '   ' },
    })
    const cleaned = sources().filter((source) => source !== undefined)
    assert.ok(cleaned.length > 0)
    assert.equal(
      cleaned.some((source) => /[\r\n]/.test(String(source))),
      false,
      'no CR/LF may survive into an audit source',
    )

    // A CRLF-injection attempt, hand-built because Node refuses such header values.
    const raw = await rawCall(
      server.port,
      `GET /mobile-remote/state HTTP/1.1\r\nHost: ${AUTHORITY}\r\nX-Forwarded-For: 203.0.113.9\r\nX-Injected: yes\r\nCookie: ${FENCE_COOKIE}\r\nConnection: close\r\n\r\n`,
    )
    assert.match(raw, /^HTTP\/1\.1 200/, 'the hand-built request is served like any other')
    assert.equal(
      sources().some((source) => String(source).includes('203.0.113.9')),
      true,
      'the hand-built XFF value is classified as the source',
    )
    assert.equal(
      sources().some((source) => String(source).includes('X-Injected')),
      false,
      'a crafted header must never reach the audit source',
    )

    // The leftmost non-empty item wins *verbatim*, even when it is not an address
    // shape: the audit `source` is display-only, and the gate never takes the
    // header's word for it outside the proxied shape (see the gate test).
    await call(server.port, '/mobile-remote/state', {
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': 'not-an-ip, 198.51.100.9' },
    })
    assert.equal(sources().at(-1), 'not-an-ip', 'the leftmost item is taken verbatim as the audit source')
  } finally {
    await server.close()
  }
})

test('adversarial: confirmation cannot be bypassed (random id, foreign id, denied round)', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 3000 } })
  const server = await serve(mounted.routes)
  const remote = { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': '203.0.113.7' }
  try {
    const device = await registerDevice(server.port, 'phone-E')
    const revoke = (headers) =>
      call(server.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: { ...remote, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ deviceId: device.id }),
      })
    /** Attempt a gated revoke and return the round's pushed link. */
    const openedRound = async (attempt) => {
      const before = sink.pushes.length
      assert.equal((await attempt()).status, 403, 'the gated attempt must be refused')
      return linkFrom(await nextPush(sink, before))
    }

    assert.equal((await revoke({ 'x-dsmr-confirm': 'not-a-round' })).status, 403, 'a random id is refused')

    // — push path: a real round, but answered `deny` — the id exists, must not authorise —
    const deniedLink = await openedRound(() => revoke({}))
    assert.equal((await call(server.port, withWord(deniedLink.path, 'deny'))).status, 200)
    assert.equal((await revoke({ 'x-dsmr-confirm': deniedLink.id })).status, 403, 'a denied round never approves')

    // — push path: an off-vocabulary word normalises to unavailable → still refused —
    const offLink = await openedRound(() => revoke({}))
    assert.equal((await call(server.port, withWord(offLink.path, 'yes'))).status, 200)
    assert.equal((await revoke({ 'x-dsmr-confirm': offLink.id })).status, 403, 'unavailable never approves')

    // — mint path: a round that was never answered must not authorise —
    let active = await pendingIds(server.port)
    assert.equal((await revoke({})).status, 403)
    const unanswered = await pendingLink(server.port, { exclude: active })
    assert.equal(
      (await revoke({ 'x-dsmr-confirm': unanswered.entry.id })).status,
      403,
      'an unanswered round never approves',
    )

    // — mint path: answered `cancel` → still refused —
    active = await pendingIds(server.port)
    assert.equal((await revoke({})).status, 403)
    const cancelled = await pendingLink(server.port, { exclude: active })
    assert.equal((await call(server.port, `${cancelled.link.path}&w=cancel`)).status, 200)
    assert.equal((await revoke({ 'x-dsmr-confirm': cancelled.entry.id })).status, 403, 'a cancelled round never approves')

    // — a confirmation id approved in a *different* plugin instance is foreign here,
    //   even though both instances sign with the same secret: the gate is state-bound —
    const otherSink = await startPushSink()
    const otherMount = await mountReady({ config: { pushTopic: otherSink.url, approvalTimeoutMs: 3000 } })
    const otherServer = await serve(otherMount.routes)
    try {
      const otherDevice = await registerDevice(otherServer.port, 'phone-G')
      const before = otherSink.pushes.length
      const otherGated = await call(otherServer.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: { ...remote, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: otherDevice.id }),
      })
      assert.equal(otherGated.status, 403)
      const foreign = linkFrom(await nextPush(otherSink, before))
      assert.equal(
        (await call(otherServer.port, `${foreign.path}&w=allow`)).status,
        200,
        'the round decides inside its own instance',
      )
      assert.equal((await revoke({ 'x-dsmr-confirm': foreign.id })).status, 403, 'a foreign confirmation id never approves')
    } finally {
      await otherServer.close()
      await otherSink.close()
    }

    // — F1 (t29): a forwarded request is ALWAYS remote, whatever its header
    //   claims. The pre-fix limit (leftmost loopback-shaped XFF ⇒ classified
    //   local ⇒ gate skipped, measured in t14) must be gone: a spoofed loopback
    //   claim now has to earn the same confirmation as any other remote call. —
    const spoofTarget = await registerDevice(server.port, 'phone-S')
    const beforeSpoof = sink.pushes.length
    const spoofed = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: spoofTarget.id }),
    })
    assert.equal(spoofed.status, 403, 'a loopback-shaped XFF must not skip the gate (F1)')
    assert.equal(spoofed.body, 'forbidden')
    const spoofPush = await nextPush(sink, beforeSpoof)
    assert.equal(sink.pushes.length, beforeSpoof + 1, 'the spoofed attempt earns exactly one round')
    assert.match(spoofPush.body, /\/mobile-remote\/decide\?d=/, 'and that round carries a decision link')
    const spoofedDevices = JSON.parse(
      (await call(server.port, '/mobile-remote/state', { headers: { host: AUTHORITY, cookie: FENCE_COOKIE } })).body,
    ).devices
    assert.equal(
      spoofedDevices.find((entry) => entry.id === spoofTarget.id)?.revokedAt,
      undefined,
      'the refused spoof revoked nothing',
    )

    // The nastier variant t14 measured: a duplicated header (Node joins the two
    // values) whose *first* item claims loopback.
    const dupBody = JSON.stringify({ deviceId: spoofTarget.id })
    const duplicate = await rawCall(
      server.port,
      `POST /mobile-remote/device/revoke HTTP/1.1\r\nHost: ${AUTHORITY}\r\nCookie: ${FENCE_COOKIE}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(dupBody)}\r\nX-Forwarded-For: 127.0.0.1\r\nX-Forwarded-For: 203.0.113.7\r\nConnection: close\r\n\r\n${dupBody}`,
    )
    assert.match(duplicate, /^HTTP\/1\.1 403/, 'duplicate XFF with a loopback first item stays gated')

    // RFC 7239 without any X-Forwarded-For: a forwarding header still means remote.
    const forwardedOnly = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: {
        host: AUTHORITY,
        cookie: FENCE_COOKIE,
        forwarded: 'for=127.0.0.1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ deviceId: spoofTarget.id }),
    })
    assert.equal(forwardedOnly.status, 403, 'a `Forwarded:` header alone is remote too (F1)')

    // …while a genuinely local caller (no forwarding header at all) stays ungated,
    // so the fix is a fail-safe and not a blanket refusal of every request.
    const localControl = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: spoofTarget.id }),
    })
    assert.equal(localControl.status, 200, 'a local caller is still not gated')
    assert.deepEqual(JSON.parse(localControl.body), { ok: true, revoked: spoofTarget.id })

    // The documented switch is the only thing that skips the gate.
    const ungatedSink = await startPushSink()
    const ungated = await mountReady({
      config: { pushTopic: ungatedSink.url, approvalTimeoutMs: 4000, requireSecondConfirmation: false },
    })
    const ungatedServer = await serve(ungated.routes)
    try {
      const target = await registerDevice(ungatedServer.port, 'phone-F')
      const direct = await call(ungatedServer.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: { ...remote, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: target.id }),
      })
      assert.equal(direct.status, 200, 'with the switch off the remote path is ungated (documented)')
      await ungatedSink.close()
    } finally {
      await ungatedServer.close()
    }

    // Oversized bodies are refused before any parsing — on the ungated JSON route…
    const hugeBody = JSON.stringify({ deviceId: 'x'.repeat(70_000) })
    const huge = await call(server.port, '/mobile-remote/device/register', {
      method: 'POST',
      headers: { ...remote, 'content-type': 'application/json' },
      body: hugeBody,
    })
    assert.equal(huge.status, 413)
    assert.equal(huge.body, 'payload too large')

    // …and on the gated one once a confirmation is presented (the gate is asked
    // first, by design: no body is read for an unconfirmed remote revoke).
    assert.equal(
      (
        await call(server.port, '/mobile-remote/device/revoke', {
          method: 'POST',
          headers: { ...remote, 'content-type': 'application/json' },
          body: hugeBody,
        })
      ).status,
      403,
      'an unconfirmed remote revoke is refused before the body is read',
    )
    const beforeHugeRound = await pendingIds(server.port)
    assert.equal((await revoke({})).status, 403)
    const confirmable = await pendingLink(server.port, { exclude: beforeHugeRound })
    assert.equal((await call(server.port, `${confirmable.link.path}&w=allow`)).status, 200)
    const hugeConfirmed = await call(server.port, '/mobile-remote/device/revoke', {
      method: 'POST',
      headers: { ...remote, 'x-dsmr-confirm': confirmable.entry.id, 'content-type': 'application/json' },
      body: hugeBody,
    })
    assert.equal(hugeConfirmed.status, 413, `a confirmed oversized revoke is refused: ${hugeConfirmed.body}`)
    assert.equal(hugeConfirmed.body, 'payload too large')
  } finally {
    await server.close()
    await sink.close()
  }
})

// ── 7. assembly-level fail-closed ────────────────────────────────────────────

test('fail closed: an unreadable credential secret leaves the whole P3/P4 layer absent', async () => {
  const sink = await startPushSink()
  const shapes = [
    {
      label: 'the record is absent',
      service: {
        readRecord: async () => undefined,
        getRecord: async () => undefined,
        modifyRecord: async (_key, update) => update(undefined),
      },
    },
    {
      label: 'every provider throws',
      service: {
        readRecord: async () => {
          throw new Error('provider down')
        },
        getRecord: async () => {
          throw new Error('provider down')
        },
        modifyRecord: async () => {
          throw new Error('provider down')
        },
      },
    },
    {
      label: 'the record has an unknown version',
      service: { getRecord: async () => ({ payload: { version: 2, secret: SECRET } }) },
    },
  ]
  try {
    for (const shape of shapes) {
      const mounted = mountPlugin({ config: { pushTopic: sink.url }, credentials: shape.service })
      await waitFor(
        () => mounted.logLines.some((line) => line.includes('未启用')),
        `${shape.label}: the layer must say it is off`,
      )
      assert.equal(
        mounted.listeners.has('approval/request'),
        false,
        `${shape.label}: no approval responder may be registered`,
      )
      assert.equal(sink.pushes.length, 0, `${shape.label}: nothing may be pushed`)

      const server = await serve(mounted.routes)
      try {
        const state = await call(server.port, '/mobile-remote/state', {
          headers: { host: AUTHORITY, cookie: FENCE_COOKIE },
        })
        assert.equal(state.status, 503, `${shape.label}: state must fail closed`)
        assert.equal(state.body, 'hardening unavailable')

        const decide = await call(server.port, '/mobile-remote/decide?d=x&t=y', {
          headers: { host: AUTHORITY, cookie: FENCE_COOKIE },
        })
        assert.equal(decide.status, 503, `${shape.label}: decide must fail closed`)
        assert.equal(decide.body, 'decision links unavailable')

        // P1 is untouched by a missing P3/P4 kernel.
        const pair = await call(server.port, '/mobile-remote/pair', {
          headers: { host: AUTHORITY, cookie: FENCE_COOKIE },
        })
        assert.equal(pair.status, 200, `${shape.label}: pairing must still work`)
      } finally {
        await server.close()
      }
    }
  } finally {
    await sink.close()
  }
})

// ── 8. the confirmation gate is rate-bounded (F5) ────────────────────────────

test('adversarial: a confirmation flood is throttled without minting new rounds', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 4000 } })
  const server = await serve(mounted.routes)
  const remote = { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': '203.0.113.7' }
  const throttled = () => mounted.logLines.some((line) => line.includes('confirm-throttled'))
  try {
    const device = await registerDevice(server.port, 'phone-T')
    let attempts = 0
    while (attempts < 48 && !throttled()) {
      const before = sink.pushes.length
      const gated = await call(server.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: { ...remote, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: device.id }),
      })
      assert.equal(gated.status, 403, 'every remote attempt is refused')
      attempts += 1
      if (throttled()) {
        // The refused attempt minted nothing: no new round, no new push.
        assert.equal(sink.pushes.length, before, 'a throttled attempt must not mint a round')
        break
      }
      await nextPush(sink, before)
      assert.equal(sink.pushes.length, before + 1, 'an accepted attempt mints exactly one round')
    }
    assert.ok(
      throttled(),
      `the gate must bound a flood, got ${attempts} attempts and ${sink.pushes.length} rounds`,
    )
    const pending = JSON.parse(
      (await call(server.port, '/mobile-remote/state', { headers: { host: AUTHORITY, cookie: FENCE_COOKIE } })).body,
    ).pending
    assert.equal(pending.length, sink.pushes.length, 'the pending table tracks the minted rounds')
    assert.ok(pending.length <= 48, 'and the table stays bounded')
  } finally {
    await server.close()
    await sink.close()
  }
})

// ── 9. t33 regressions: the pushed link, the config, and the fence copy ──────

test('t33: the pushed decision link approves by itself, with no hand-added word', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 3000 } })
  const server = await serve(mounted.routes)
  const remote = { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': '203.0.113.7' }
  try {
    const device = await registerDevice(server.port, 'phone-F')
    const revoke = (headers) =>
      call(server.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: { ...remote, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ deviceId: device.id }),
      })

    const before = sink.pushes.length
    assert.equal((await revoke({})).status, 403, 'the gated attempt must be refused')
    const link = linkFrom(await nextPush(sink, before))

    // The regression this test exists for: use the pushed URL **verbatim**. Before
    // t33 it carried no `w`, so this single call settled the round `unavailable`
    // and burned the one-time token, while the page still answered 200.
    assert.match(link.path, /[?&]w=allow/, `the pushed link must carry its word, got ${link.path}`)
    const tapped = await call(server.port, link.path)
    assert.equal(tapped.status, 200, `tapping the pushed link must answer 200, got ${tapped.status}: ${tapped.body}`)
    assert.match(tapped.body, /allow/, `the page must record the allow, got: ${tapped.body}`)

    // And the round it approved is redeemable — the point of the whole flow.
    assert.equal(
      (await revoke({ 'x-dsmr-confirm': link.id })).status,
      200,
      'the round the pushed link approved must authorise the gated revoke',
    )
  } finally {
    await server.close()
    await sink.close()
  }
})

test('t33: a decide link with no word is refused without consuming the capability', async () => {
  const sink = await startPushSink()
  const mounted = await mountReady({ config: { pushTopic: sink.url, approvalTimeoutMs: 3000 } })
  const server = await serve(mounted.routes)
  const remote = { host: AUTHORITY, cookie: FENCE_COOKIE, 'x-forwarded-for': '203.0.113.7' }
  try {
    const device = await registerDevice(server.port, 'phone-G')
    const revoke = (headers) =>
      call(server.port, '/mobile-remote/device/revoke', {
        method: 'POST',
        headers: { ...remote, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ deviceId: device.id }),
      })
    const before = sink.pushes.length
    assert.equal((await revoke({})).status, 403)
    const link = linkFrom(await nextPush(sink, before))

    // What a link prefetch, a chat-app preview or a truncated URL looks like: the
    // capability parameters but no decision word.
    const bare = `/mobile-remote/decide?d=${encodeURIComponent(link.id)}&t=${encodeURIComponent(link.token)}`
    const prefetched = await call(server.port, bare)
    assert.equal(prefetched.status, 400, `a word-less link must be refused, got ${prefetched.status}`)
    assert.ok(
      mounted.logLines.some((line) => line.includes('decide-no-word')),
      'and the refusal is audited as decide-no-word',
    )

    // The capability survived the prefetch: the real link still decides, and the
    // round is still redeemable afterwards.
    assert.equal((await call(server.port, link.path)).status, 200, 'the real link must still decide')
    assert.equal((await revoke({ 'x-dsmr-confirm': link.id })).status, 200, 'and the round is still redeemable')
  } finally {
    await server.close()
    await sink.close()
  }
})

test('t33: a schema-legal config the kernel rejects must not kill or hang the plugin', async () => {
  const rejections = []
  const onRejection = (reason) => rejections.push(reason)
  process.on('unhandledRejection', onRejection)
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), 2000)),
    ])
  try {
    // `Schema.natural()` is `.min(0)`: 0 is legal to the schema and rejected by
    // both kernel constructors. The first used to be an unhandled rejection with
    // no log at all (P3/P4 dead for the session); the second left the request
    // unanswered entirely.
    const timeoutZero = await mountReady({ config: { approvalTimeoutMs: 0 } })
    assert.ok(wiringDone(timeoutZero), 'approvalTimeoutMs: 0 must still install the kernel')

    const ttlZero = await mountReady({ config: { deviceGrantTtlMs: 0 } })
    assert.ok(wiringDone(ttlZero), 'deviceGrantTtlMs: 0 must still install the kernel')
    const server = await serve(ttlZero.routes)
    try {
      const registered = await withTimeout(
        call(server.port, '/mobile-remote/device/register', {
          method: 'POST',
          headers: { host: AUTHORITY, cookie: FENCE_COOKIE, 'content-type': 'application/json' },
          body: JSON.stringify({ label: 'phone-H' }),
        }),
        'a register request the handler threw on',
      )
      assert.equal(registered.status, 200, `register must answer, never hang: got ${registered.status}`)
      assert.ok(registered.headers['set-cookie'], 'and it must still issue a credential')
    } finally {
      await server.close()
    }
  } finally {
    process.off('unhandledRejection', onRejection)
  }
  assert.deepEqual(rejections.map(String), [], 'no unhandled rejection may escape mounting')
})

test('t33: this file\'s fence copy refuses cross-site and foreign-Origin requests', async () => {
  const mounted = await mountReady()
  const server = await serve(mounted.routes)
  const trusted = { host: AUTHORITY, cookie: FENCE_COOKIE }
  try {
    assert.equal((await call(server.port, '/mobile-remote/pair', { headers: trusted })).status, 200)
    assert.equal(
      (await call(server.port, '/mobile-remote/pair', {
        headers: { ...trusted, 'sec-fetch-site': 'cross-site' },
      })).status,
      403,
      'a cross-site request must be fenced off',
    )
    assert.equal(
      (await call(server.port, '/mobile-remote/pair', {
        headers: { ...trusted, origin: 'https://evil.example.com' },
      })).status,
      403,
      'a foreign Origin must be fenced off',
    )
    assert.equal(
      (await call(server.port, '/mobile-remote/pair', {
        headers: { ...trusted, origin: `https://${AUTHORITY}` },
      })).status,
      200,
      'a same-origin request still passes',
    )
  } finally {
    await server.close()
  }
})
