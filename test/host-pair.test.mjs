/**
 * T3 host-core tests — `node --test test/*.test.mjs` (see package.json `test`).
 *
 * Everything here runs against the BUILT host artifact (`lib/index.js`), through
 * the same entry points the DSH loader uses: `apply(ctx, config)` plus the two
 * things a host actually sees — the route registered on `ctx.webServer` and the
 * tool registered on `ctx.tools`. Nothing is imported from `src/`, so a test can
 * only pass when the shipped artifact really behaves this way.
 *
 * The context is a stub with no DSH process behind it: `connection.admit` and
 * `connection.authenticatedUrl` are fakes. That is deliberate — the security
 * properties under test (admission first, information-free refusals, no token in
 * the audit) are properties of OUR code, and pinning them to fakes is what makes
 * them checkable without a live install.
 *
 * Frozen interface: docs/00-contract.md §3 (config), §4 (tool), §5 (routes).
 *
 * The host artifact's only runtime import is `@deepseek-ai/schemastery`, so this
 * file needs no module hook: it imports `lib/index.js` and drives it through the
 * same entry points the DSH loader uses.
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_ARTIFACT = join(repoRoot, 'lib', 'index.js')

/** Frozen values this suite pins. */
const AUTHORITY = 'demo.tailnet-example.ts.net'
const TOKEN = 'tok-R7kY2mQ4sV8pL1nZ'
const PAIR_PATH = '/mobile-remote/pair'
const TOOL_NAME = 'mobile_pair_url'

const host = await import(pathToFileURL(HOST_ARTIFACT).href).catch((error) => {
  assert.fail(`cannot import ${HOST_ARTIFACT} — run \`pnpm build\` first (${error.message})`)
})

/**
 * Build a stub host context around the built plugin.
 *
 * @param options - per-test overrides (config, admit behaviour, missing services).
 * @returns the context plus the observable registrations.
 */
