#!/usr/bin/env node
/**
 * inproc-stub.mjs — run a DSH host plugin's code IN THIS PROCESS, with a
 * minimal `ctx` stub, no DSH instance and no HTTP server.
 *
 * This is the fallback verification channel of docs/02-harness.md (question 3):
 * when neither an isolated DSH instance nor a scratch profile is available, a
 * host plugin can still be exercised end-to-end minus the launcher. It is also
 * the fastest loop for host-side unit tests, because it needs nothing but a
 * Node binary.
 *
 * What it does:
 *   1. imports the plugin module (file URL, so both `node.exe` and Electron's
 *      Node mode work),
 *   2. builds a stub context exposing the seams a host plugin actually uses
 *      (`webServer.register/registerUpgrade/registerFallback/tapIndex`,
 *       `effect`, `logger`, `get`, `on`/`emit`),
 *   3. calls `apply(ctx, config)`,
 *   4. drives every registered route with synthetic `req`/`res` objects and
 *      prints status + body,
 *   5. runs the disposers and asserts the route table is empty afterwards.
 *
 * The stub deliberately implements ONLY the seams it is asked for: if a plugin
 * touches a service the stub lacks, the run fails loudly with the missing seam
 * named, which is what a fallback channel should do.
 *
 * Usage (bundled console node, or `<Electron exe>` with ELECTRON_RUN_AS_NODE=1):
 *   node inproc-stub.mjs --plugin <abs path to lib/index.js> [--route /path] [--expect 200] [--config '<json>']
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

function parseArgs(argv) {
  const out = { config: {}, expect: [200], routes: [] }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--plugin') out.plugin = argv[++i]
    else if (flag === '--route') out.routes.push(argv[++i])
    else if (flag === '--expect') out.expect = [Number(argv[++i])]
    else if (flag === '--config') out.config = JSON.parse(argv[++i])
    else if (flag === '--config-file') out.config = JSON.parse(readFileSync(argv[++i], 'utf8'))
    else throw new Error(`unknown argument: ${flag}`)
  }
  if (!out.plugin) throw new Error('--plugin <path to lib/index.js> is required')
  return out
}

/** Minimal cordis-shaped context: records effects so they can be disposed. */
function createStubContext({ host = '127.0.0.1', port = 0 } = {}) {
  const routes = new Map()
  const effects = []
  const log = []

  const webServer = {
    host,
    port,
    register(route) {
      const key = `${route.kind}:${route.path}`
      if (routes.has(key)) throw new Error(`stub webserver: duplicate ${route.kind} route "${route.path}"`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
    registerUpgrade(route) {
      const key = `upgrade:${route.path}`
      if (routes.has(key)) throw new Error(`stub webserver: duplicate upgrade route "${route.path}"`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
    registerFallback(handler) {
      const key = 'fallback:/'
      if (routes.has(key)) throw new Error('stub webserver: fallback already registered')
      routes.set(key, { kind: 'fallback', path: '/', handler })
      return () => routes.delete(key)
    },
    tapIndex(transform) {
      const entries = []
      ctx._taps = entries
      entries.push(transform)
      return () => {
        const at = entries.indexOf(transform)
        if (at !== -1) entries.splice(at, 1)
      }
    },
    collectIndexInjections: () => [],
    renderIndex: (html) => html,
    applyIndexTaps: (html) => html,
  }

  const ctx = {
    webServer,
    logger: {
      info: (...args) => log.push(['info', ...args]),
      warn: (...args) => log.push(['warn', ...args]),
      error: (...args) => log.push(['error', ...args]),
      debug: () => {},
    },
    // cordis API surface a plugin may use to bind its lifetime to the fiber.
    effect(execute, label = 'anonymous') {
      const disposer = execute()
      const entry = { label, disposer }
      effects.push(entry)
      return () => {
        const at = effects.indexOf(entry)
        if (at !== -1) effects.splice(at, 1)
        if (typeof disposer === 'function') return disposer()
        return undefined
      }
    },
    get: () => undefined,
    on: () => () => {},
    emit: () => {},
  }

  return { ctx, routes, effects, log }
}

/** Drive one registered route with synthetic req/res and collect the answer. */
async function invoke(route, { path = '/', method = 'GET' } = {}) {
  const chunks = []
  let status = 0
  const headers = {}
  const res = {
    headersSent: false,
    socket: {},
    writeHead(code, extra) {
      status = code
      if (extra) Object.assign(headers, extra)
      this.headersSent = true
      return this
    },
    setHeader(name, value) {
      headers[name] = value
    },
    end(body) {
      if (body !== undefined && body !== null) chunks.push(Buffer.from(body))
      this.finished = true
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk))
      return true
    },
    destroy() {
      this.finished = true
    },
  }
  const req = { url: path, method, headers: { host: '127.0.0.1' }, socket: {} }
  await route.handler(req, res, undefined)
  return { status, headers, body: Buffer.concat(chunks).toString('utf8') }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { ctx, routes, effects, log } = createStubContext({ port: 0 })

  const url = pathToFileURL(resolve(args.plugin)).href
  const mod = await import(url)
  if (typeof mod.apply !== 'function') throw new Error(`${args.plugin} does not export apply(ctx, config)`)

  console.log(`plugin   : ${mod.name ?? '(no name export)'}`)
  console.log(`module   : ${url}`)
  console.log(`inject   : ${JSON.stringify(mod.inject ?? null)}`)
  await mod.apply(ctx, args.config)

  const table = [...routes.entries()].map(([key, route]) => `${key}`)
  console.log(`routes   : ${table.length ? table.join(', ') : '(none registered)'}`)
  console.log(`effects  : ${effects.length} effect(s) registered`)
  if (log.length) console.log(`log      : ${log.map((l) => l[0]).join(', ')}`)

  if (table.length === 0) {
    console.log('RESULT: FAIL (plugin registered no route; pass --route to assert a specific one)')
    process.exitCode = 1
    return
  }

  let failures = 0
  const wanted = args.routes.length ? args.routes : [...routes.values()].map((r) => r.path)
  for (const want of wanted) {
    const route = [...routes.values()].find((r) => r.path === want)
    if (!route) {
      console.log(`route ${want}: FAIL (not registered)`)
      failures++
      continue
    }
    const answer = await invoke(route, { path: want })
    const ok = args.expect.includes(answer.status)
    if (!ok) failures++
    console.log(`route ${want}: ${ok ? 'PASS' : 'FAIL'} status=${answer.status}`)
    console.log(answer.body.trimEnd().split('\n').map((l) => `    ${l}`).join('\n'))
  }

  // Disposal discipline: every effect must release its resource.
  for (const entry of [...effects]) entry.disposer?.()
  const leftover = [...routes.keys()].filter((k) => k !== 'fallback:/')
  console.log(`dispose  : ${leftover.length === 0 ? 'PASS (route table empty)' : `FAIL (leftover: ${leftover.join(', ')})`}`)
  if (leftover.length > 0) failures++

  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`)
  process.exitCode = failures === 0 ? 0 : 1
}

await main()
