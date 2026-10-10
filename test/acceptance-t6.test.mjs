/**
 * T6 acceptance suite — independent of the implementers' tests.
 *
 * Everything here is measured on the *shipped artifacts* (`lib/index.js`,
 * `lib/client.js`, `cordis.patch.yml`) through externally observable signals:
 * real HTTP status lines and bodies over `node:http`, captured audit sink
 * lines, and artifact bytes. No implementer test is imported, and no private
 * module is reached into.
 *
 * The admission fence is a stub that reproduces the shipped rule verbatim
 * (host required → loopback or trusted → `Sec-Fetch-Site: cross-site` refusal →
 * Origin same-host → browser cookie) so the plugin's own decisions are what is
 * under test; the real shipped `HostConnectionService` is exercised separately
 * on the scratch instance (docs/03-verification.md §2).
 *
 * The server binds 127.0.0.1 on an OS-assigned port and is closed in the test,
 * so the suite never touches 19387 and never leaves a listener behind.
 */
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = await import(pathToFileURL(join(repoRoot, 'lib', 'index.js')).href)

const AUTHORITY = 'demo.tailnet-example.ts.net'
const TOKEN = 'ACCEPTANCE-TOKEN-0123456789abcdef'
const COOKIE = 'dsh-auth-acceptance=v1.acceptance'

/** Faithful copy of the shipped fence's decision order (evidence :205-219, :586-594). */
function shippedRule(req, { trustedHosts = [AUTHORITY] } = {}) {
  const headers = req.headers ?? {}
  const hostHeader = headers['host']
  if (hostHeader === undefined) return { rejection: 403 }
  let hostUrl
  try { hostUrl = new URL(`http://${hostHeader}`) } catch { return { rejection: 403 } }
  const name = hostUrl.hostname
  const loopback = name === 'localhost' || name === '[::1]' || /^127\./.test(name)
  const trusted = trustedHosts.some((entry) => {
    try { return new URL(`http://${entry}`).host === hostUrl.host } catch { return false }
  })
  if (!loopback && !trusted) return { rejection: 403 }
  if (headers['sec-fetch-site'] === 'cross-site') return { rejection: 403 }
  const origin = headers['origin']
  if (origin !== undefined) {
    try { if (new URL(origin).host !== hostUrl.host) return { rejection: 403 } } catch { return { rejection: 403 } }
  }
  return String(headers['cookie'] ?? '').includes(COOKIE) ? { peer: { id: 'operator' } } : { rejection: 401 }
}

function mountPlugin({ admit, others = {}, config = {} } = {}) {
  const routes = []
  const tools = []
  const effects = []
  const logLines = []
  const services = {
    // The shipped route table throws on a duplicate (kind, path): evidence
    // dsh-host-webserver__lib__index.js:177-179. Mirrored here so a double mount
    // is a real failure and not a silent stack of two handlers.
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
      admit: admit ?? ((req) => shippedRule(req)),
      authenticatedUrl: (base) => `${base}?token=${TOKEN}`,
    },
    webRuntime: { trustedHosts: [AUTHORITY] },
    tools: { register: (tool) => { tools.push(tool); return () => tools.splice(tools.indexOf(tool), 1) } },
    ...others,
  }
  const ctx = {
    ...services,
    effect: (fn) => { const d = fn(); effects.push(d); return () => { if (typeof d === 'function') d() } },
    get: (serviceName) => services[serviceName],
    logger: { info: (line) => logLines.push(String(line)), warn: () => {}, error: () => {} },
    // A real cordis `inject` callback receives a *scoped context* that can own
    // effects; the tool registration must be disposed with the plugin, so the
    // scoped object here carries the same effect bookkeeping.
    inject: (_names, callback) => {
      callback({
        tools: services.tools,
        effect: (fn) => { const d = fn(); effects.push(d); return () => { if (typeof d === 'function') d() } },
      })
      return () => {}
    },
  }
  host.apply(ctx, host.Config({ pairingAuthority: AUTHORITY, ...config }))
  return { ctx, routes, tools, effects, logLines }
}

/** Wire the plugin's captured route onto a real HTTP server (ephemeral port). */
async function serve(routes) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://local.invalid').pathname
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    if (route === undefined) { res.writeHead(404); res.end(); return }
    try { route.handler(req, res) } catch { if (!res.headersSent) { res.writeHead(400); res.end() } }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    port,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}

const call = (port, path, { method = 'GET', headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers, setHost: false, agent: false },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', reject)
    req.end()
  })

// ── 1. artifacts and their handshakes ────────────────────────────────────────

