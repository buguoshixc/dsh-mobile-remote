/**
 * T2 scaffold tests — run with `node --test` (see package.json `test`).
 *
 * These pin the three things every later task depends on and that are cheap to
 * break silently:
 *
 *  1. the host plugin's identity + the frozen Config defaults (docs/00-contract.md §3),
 *  2. the bundle patch's shape (one `insert` row, id/name exactly the package name),
 *  3. the two build artifacts: `lib/index.js` really is ESM, and `lib/client.js`
 *     really carries the `window.__ModuleLoader__.load({ id: "dsh-mobile-remote" })`
 *     handshake that dsh-client-modules keys its browser entry by.
 *
 * The artifacts must exist, so run `pnpm build` first (`pnpm verify` does
 * typecheck -> build -> test in that order).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import YAML from 'yaml'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const HOST_ARTIFACT = join(repoRoot, 'lib', 'index.js')
const CLIENT_ARTIFACT = join(repoRoot, 'lib', 'client.js')

/** Load the built host artifact (the same file a profile's loader imports). */
async function loadHostHalf() {
  try {
    return await import(pathToFileURL(HOST_ARTIFACT).href)
  } catch (error) {
    assert.fail(`cannot import ${HOST_ARTIFACT} — run \`pnpm build\` first (${error.message})`)
  }
}

/** Read a build artifact, failing with an actionable message when it is missing. */
function readArtifact(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    assert.fail(`cannot read ${file} — run \`pnpm build\` first (${error.message})`)
  }
}

/** Minimal cordis-shaped context: enough for a mount/unmount round trip. */
function createContextStub() {
  const effects = []
  return {
    ctx: {
      effect(execute, label = 'anonymous') {
        const entry = { label, disposer: execute() }
        effects.push(entry)
        return () => {
          const at = effects.indexOf(entry)
          if (at !== -1) effects.splice(at, 1)
          return typeof entry.disposer === 'function' ? entry.disposer() : undefined
        }
      },
      get: () => undefined,
      on: () => () => {},
      emit: () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    },
    disposeAll() {
      const pending = [...effects].reverse()
      effects.length = 0
      for (const entry of pending) {
        if (typeof entry.disposer === 'function') entry.disposer()
      }
      return pending.length
    },
  }
}

test('package.json identity matches the frozen contract', () => {
  assert.equal(pkg.name, 'dsh-mobile-remote')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(pkg.dsh.client, {
    platform: 'web',
    inject: ['slots'],
    external: ['react'],
  })
  for (const peer of ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'react']) {
    assert.ok(pkg.peerDependencies[peer], `${peer} must be a peerDependency`)
    assert.equal(pkg.peerDependenciesMeta[peer].optional, true, `${peer} must be an optional peer`)
  }
  for (const [dep, range] of Object.entries(pkg.peerDependencies)) {
    if (dep.startsWith('@deepseek-ai/dsh-')) {
      assert.equal(range, '0.2.0-rc.2', `${dep} must track the running DSH version`)
    }
  }
})

test('host half exports the cordis plugin quintet with the frozen Config defaults', async () => {
  const host = await loadHostHalf()

  assert.equal(host.name, pkg.name)
  assert.deepEqual(host.inject, ['webServer', 'connection'])
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof host.Config, 'function', 'Config must be a schemastery schema')

  // A native schemastery schema is recognised through this global symbol; a
  // plain object would make the launcher audit report the row as `unsupported`.
  assert.equal(host.Config[Symbol.for('schemastery')], true, 'Config must be a native schemastery schema')

  // Resolving an empty config must yield exactly the frozen defaults.
  const resolved = host.Config({})
  assert.equal(resolved.pairingAuthority, '')
  assert.equal(resolved.mobileCss, true)
  assert.equal(resolved.pushTopic, '')
  assert.equal(resolved.approvalTimeoutMs, 120000)
  assert.equal(resolved.auditLog, true)
})

test('host half mounts on a bare context and disposes without throwing', async () => {
  const host = await loadHostHalf()
  const stub = createContextStub()

  host.apply(stub.ctx, host.Config({}))
  assert.equal(stub.disposeAll(), 1, 'apply must register exactly one scaffold effect')
  assert.equal(stub.disposeAll(), 0, 'disposing twice must be a no-op')
})

test('cordis.patch.yml is one bundle insert row naming this package', () => {
  const patch = YAML.parse(readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8'))

  assert.ok(Array.isArray(patch), 'the patch must be a top-level YAML array')
  assert.equal(patch.length, 1, 'the bundle layer must contain exactly one patch block')

  const inserts = patch.flatMap((block) => (Array.isArray(block?.insert) ? block.insert : []))
  assert.equal(inserts.length, 1, 'exactly one inserted row')
  const [row] = inserts
  assert.equal(row.id, 'mobile-remote', 'the loader id is frozen to mobile-remote')
  assert.equal(row.name, pkg.name, 'the row name must equal package.json name verbatim')
  assert.ok(row.config === undefined || (typeof row.config === 'object' && row.config !== null))
})

test('client artifact carries the __ModuleLoader__ handshake keyed by the package name', () => {
  const source = readArtifact(CLIENT_ARTIFACT).trim()

  assert.ok(
    source.startsWith('window.__ModuleLoader__.load('),
    `client artifact must start with the loader handshake, got: ${source.slice(0, 64)}`,
  )
  // The footer closes the factory and the load() call; a trailing sourcemap
  // comment is allowed after it.
  assert.match(
    source,
    /\}\s*\}\);\s*(?:\/\/#\s*sourceMappingURL=\S+\s*)?$/,
    'client artifact must end with the closing load(...) call',
  )

  const id = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(source)
  assert.ok(id, 'the handshake must carry an explicit id')
  assert.equal(id[1], pkg.name, 'the handshake id must equal package.json name')

  assert.ok(
    source.includes('factory: (require) =>'),
    'the handshake must expose the factory(require) body the kernel materializes',
  )
  assert.match(source, /return module\.exports;/, 'the factory must return module.exports')
})