function createHarness(options = {}) {
  const routes = new Map()
  const tools = []
  const auditLines = []
  const effects = []
  const injections = []
  const listeners = []

  const connection = {
    admit: options.admit ?? (() => ({ peer: { id: 'operator' } })),
    authenticatedUrl(baseUrl) {
      const url = new URL(baseUrl)
      url.searchParams.set('token', options.token ?? TOKEN)
      return url.href
    },
  }

  // `webRuntimeShape: 'no-field'` models a runtime whose trustedHosts export is
  // unreadable — the note path, not a crash.
  const webRuntime =
    options.webRuntimeShape === 'no-field' ? {} : { trustedHosts: options.trustedHosts ?? [AUTHORITY] }
  const webServer = {
    register(route) {
      if (routes.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }

  const present = {
    connection: options.connectionMissing !== true,
    webServer: options.webServerMissing !== true,
    webRuntime: options.webRuntimeMissing !== true,
  }

  const ctx = {
    webServer,
    connection,
    get(serviceName) {
      if (serviceName === 'connection') return present.connection ? connection : undefined
      if (serviceName === 'webServer') return present.webServer ? webServer : undefined
      if (serviceName === 'webRuntime') return present.webRuntime ? webRuntime : undefined
      return undefined
    },
    effect(execute, label = 'anonymous') {
      const entry = { label, disposer: execute() }
      effects.push(entry)
      return () => {
        const at = effects.indexOf(entry)
        if (at !== -1) effects.splice(at, 1)
        if (typeof entry.disposer === 'function') entry.disposer()
      }
    },
    inject(services, callback) {
      injections.push(services)
      // Mirror cordis ownership: the scope `inject` opens is a child of this
      // fiber, so effects it registers are disposed with ours.
      callback({
        tools: {
          register(definition) {
            tools.push(definition)
            return () => {
              const at = tools.indexOf(definition)
              if (at !== -1) tools.splice(at, 1)
            }
          },
        },
        effect(execute, label = 'anonymous') {
          return ctx.effect(execute, label)
        },
      })
    },
    // Fiber-owned in cordis; the stub only records what was registered so the
    // index-injection row can be read back.
    on(event, listener) {
      const entry = { event, listener }
      listeners.push(entry)
      return () => {
        const at = listeners.indexOf(entry)
        if (at !== -1) listeners.splice(at, 1)
      }
    },
    logger: {
      info: (line) => auditLines.push(line),
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  }

  const config = {
    pairingAuthority: AUTHORITY,
    mobileCss: true,
    pushTopic: '',
    approvalTimeoutMs: 120000,
    auditLog: true,
    ...(options.config ?? {}),
  }

  return {
    ctx,
    config,
    routes,
    tools,
    auditLines,
    effects,
    injections,
    listeners,
    /** Collect the index-injection table exactly as the webserver does. */
    collectIndexInjections() {
      const table = []
      for (const entry of listeners) {
        if (entry.event === 'webserver/index-inject') entry.listener(table)
      }
      return table
    },
    /** Mount the plugin exactly as the loader does. */
    mount() {
      host.apply(ctx, config)
      return this
    },
    /** Dispose every effect the mount registered — the plugin fiber's lifetime. */
    dispose() {
      for (const entry of [...effects].reverse()) {
        if (typeof entry.disposer === 'function') entry.disposer()
      }
      effects.length = 0
      // Event listeners are fiber-owned in cordis too, so they go with it.
      listeners.length = 0
    },
    /** One HTTP exchange against the registered pair route. */
    request({ method = 'GET', url = PAIR_PATH, headers = {}, remoteAddress } = {}) {
      const route = routes.get(PAIR_PATH)
      assert.ok(route, 'the pair route is not registered')
      const chunks = []
      let status = 0
      let outHeaders = {}
      const res = {
        writeHead(code, responseHeaders) {
          status = code
          outHeaders = responseHeaders ?? {}
          return this
        },
        end(body) {
          if (body !== undefined && body !== null) chunks.push(String(body))
          this.finished = true
        },
      }
      route.handler({ method, url, headers, socket: { remoteAddress } }, res)
      return { status, headers: outHeaders, body: chunks.join('') }
    },
  }
}

/**
 * Parse the structured audit lines this mount produced.
 *
 * Since F5 the mount banner also goes to `ctx.logger.info` (that is the point of
 * the fix), so the sink is filtered to the one JSON-record shape `AuditLog`
 * writes instead of assuming every line is a record.
 */
function auditRecords(harness) {
  return harness.auditLines
    .filter((line) => line.startsWith('{"ts"'))
    .map((line) => JSON.parse(line))
}

test('config: the five P1 frozen keys resolve with the frozen defaults', () => {
  const resolved = host.Config({})
  // T9/P4 added eight hardening keys with safe defaults; the five P1 keys are
  // still exactly these values (docs/06-hardening-contract.md §3).
  for (const [key, value] of Object.entries({
    pairingAuthority: '',
    mobileCss: true,
    pushTopic: '',
    approvalTimeoutMs: 120000,
    auditLog: true,
  })) {
    assert.deepEqual(resolved[key], value, `${key} must keep its frozen default`)
  }
})

test('route: registered on ctx.webServer as exact routes (the pair route among them)', () => {
  const harness = createHarness().mount()
  const route = harness.routes.get(PAIR_PATH)
  assert.ok(route, 'expected the pair route on the host webserver')
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, PAIR_PATH)
  assert.equal(typeof route.handler, 'function')
  // T9 grew the surface: pair + decide + state + device/revoke + device/register.
  assert.deepEqual([...harness.routes.keys()], [
    '/mobile-remote/pair',
    '/mobile-remote/decide',
    '/mobile-remote/state',
    '/mobile-remote/device/revoke',
    '/mobile-remote/device/register',
  ])
  for (const registered of harness.routes.values()) assert.equal(registered.kind, 'exact')
})

test('route: an admitted GET returns the authenticated launch URL', () => {
  const harness = createHarness().mount()
  const answer = harness.request()

  assert.equal(answer.status, 200)
  assert.equal(answer.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(answer.headers['cache-control'], 'no-store')

  const body = JSON.parse(answer.body)
  assert.deepEqual(Object.keys(body).sort(), ['authority', 'expiresAt', 'url'])
  assert.equal(body.authority, AUTHORITY)
  assert.equal(body.expiresAt, null)

  const url = new URL(body.url)
  assert.equal(url.origin, `https://${AUTHORITY}`)
  assert.equal(url.pathname, '/', 'the phone must land on the authority root')
  assert.equal(url.searchParams.get('token'), TOKEN, 'the token parameter carries the launch token')
})

test('route: the URL is minted by connection.authenticatedUrl over the authority root', () => {
  const seen = []
  const harness = createHarness({
    admit: () => ({ peer: {} }),
  })
  harness.ctx.connection.authenticatedUrl = (baseUrl) => {
    seen.push(baseUrl)
    const url = new URL(baseUrl)
    url.searchParams.set('token', TOKEN)
    return url.href
  }
  harness.mount()
  harness.request()

  assert.deepEqual(seen, [`https://${AUTHORITY}/`], 'the port must receive the clean authority root')
})

test('route: an admit rejection is answered with the fence vocabulary and leaks nothing', () => {
  for (const [rejection, status, word] of [[401, 401, 'unauthorized'], [403, 403, 'forbidden']]) {
    const harness = createHarness({ admit: () => ({ rejection }) }).mount()
    const answer = harness.request({ headers: { 'x-forwarded-for': '203.0.113.7' } })

    assert.equal(answer.status, status)
    assert.equal(answer.body, word, 'the refusal body is exactly the shipped word')
    assert.equal(answer.headers['content-type'], 'text/plain; charset=utf-8')
    assert.ok(!answer.body.includes('http'), 'a refusal must not carry a URL')
    assert.ok(!answer.body.includes(TOKEN), 'a refusal must not carry the token')
    assert.ok(!answer.body.includes(AUTHORITY), 'a refusal must not carry the authority')
  }
})

test('route: admission runs before every other check', () => {
  // Unconfigured + POST + rejection: only the refusal may come out.
  const harness = createHarness({
    config: { pairingAuthority: '' },
    admit: () => ({ rejection: 401 }),
  }).mount()
  const answer = harness.request({ method: 'POST' })
  assert.equal(answer.status, 401)
  assert.equal(answer.body, 'unauthorized')
})

test('route: a missing connection service fails closed with 403', () => {
  const harness = createHarness({ connectionMissing: true }).mount()
  const answer = harness.request()
  assert.equal(answer.status, 403)
  assert.equal(answer.body, 'forbidden')
  assert.deepEqual(auditRecords(harness).map((entry) => entry.result), ['connection-unavailable'])
})

test('route: an unconfigured authority answers 503 without a URL', () => {
  const harness = createHarness({ config: { pairingAuthority: '' } }).mount()
  const answer = harness.request()
  assert.equal(answer.status, 503)
  assert.equal(answer.body, 'pairing not configured')
  assert.ok(!answer.body.includes('http'))
})

test('route: a non-canonical authority is refused like an unconfigured one', () => {
  for (const bad of ['https://host.example', 'host.example/path', 'user@host.example', ' host.example', 'host.example:080']) {
    const harness = createHarness({ config: { pairingAuthority: bad } }).mount()
    const answer = harness.request()
    assert.equal(answer.status, 503, `${bad} must not produce a URL`)
    assert.equal(answer.body, 'pairing not configured')
  }
})

test('route: only GET and HEAD are served (405 otherwise, HEAD has no body)', () => {
  const harness = createHarness().mount()
  const post = harness.request({ method: 'POST' })
  assert.equal(post.status, 405)

  const head = harness.request({ method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(head.body, '', 'a HEAD response carries headers only')
})

test('audit: every decision writes one structured line with the internet-facing source', () => {
  const harness = createHarness().mount()

  harness.request({ headers: { 'x-forwarded-for': '203.0.113.7' }, remoteAddress: '127.0.0.1' })
  const [ok] = auditRecords(harness)
  assert.equal(ok.event, 'mobile-remote/access')
  assert.equal(ok.method, 'GET')
  assert.equal(ok.path, PAIR_PATH)
  assert.equal(ok.result, 'ok')
  assert.equal(ok.status, 200)
  assert.equal(ok.source, '203.0.113.7', 'X-Forwarded-For wins over the loopback socket peer')
  assert.match(ok.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('audit: X-Forwarded-For uses the leftmost non-empty entry, else the socket peer', () => {
  const harness = createHarness({ admit: () => ({ rejection: 401 }) }).mount()

  harness.request({ headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18', 'X-Forwarded-For': undefined } })
  harness.request({ headers: { 'X-Forwarded-For': ' , 70.41.3.18' }, remoteAddress: '127.0.0.1' })
  harness.request({ headers: {}, remoteAddress: '198.51.100.9' })
  harness.request({ headers: {} })

  const sources = auditRecords(harness).map((entry) => entry.source)
  assert.deepEqual(sources, ['203.0.113.7', '70.41.3.18', '198.51.100.9', 'unknown'])
})

test('audit: records never contain the token, a cookie or a query string', () => {
  const harness = createHarness().mount()

  harness.request({ url: `${PAIR_PATH}?token=${TOKEN}`, headers: { cookie: `dsh-auth-abc=${TOKEN}` } })
  harness.request({ headers: { 'x-forwarded-for': `203.0.113.7?token=${TOKEN}` } })

  assert.ok(harness.auditLines.length >= 2)
  for (const line of harness.auditLines) {
    assert.ok(!line.includes(TOKEN), `audit line leaked the token: ${line}`)
    assert.ok(!/dsh-auth-[A-Za-z0-9_-]{4}/.test(line), `audit line leaked a cookie: ${line}`)
    assert.ok(!line.includes('?'), `audit line kept a query string: ${line}`)
  }
  const [first] = auditRecords(harness)
  assert.equal(first.path, PAIR_PATH, 'only the pathname is recorded')
})

test('audit: auditLog=false writes nothing at all', () => {
  const harness = createHarness({ config: { auditLog: false } }).mount()
  harness.request()
  harness.request({ method: 'POST' })
  assert.deepEqual(auditRecords(harness), [], 'not one record may be produced')
  // The mount banner is still a log line — it is not an audit record (F5).
  assert.equal(harness.auditLines.filter((line) => line.startsWith('dsh-mobile-remote mounted')).length, 1)
})

test('tool: registered through ctx.inject(["tools"]) with the frozen name and no parameters', () => {
  const harness = createHarness().mount()
  assert.deepEqual(harness.injections.filter((entry) => entry.includes('tools')), [['tools']])
  assert.equal(harness.tools.length, 1)

  const definition = harness.tools[0]
  assert.equal(definition.name, TOOL_NAME)
  assert.deepEqual(Object.keys(definition.parameters?.properties ?? {}), [], 'the tool takes no arguments')
})

test('tool: returns the frozen success shape and a tappable URL in its text', async () => {
  const harness = createHarness().mount()
  const definition = harness.tools[0]

  const value = await definition.execute({}, {})
  assert.deepEqual(
    Object.keys(value).sort(),
    ['authority', 'configured', 'expiresAt', 'notes', 'ok', 'url'],
    'notes is always present, empty when the fence needs no attention (F3)',
  )
  assert.deepEqual(value.notes, [])
  assert.equal(value.ok, true)
  assert.equal(value.configured, true)
  assert.equal(value.authority, AUTHORITY)

  const url = new URL(value.url)
  assert.equal(url.origin, `https://${AUTHORITY}`)
  assert.equal(url.searchParams.get('token'), TOKEN)

  const blocks = definition.output.render({}, value)
  assert.ok(Array.isArray(blocks) && blocks.length >= 1)
  assert.equal(blocks[0].type, 'text')
  assert.ok(blocks[0].text.includes(value.url), 'the model-visible text must carry the whole URL')
  assert.ok(!blocks[0].text.includes('undefined'))
})

test('tool: refuses readably when pairing is off, never throwing', async () => {
  const harness = createHarness({ config: { pairingAuthority: '' } }).mount()
  const value = await harness.tools[0].execute({}, {})

  assert.equal(value.ok, false)
  assert.equal(value.configured, false)
  assert.equal(value.code, 'not-configured')
  assert.equal(value.url, null)
  assert.ok(value.message.includes('pairingAuthority'), 'the message must name the missing key')

  const text = harness.tools[0].output.render({}, value)[0].text
  assert.ok(text.includes(value.message))
  assert.ok(!text.includes('http'), 'a refusal must not carry a URL')
})

test('tool: refuses readably when a service it needs is missing', async () => {
  for (const missing of [{ connectionMissing: true }, { webServerMissing: true }, { webRuntimeMissing: true }]) {
    const harness = createHarness(missing).mount()
    const value = await harness.tools[0].execute({}, {})
    assert.equal(value.ok, false)
    assert.equal(value.code, 'connection-unavailable', `${JSON.stringify(missing)} must fail closed`)
    assert.equal(value.url, null)
    assert.equal(typeof value.message, 'string')
  }
})

test('tool: a non-canonical authority is refused instead of guessed around', async () => {
  const harness = createHarness({ config: { pairingAuthority: 'host.example/../evil' } }).mount()
  const value = await harness.tools[0].execute({}, {})
  assert.equal(value.ok, false)
  assert.equal(value.code, 'internal')
  assert.equal(value.url, null)
})

test('tool: a working URL carries a note when the fence has not been opened', async () => {
  const harness = createHarness({ trustedHosts: ['other.example'] }).mount()
  const value = await harness.tools[0].execute({}, {})
  assert.equal(value.ok, true)
  assert.equal(value.notes.length, 1)
  assert.ok(value.notes[0].includes(AUTHORITY), 'the note names the authority that is missing')
})

test('lifecycle: dispose releases the routes and the tool, and a remount is clean', () => {
  const harness = createHarness()
  harness.mount()
  assert.equal(harness.routes.size, 5, 'pair + decide + state + revoke + register')
  assert.equal(harness.tools.length, 1)

  harness.dispose()
  assert.equal(harness.routes.size, 0, 'every route must be released')
  assert.equal(harness.tools.length, 0, 'the tool must be released')

  // A reload disposes and re-applies; a stale registration would throw
  // `webserver: duplicate exact route "/mobile-remote/pair"` here.
  harness.mount()
  assert.equal(harness.routes.size, 5)
  assert.equal(harness.tools.length, 1)

  harness.dispose()
  assert.equal(harness.routes.size, 0)
  assert.equal(harness.tools.length, 0)
})

test('lifecycle: mounting without a webserver or tool registry does not throw', () => {
  const harness = createHarness({ webServerMissing: true })
  const bare = { get: () => undefined, effect: () => () => {}, logger: { info: () => {} } }
  assert.doesNotThrow(() => host.apply(bare, harness.config))
})

test('config: reactive accessor values resolve, and an unreadable one falls back', async () => {
  // The 0.2 line hands a composed row's config as per-field accessors
  // (`config.field.get()`); the 0.1 line hands plain values. Both must work,
  // and a broken accessor must degrade to the default instead of taking the
  // plugin down.
  const reactive = createHarness()
  host.apply(reactive.ctx, {
    pairingAuthority: { get: () => AUTHORITY },
    mobileCss: { get: () => false },
    pushTopic: { get: () => '' },
    approvalTimeoutMs: { get: () => 5000 },
    auditLog: { get: () => true },
  })
  const value = await reactive.tools[0].execute({}, {})
  assert.equal(value.ok, true)
  assert.equal(value.authority, AUTHORITY)

  const broken = createHarness()
  host.apply(broken.ctx, {
    pairingAuthority: {
      get: () => {
        throw new Error('unreadable projection')
      },
    },
  })
  const refused = await broken.tools[0].execute({}, {})
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'not-configured', 'an unreadable field falls back to the default')
})

test('route: a missing webRuntime answers 503 instead of handing out a URL', () => {
  const harness = createHarness({ webRuntimeMissing: true }).mount()
  const answer = harness.request()
  assert.equal(answer.status, 503)
  assert.equal(answer.body, 'pairing not configured')
  assert.deepEqual(auditRecords(harness).map((entry) => entry.result), ['connection-unavailable'])
})

test('tool: an unreadable trustedHosts list still produces a warning note', async () => {
  const harness = createHarness({ webRuntimeShape: 'no-field' }).mount()
  const value = await harness.tools[0].execute({}, {})
  assert.equal(value.ok, true)
  assert.equal(value.notes.length, 1)
  assert.ok(value.notes[0].includes('trustedHosts'))
})

test('audit: an array-valued X-Forwarded-For header is accepted', () => {
  const harness = createHarness({ admit: () => ({ rejection: 401 }) }).mount()
  harness.request({ headers: { 'x-forwarded-for': ['203.0.113.7', '70.41.3.18'] } })
  assert.equal(auditRecords(harness)[0].source, '203.0.113.7')
})

test('page config: mobileCss is published as a real boolean through the index-injection row', () => {
  // The browser half cannot read the host's composition config, so the host
  // publishes this one key. The row is the shipped `global` kind, whose value the
  // webserver renders as `<script>globalThis["<name>"] = <json></script>`.
  for (const [configured, expected] of [[true, true], [false, false]]) {
    const harness = createHarness({ config: { mobileCss: configured } }).mount()
    const rows = harness.collectIndexInjections()

    assert.equal(rows.length, 1, 'exactly one row per mount')
    assert.equal(rows[0].kind, 'global')
    assert.equal(rows[0].name, '__DSH_MOBILE_REMOTE__', 'the name is the frozen host↔client key')
    assert.deepEqual(rows[0].value, { mobileCss: expected })
    assert.equal(typeof rows[0].value.mobileCss, 'boolean', 'a real boolean, not "0"/"1"')
  }
})

test('page config: the published value follows the resolved config, accessors included', () => {
  const reactive = createHarness()
  host.apply(reactive.ctx, { mobileCss: { get: () => false } })
  assert.deepEqual(reactive.collectIndexInjections()[0].value, { mobileCss: false })
})

test('page config: one listener per mount, released with the fiber', () => {
  const harness = createHarness().mount()
  assert.equal(harness.listeners.length, 1)
  assert.equal(harness.listeners[0].event, 'webserver/index-inject')

  harness.dispose()
  assert.equal(harness.listeners.length, 0, 'the listener is fiber-owned, not a permanent hook')
})

test('page config: mounting without an event bus does not throw', () => {
  // A host context that cannot carry the row must still mount the rest of the
  // plugin (T2's bare-stub shape).
  const bare = { get: () => undefined, effect: () => () => {}, logger: { info: () => {} } }
  assert.doesNotThrow(() => host.apply(bare, {
    pairingAuthority: '',
    mobileCss: true,
    pushTopic: '',
    approvalTimeoutMs: 120000,
    auditLog: true,
  }))
})

// ---------------------------------------------------------------------------
// Regression block for the adversarial review (docs/09-review-host-core.md).
// Every case below failed against the pre-repair artifact; they exist so the
// fail-open/releak shapes cannot come back (F1, F2, F3, F4, F5).
// ---------------------------------------------------------------------------

/** A credential with no `token=` spelling in front of it: 36 base64url chars. */
const BARE_TOKEN = 'tok-R7kY2mQ4sV8pL1nZ3xW5cB6dF9gH2jK4'

/** Every refusal body must stay one of the fence's two words. */
function assertInformationFree(answer) {
  assert.ok(['unauthorized', 'forbidden'].includes(answer.body), `unexpected refusal body: ${answer.body}`)
  assert.ok(!answer.body.includes('http'), 'a refusal must not carry a URL')
  assert.ok(!answer.body.includes(TOKEN), 'a refusal must not carry the token')
  assert.ok(!answer.body.includes(AUTHORITY), 'a refusal must not carry the authority')
}

test('F1: every non-success admit shape is refused (the nine review shapes plus more)', () => {
  const shapes = [
    ['{rejection:"403"}', () => ({ rejection: '403' })],
    ['{rejection:null}', () => ({ rejection: null })],
    ['{}', () => ({})],
    ['undefined', () => undefined],
    ['true', () => true],
    ['"denied"', () => 'denied'],
    ['[]', () => []],
    ['pending promise', () => new Promise(() => {})],
    ['Promise.resolve({rejection:401})', () => Promise.resolve({ rejection: 401 })],
    ['Promise.resolve({peer:{}})', () => Promise.resolve({ peer: { id: 'operator' } })],
    ['{peer:false}', () => ({ peer: false })],
    ['{peer:null}', () => ({ peer: null })],
  ]

  for (const [label, admit] of shapes) {
    const harness = createHarness({ admit }).mount()
    const answer = harness.request()

    assert.equal(answer.status, 401, `${label} must not be admitted`)
    assertInformationFree(answer)

    const [record] = auditRecords(harness)
    assert.equal(record.status, 401, `${label}: the audit must not claim success`)
    assert.notEqual(record.result, 'ok', `${label}: the audit must not claim success`)
    assert.ok(!record.path.includes('token'), `${label}: no token may ride along`)
  }
})

test('F1: the recognised shapes keep their own semantics', () => {
  // A truthy peer with no rejection key is the fence's success shape.
  for (const peer of [{ id: 'operator' }, true, 'phone']) {
    const harness = createHarness({ admit: () => ({ peer }) }).mount()
    assert.equal(harness.request().status, 200, `{peer:${JSON.stringify(peer)}} is an admission`)
  }

  // `rejection: 403` keeps the fence's own word …
  const forbidden = createHarness({ admit: () => ({ rejection: 403 }) }).mount()
  const denied = forbidden.request()
  assert.equal(denied.status, 403)
  assert.equal(denied.body, 'forbidden')

  // … and any other rejection value collapses to 401 without echoing itself.
  const odd = createHarness({ admit: () => ({ rejection: 418 }) }).mount()
  const answer = odd.request()
  assert.equal(answer.status, 401)
  assert.equal(answer.body, 'unauthorized')
  assert.ok(!answer.body.includes('418'), 'the rejection value must not be echoed')
  assert.equal(auditRecords(odd)[0].result, 'unauthenticated')
})

test('F1: a rejection arriving through a thenable is never awaited into an admission', () => {
  const harness = createHarness({ admit: () => Promise.resolve({ rejection: 403 }) }).mount()
  const answer = harness.request()
  assert.equal(answer.status, 401, 'a thenable is unreadable, not admissible')
  assert.equal(answer.body, 'unauthorized')
})

test('F2: a throwing fence never leaks exception text or a bare token into the audit', () => {
  const harness = createHarness({
    admit: () => {
      throw Object.assign(new Error(`admit exploded with ${BARE_TOKEN}`), { code: 'EADMIT' })
    },
  }).mount()

  const answer = harness.request()
  assert.equal(answer.status, 403)
  assertInformationFree(answer)

  const [record] = auditRecords(harness)
  assert.ok(!JSON.stringify(record).includes(BARE_TOKEN), `the audit leaked the token: ${record.detail}`)
  assert.match(record.detail, /^admission-error/, 'the stable category survives')
  assert.match(record.detail, /EADMIT/, 'the stable code survives')
  assert.match(record.detail, /<redacted>/, 'the credential value is redacted by value, not by spelling')
  assert.ok(record.detail.length <= 200, 'the sanitized text is bounded')
})

test('F2: a throwing authenticatedUrl is answered 500 with a sanitized, bounded detail', () => {
  const harness = createHarness()
  harness.ctx.connection.authenticatedUrl = () => {
    throw new Error(`mint failed ?token=${BARE_TOKEN} and bare ${BARE_TOKEN} ${'x'.repeat(400)}`)
  }
  harness.mount()

  const answer = harness.request()
  assert.equal(answer.status, 500)
  assert.equal(answer.body, 'internal error')

  const [record] = auditRecords(harness)
  assert.ok(!JSON.stringify(record).includes(BARE_TOKEN))
  assert.match(record.detail, /^internal/, 'the category is stable')
  assert.ok(record.detail.length <= 200, `the detail must be bounded, got ${record.detail.length}`)
})

test('F2: the tool channel sanitizes the same exception through message and render text', async () => {
  const harness = createHarness()
  harness.ctx.connection.authenticatedUrl = () => {
    throw new Error(`mint exploded ${BARE_TOKEN} at ?token=${BARE_TOKEN}`)
  }
  harness.mount()

  const definition = harness.tools[0]
  const value = await definition.execute({}, {})
  assert.equal(value.ok, false)
  assert.equal(value.url, null)
  assert.equal(value.code, 'internal')
  assert.ok(!JSON.stringify(value).includes(BARE_TOKEN), 'the tool value must not carry the token')
  assert.match(value.message, /<redacted>/)

  const text = definition.output.render({}, value)[0].text
  assert.ok(!text.includes(BARE_TOKEN), 'the text channel is the surface F2 found leaking')
  assert.ok(!text.includes(`${TOKEN}`), 'the process launch token must not appear either')
  assert.match(text, /<redacted>/)
})

test('F3: notes is present on every result, empty when there is nothing to say', async () => {
  const clean = createHarness().mount()
  assert.deepEqual((await clean.tools[0].execute({}, {})).notes, [])

  const notConfigured = createHarness({ config: { pairingAuthority: '' } }).mount()
  assert.deepEqual((await notConfigured.tools[0].execute({}, {})).notes, [])

  const unavailable = createHarness({ connectionMissing: true }).mount()
  assert.deepEqual((await unavailable.tools[0].execute({}, {})).notes, [])

  const warned = createHarness({ trustedHosts: ['other.example'] }).mount()
  assert.equal((await warned.tools[0].execute({}, {})).notes.length, 1)
})

test('F4: every audit record carries socketPeer and viaForwarded', () => {
  const harness = createHarness({ admit: () => ({ rejection: 401 }) }).mount()
  // Behind tailscale serve: the socket peer is the loopback, the header is the phone.
  harness.request({ headers: { 'x-forwarded-for': '100.64.0.2' }, remoteAddress: '127.0.0.1' })
  // Direct loopback access with no proxy in front.
  harness.request({ headers: {}, remoteAddress: '198.51.100.9' })
  // Neither fact available.
  harness.request({ headers: {} })

  const [proxied, direct, unknown] = auditRecords(harness)
  assert.equal(proxied.source, '100.64.0.2')
  assert.equal(proxied.socketPeer, '127.0.0.1')
  assert.equal(proxied.viaForwarded, true)

  assert.equal(direct.source, '198.51.100.9')
  assert.equal(direct.socketPeer, '198.51.100.9')
  assert.equal(direct.viaForwarded, false)

  assert.equal(unknown.source, 'unknown')
  assert.equal(unknown.socketPeer, 'unknown')
  assert.equal(unknown.viaForwarded, false)
})

test('F4: a spoofed loopback header is visible as a source/socketPeer mismatch', () => {
  const harness = createHarness({ admit: () => ({ rejection: 401 }) }).mount()
  harness.request({ headers: { 'x-forwarded-for': '127.0.0.1' }, remoteAddress: '100.64.0.2' })

  const [record] = auditRecords(harness)
  assert.equal(record.source, '127.0.0.1', 'the header still wins for display')
  assert.equal(record.socketPeer, '100.64.0.2', 'the kernel saw the real peer')
  assert.equal(record.viaForwarded, true)
  // ⇒ `source` alone is not evidence: T9/P4 must require the two to agree.
})

test('F5: the mount banner uses ctx.logger.info and bounds the authority', () => {
  const consoleLines = []
  const originalLog = console.log
  console.log = (...args) => {
    consoleLines.push(args.join(' '))
  }
  try {
    const pathological = 'a'.repeat(65536)
    const harness = createHarness({ config: { pairingAuthority: pathological } }).mount()

    assert.deepEqual(consoleLines, [], 'the banner must not go through console.log')
    const banner = harness.auditLines.find((line) => line.startsWith('dsh-mobile-remote mounted'))
    assert.ok(banner, 'the banner must go to ctx.logger.info')
    assert.ok(banner.length < 200, `the banner must stay bounded, got ${banner.length} chars`)
    assert.ok(banner.includes('…(len=65536)'), 'the summary must show that the value was truncated')
  } finally {
    console.log = originalLog
  }
})