test('artifacts: both halves exist with the frozen handshakes and the ESM host surface', () => {
  const client = readFileSync(join(repoRoot, 'lib', 'client.js'), 'utf8').trim()
  assert.ok(client.startsWith('window.__ModuleLoader__.load('), `client handshake: ${client.slice(0, 48)}`)
  assert.match(client, /id:\s*"dsh-mobile-remote"/)
  const dts = readFileSync(join(repoRoot, 'lib', 'index.d.ts'), 'utf8')
  for (const symbol of ['apply', 'Config', 'inject', 'name']) assert.match(dts, new RegExp(`\\b${symbol}\\b`), symbol)
  assert.equal(host.name, 'dsh-mobile-remote')
  assert.deepEqual(host.inject, ['webServer', 'connection'])
})

test('config: the five frozen keys with frozen defaults', () => {
  // T9/P4 added eight hardening keys (docs/06-hardening-contract.md §3); the five
  // P1 keys keep exactly these values.
  const resolved = host.Config({})
  for (const [key, value] of Object.entries({
    pairingAuthority: '',
    mobileCss: true,
    pushTopic: '',
    approvalTimeoutMs: 120_000,
    auditLog: true,
  })) {
    assert.deepEqual(resolved[key], value, `${key} must keep its frozen default`)
  }
})

test('bundle patch: exactly one insert row naming this package', async () => {
  const { default: YAML } = await import('yaml')
  const rows = YAML.parse(readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8'))
  assert.ok(Array.isArray(rows))
  const insert = rows.find((row) => Array.isArray(row?.insert))
  assert.ok(insert, 'an insert row is present')
  assert.equal(insert.insert.length, 1)
  assert.equal(insert.insert[0].name, 'dsh-mobile-remote')
  assert.equal(insert.insert[0].id, 'mobile-remote')
})

// ── 2. the route, over real HTTP ─────────────────────────────────────────────

test('route: exact registration, refusal leaks nothing, admission succeeds with the cookie', async () => {
  const mounted = mountPlugin()
  const server = await serve(mounted.routes)
  try {
    assert.equal(mounted.routes.length, 5, 'pair + decide + state + revoke + register (T9)')
    const pair = mounted.routes.find((route) => route.path === '/mobile-remote/pair')
    assert.ok(pair, 'the pair route is registered')
    assert.equal(pair.kind, 'exact')
    assert.ok(mounted.routes.every((route) => route.kind === 'exact'))

    const refused = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY } })
    assert.equal(refused.status, 401)
    assert.equal(refused.body, 'unauthorized')
    assert.equal(refused.body.includes('http'), false)
    assert.equal(refused.body.includes(TOKEN), false)
    assert.equal(refused.headers['content-type'], 'text/plain; charset=utf-8')
    assert.equal(refused.headers['cache-control'], 'no-store')

    const loopback = await call(server.port, '/mobile-remote/pair', { headers: { Host: `127.0.0.1:${server.port}` } })
    assert.equal(loopback.status, 401, 'loopback is trusted by the fence but still needs the cookie')

    const evil = await call(server.port, '/mobile-remote/pair', { headers: { Host: 'evil.example.com', Cookie: COOKIE } })
    assert.equal(evil.status, 403)
    assert.equal(evil.body, 'forbidden')

    const crossSite = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
    const foreignOrigin = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE, Origin: 'https://evil.example.com' } })
    assert.equal(foreignOrigin.status, 403)

    const admitted = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE } })
    assert.equal(admitted.status, 200)
    assert.equal(admitted.headers['content-type'], 'application/json; charset=utf-8')
    const body = JSON.parse(admitted.body)
    assert.deepEqual(Object.keys(body).sort(), ['authority', 'expiresAt', 'url'])
    assert.equal(body.authority, AUTHORITY)
    assert.equal(body.expiresAt, null)
    const parsed = new URL(body.url)
    assert.equal(parsed.searchParams.get('token'), TOKEN, 'token parameter name is TOKEN_QUERY ("token")')
    assert.equal(parsed.origin, `https://${AUTHORITY}`)

    const head = await call(server.port, '/mobile-remote/pair', { method: 'HEAD', headers: { Host: AUTHORITY, Cookie: COOKIE } })
    assert.equal(head.status, 200)
    assert.equal(head.body, '')
    const post = await call(server.port, '/mobile-remote/pair', { method: 'POST', headers: { Host: AUTHORITY, Cookie: COOKIE, 'Content-Length': '0' } })
    assert.equal(post.status, 405)
    const postNoAuth = await call(server.port, '/mobile-remote/pair', { method: 'POST', headers: { Host: AUTHORITY, 'Content-Length': '0' } })
    assert.equal(postNoAuth.status, 401, 'admission is decided before the method')
  } finally {
    await server.close()
  }
})