test('client artifact only reaches for react through require()', () => {
  const source = readArtifact(CLIENT_ARTIFACT)

  // Every non-relative module the bundle asks for must be an allowed external:
  // the browser module table only exposes react (+ react-dom and the dsh client
  // packages), and anything else throws loudly at materialization time.
  const requested = new Set()
  for (const match of source.matchAll(/require\(\s*"([^"]+)"\s*\)/g)) requested.add(match[1])
  for (const specifier of requested) {
    assert.equal(specifier, 'react', `unexpected external module in the client bundle: ${specifier}`)
  }
})

test('host artifact is an ESM module with a default-free named surface', () => {
  const source = readArtifact(HOST_ARTIFACT)

  assert.match(source, /export\s*\{/, 'host artifact must contain an ESM export statement')
  assert.doesNotMatch(source, /\bmodule\.exports\b/, 'host artifact must not be CommonJS')
  assert.doesNotMatch(source, /\brequire\(/, 'host artifact must not call require()')
})

test('sources stay UTF-8 without a BOM and free of GBK mojibake', () => {
  // t33: `src/hardening.ts` had shipped with **every** non-ASCII character
  // corrupted by a UTF-8 -> GBK round trip: the section sign became U+6402, an em
  // dash became U+9225, and a user-facing summary became a run of unrelated CJK
  // ideographs (U+9357 U+904D U+6AD3 ...). Nothing caught it: the file still
  // parsed, still type-checked, and the corrupted string only surfaced at runtime,
  // in a pending-approval summary. The characters spelled out in MOJIBAKE below
  // are the fingerprints of that corruption; none of them is legitimate anywhere
  // in this repository, so a match is always a fault. (They are spelled as escape
  // sequences on purpose — this comment must not contain them either.)
  const MOJIBAKE = /[\u6402\u9225\u9357\u904d\u6ad3\u748b\u51aa\u6564\u95c7\u7455\u4f77\u7c29\u5a06\u7481\u308f\u7d30]/
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|mjs)$/.test(entry.name)) files.push(full)
    }
  }
  walk(join(repoRoot, 'src'))
  walk(join(repoRoot, 'test'))
  assert.ok(files.length > 20, `expected to walk the source tree, found ${files.length} files`)

  for (const file of files) {
    const bytes = readFileSync(file)
    assert.notDeepEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${file} must stay UTF-8 **without** a BOM`,
    )
    const hit = MOJIBAKE.exec(bytes.toString('utf8'))
    assert.equal(hit, null, `${file} contains GBK mojibake: ${JSON.stringify(hit?.[0])}`)
  }
})

test('the repository carries no personal identifiers', () => {
  // t33: this repository is published on GitHub, and its first publication leaked
  // the operator's Tailscale device name and tailnet, the Windows account name
  // inside every absolute path, and the local workspace path. Those were removed
  // and the published history was rewritten; this test is what keeps them out.
  //
  // The rule is stated *structurally* rather than by listing the leaked values:
  // naming them here would put them straight back into the repository this test
  // exists to protect.
  const ALLOWED_AUTHORITIES = new Set(['demo.tailnet-example.ts.net'])
  const CHECKS = [
    {
      what: 'a tailnet authority that is not the documented placeholder',
      pattern: /[A-Za-z0-9-]+\.ts\.net/g,
      allowed: (host) => ALLOWED_AUTHORITIES.has(host) || host.includes('example'),
    },
    {
      // `C:\Users\user` (the neutral stand-in) and `C:\Users\<...>` (an explicit
      // placeholder) are fine; any other account name is the operator's.
      what: 'a personal Windows account name in a path',
      pattern: /C:\\+Users\\+(?!user\b|<)[^\\\s"'),;(]+/g,
      allowed: () => false,
    },
    {
      // Allowed roots, each for a stated reason:
      //   DSHD    - the product's own install path;
      //   work    - the neutral stand-in for the operator's workspace;
      //   nodejs  - a third-party runtime install path, which names no one;
      //   develop - the DSH *upstream* build path, quoted inside `dsh-css:` markers
      //             of the verbatim runtime copies under docs/evidence/;
      //   Users   - a bare drive root, with no account name in it;
      //   `.` / `<` - an elided or bracketed placeholder.
      what: 'a local path outside the neutral roots',
      pattern: /D:\\+(?!(?:DSHD|work|nodejs|develop|Users)\b|<|\.)[A-Za-z0-9_.-]+/g,
      allowed: () => false,
    },
  ]

  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|mjs|md|json|yml|yaml|ps1|txt|cjs)$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of ['src', 'test', 'tools', 'docs']) walk(join(repoRoot, dir))
  for (const name of ['README.md', 'package.json', 'cordis.patch.yml', 'tsconfig.json', 'tsdown.config.ts']) {
    files.push(join(repoRoot, name))
  }
  assert.ok(files.length > 80, `expected the whole documented repository, found ${files.length} files`)

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const check of CHECKS) {
      for (const match of text.matchAll(check.pattern)) {
        assert.ok(check.allowed(match[0]), `${relative(repoRoot, file)}: found ${check.what} — ${match[0]}`)
      }
    }
  }
})