test('audit: sink lines carry the frozen fields and never a token, cookie or query string', async () => {
  const mounted = mountPlugin()
  const server = await serve(mounted.routes)
  try {
    await call(server.port, `/mobile-remote/pair?token=${TOKEN}&x=1`, {
      headers: { Host: AUTHORITY, Cookie: COOKIE, 'X-Forwarded-For': `203.0.113.7?token=${TOKEN}` },
    })
    await call(server.port, '/mobile-remote/pair', { headers: { Host: 'evil.example.com', Cookie: COOKIE, 'X-Forwarded-For': '198.51.100.9' } })
    const lines = mounted.logLines.filter((line) => line.includes('mobile-remote/access'))
    assert.equal(lines.length, 2)
    const records = lines.map((line) => JSON.parse(line))
    for (const record of records) {
      for (const key of Object.keys(record)) {
        // The frozen six plus the three optional fields the audit contract allows
        // (status/detail) and the source-corroboration pair added by the T7 review
        // follow-up (socketPeer/viaForwarded) — nothing else may appear.
        assert.equal(
          ['ts', 'event', 'method', 'path', 'result', 'source', 'status', 'detail', 'socketPeer', 'viaForwarded', 'forwarded'].includes(key),
          true,
          `unexpected audit key ${key}`,
        )
      }
      for (const key of ['ts', 'event', 'method', 'path', 'result', 'source']) {
        assert.equal(key in record, true, `missing audit key ${key}`)
      }
      assert.equal(record.event, 'mobile-remote/access')
      assert.equal(record.path, '/mobile-remote/pair')
    }
    assert.equal(records[0].source, '203.0.113.7')
    assert.equal(records[1].result, 'forbidden')
    const joined = lines.join('\n')
    assert.equal(joined.includes(TOKEN), false)
    assert.equal(joined.includes('v1.acceptance'), false)
    assert.equal(joined.includes('?'), false)
  } finally {
    await server.close()
  }
})

// ── 3. adversarial cases (each reported as its own assertion) ────────────────

test('adversarial: malformed admission answers must all fail closed (no token for a non-grant)', async () => {
  const shapes = [
    ['{rejection: "403"} (string)', { rejection: '403' }],
    ['{rejection: null}', { rejection: null }],
    ['{} (no rejection key)', {}],
    ['undefined', undefined],
    ['true', true],
    ['"denied"', 'denied'],
    ['[]', []],
    ['pending Promise (async admit)', new Promise(() => {})],
  ]
  const servers = []
  try {
    for (const [label, answer] of shapes) {
      const mounted = mountPlugin({ admit: () => answer })
      const server = await serve(mounted.routes)
      servers.push(server)
      const result = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY } })
      assert.equal(result.status === 401 || result.status === 403, true, `${label} answered ${result.status} ${result.body.slice(0, 40)}`)
      assert.equal(result.body.includes(TOKEN), false, `${label} leaked the token`)
      assert.equal(result.body.includes('https://'), false, `${label} leaked a URL`)
    }
  } finally {
    await Promise.all(servers.map((server) => server.close()))
  }
})

test('adversarial: a throwing admit is a 403 without a stack; a missing service is a 403', async () => {
  const throwing = mountPlugin({ admit: () => { throw new Error('fence exploded /secrets/path.js:12') } })
  const server = await serve(throwing.routes)
  try {
    const result = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY } })
    assert.equal(result.status, 403)
    assert.equal(result.body, 'forbidden')
    assert.equal(/at |\.js:\d/.test(result.body), false)
    const sink = throwing.logLines.join('\n')
    assert.equal(sink.includes('mobile-remote/access'), true, 'the refusal is audited')
  } finally {
    await server.close()
  }
  const missing = mountPlugin({ others: { connection: undefined } })
  const server2 = await serve(missing.routes)
  try {
    const result = await call(server2.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY } })
    assert.equal(result.status, 403)
    assert.equal(result.body, 'forbidden')
  } finally {
    await server2.close()
  }
})

test('adversarial: authority pathologies stay quiet 503s (CRLF, path, scheme, 64 KiB, zero-padded port)', async () => {
  const cases = [
    ['CRLF', 'demo.tailnet-example.ts.net\r\nX-Injected: 1'],
    ['path', 'demo.tailnet-example.ts.net/path'],
    ['scheme', `https://${AUTHORITY}`],
    ['userinfo', `operator@${AUTHORITY}`],
    ['zero-padded port', `${AUTHORITY}:080`],
    ['64 KiB', `${'a'.repeat(65_500)}.example`],
  ]
  const servers = []
  try {
    for (const [label, authority] of cases) {
      const mounted = mountPlugin({ config: { pairingAuthority: authority } })
      const server = await serve(mounted.routes)
      servers.push(server)
      const result = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE } })
      if (label === '64 KiB') {
        // A syntactically bare authority is accepted; the point is that nothing crashes.
        assert.equal([200, 503].includes(result.status), true, `64 KiB answered ${result.status}`)
      } else {
        assert.equal(result.status, 503, `${label} answered ${result.status}`)
        assert.equal(result.body, 'pairing not configured')
        assert.equal(result.body.includes('X-Injected'), false)
      }
    }
  } finally {
    await Promise.all(servers.map((server) => server.close()))
  }
})

test('adversarial: query/path shapes never reach the audit string and never echo client text', async () => {
  const mounted = mountPlugin()
  const server = await serve(mounted.routes)
  try {
    const targets = [
      '/mobile-remote/pair?token=ATTACKER',
      '/mobile-remote/pair?x=../../api/remote.mux',
      '/mobile-remote/pair#frag',
    ]
    for (const target of targets) {
      const result = await call(server.port, target, { headers: { Host: AUTHORITY, Cookie: COOKIE, 'X-Forwarded-For': 'evil<script>alert(1)</script>' } })
      assert.equal(result.body.includes('<script>'), false, target)
      assert.equal(result.body.includes('ATTACKER'), false, target)
    }
    // Percent-encoded separators are not normalized into this route.
    const encoded = await call(server.port, '/mobile-remote/pair%2f..%2f..%2fapi', { headers: { Host: AUTHORITY, Cookie: COOKIE } })
    assert.equal(encoded.status, 404)

    const records = mounted.logLines.filter((line) => line.includes('mobile-remote/access')).map((line) => JSON.parse(line))
    assert.equal(records.length, targets.length)
    const paths = records.map((record) => record.path)
    assert.deepEqual([...new Set(paths)], ['/mobile-remote/pair'])
    const sources = records.map((record) => record.source)
    assert.deepEqual([...new Set(sources)], ['evil'])
  } finally {
    await server.close()
  }
})

test('adversarial: duplicate mount, dispose, and concurrency on a real server', async () => {
  const mounted = mountPlugin()
  const server = await serve(mounted.routes)
  try {
    const first = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE } })
    assert.equal(first.status, 200)

    // A second registration on the real webserver is refused by its route table
    // (duplicate exact route): the stub mirrors that contract.
    const second = mountPlugin()
    let duplicate = null
    try { host.apply(second.ctx, host.Config({ pairingAuthority: AUTHORITY })) } catch (error) { duplicate = error }
    assert.match(String(duplicate?.message), /duplicate exact route/)
    const stillServing = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE } })
    assert.equal(stillServing.status, 200, 'the first registration survives the failed second mount')

    const responses = await Promise.all(Array.from({ length: 50 }, () =>
      call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE } })))
    assert.equal(new Set(responses.map((r) => r.status)).size, 1)
    assert.equal(responses[0].status, 200)
    assert.equal(new Set(responses.map((r) => JSON.parse(r.body).url)).size, 1, 'one URL for concurrent calls')

    // dispose releases the route (the server then answers 404) and the tool
    for (const dispose of mounted.effects) if (typeof dispose === 'function') dispose()
    assert.equal(mounted.tools.length, 0, 'tool released with the plugin')
    const afterDispose = await call(server.port, '/mobile-remote/pair', { headers: { Host: AUTHORITY, Cookie: COOKIE } })
    assert.equal(afterDispose.status, 404)
  } finally {
    await server.close()
  }
})

test('adversarial: the tool is read-only and concurrent calls agree', async () => {
  const mounted = mountPlugin()
  const tool = mounted.tools[0]
  assert.equal(tool.name, 'mobile_pair_url')
  assert.deepEqual(tool.parameters, { type: 'object', properties: {} })
  const results = await Promise.all(Array.from({ length: 25 }, () => tool.execute({}, {})))
  assert.equal(results.every((result) => result.ok === true), true)
  assert.equal(new Set(results.map((result) => result.url)).size, 1)
  assert.equal(new Set(results.map((result) => result.expiresAt)).size, 1)
  assert.equal(results[0].expiresAt, null)
})
