/**
 * t20 tests — the decision-link kernel (`src/decision.ts`).
 *
 * Judged by behaviour, not by reading: every refusal class has its own test, the
 * replay case must fail on the second attempt, and the vocabulary must never
 * coerce anything into `allow` (docs/00-contract.md §5 R2, task t20).
 *
 * The module is imported from source (`src/decision.ts`) — the same way the
 * client tests import `src/client/*.ts` — because it is a library that t10 will
 * import, not part of the built host bundle (which stays a single entry).
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const decision = await import(pathToFileURL(join(repoRoot, 'src', 'decision.ts')).href)

const {
  DECISIONS,
  FALLBACK_DECISION,
  TOKEN_VERSION,
  DEFAULT_TTL_MS,
  decisionKey,
  normalizeDecision,
  resolveDecision,
  signDecision,
  verifyDecisionSignature,
  DecisionStore,
} = decision

/** A fixed secret; tokens must never cross between different secrets. */
const SECRET = Buffer.alloc(32, 7)
const OTHER_SECRET = Buffer.alloc(32, 9)
const KEY = decisionKey(SECRET)
const OTHER_KEY = decisionKey(OTHER_SECRET)

/** A store with a controllable clock. */
function createStore(options = {}) {
  let now = options.now ?? 1_000_000
  const store = new DecisionStore({
    secret: SECRET,
    now: () => now,
    ...(options.store ?? {}),
  })
  return {
    store,
    at: () => now,
    setNow: (value) => {
      now = value
    },
    advance: (ms) => {
      now += ms
    },
  }
}

// ── vocabulary ───────────────────────────────────────────────────────────────

test('vocabulary: exactly four words, and each one round-trips', () => {
  assert.deepEqual([...DECISIONS], ['allow', 'deny', 'cancel', 'unavailable'])
  assert.equal(FALLBACK_DECISION, 'unavailable')
  for (const word of DECISIONS) assert.equal(normalizeDecision(word), word)
})

test('vocabulary: case variants, padding, empties and unknown words all become unavailable', () => {
  const rejected = [
    'Allow',
    'ALLOW',
    'Deny',
    'denied',
    'yes',
    'no',
    'true',
    '1',
    'approved',
    'allow ',
    ' allow',
    'allow\t',
    'deny\n',
    '',
    '   ',
    'unavailable!',
  ]
  for (const input of rejected) {
    assert.equal(normalizeDecision(input), 'unavailable', `"${input}" must not be accepted`)
  }
})

test('vocabulary: non-strings become unavailable, never a grant', () => {
  for (const input of [undefined, null, 0, 1, true, false, {}, [], { decision: 'allow' }]) {
    assert.equal(normalizeDecision(input), 'unavailable')
  }
  // The one thing that must never happen:
  assert.notEqual(normalizeDecision('Allow'), 'allow')
})

// ── pure signing half ────────────────────────────────────────────────────────

test('token: signing is deterministic and carries the v1 shape with the id and expiry signed', () => {
  const payload = { version: 1, id: 'dec-1', expiresAt: 2_000_000 }
  const first = signDecision(KEY, payload)
  const second = signDecision(KEY, payload)
  assert.equal(first, second)
  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

  // The body decodes to exactly the payload — id AND expiry are inside the MAC.
  const body = JSON.parse(Buffer.from(first.split('.')[1], 'base64url').toString('utf8'))
  assert.deepEqual(body, payload)

  const verdict = verifyDecisionSignature(KEY, first, 1_500_000, 'dec-1')
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.payload, payload)
})

test('token: a different secret cannot verify the token', () => {
  const token = signDecision(KEY, { version: 1, id: 'dec-1', expiresAt: 2_000_000 })
  const verdict = verifyDecisionSignature(OTHER_KEY, token, 1_500_000, 'dec-1')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'bad-signature')
})

test('token: swapping the URL id invalidates the signature (id is bound, not decorative)', () => {
  const token = signDecision(KEY, { version: 1, id: 'dec-1', expiresAt: 2_000_000 })
  const same = verifyDecisionSignature(KEY, token, 1_500_000, 'dec-1')
  assert.equal(same.ok, true)

  const swapped = verifyDecisionSignature(KEY, token, 1_500_000, 'dec-2')
  assert.equal(swapped.ok, false)
  assert.equal(swapped.code, 'bad-signature')
})

test('token: re-signing another expiry changes the MAC (expiry is bound too)', () => {
  const shortToken = signDecision(KEY, { version: 1, id: 'dec-1', expiresAt: 2_000_000 })
  const longToken = signDecision(KEY, { version: 1, id: 'dec-1', expiresAt: 9_999_999 })
  assert.notEqual(shortToken, longToken)

  // A token whose body was edited to extend the expiry no longer verifies.
  const parts = shortToken.split('.')
  const forgedBody = Buffer.from(JSON.stringify({ version: 1, id: 'dec-1', expiresAt: 9_999_999 }), 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
  const forged = `v1.${forgedBody}.${parts[2]}`
  const verdict = verifyDecisionSignature(KEY, forged, 1_500_000, 'dec-1')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'bad-signature')
})

test('token: malformed shapes are rejected as malformed, not as a signature failure', () => {
  const valid = signDecision(KEY, { version: 1, id: 'dec-1', expiresAt: 2_000_000 })
  const [version, body, mac] = valid.split('.')
  const cases = [
    '',
    'v1',
    `${version}.${body}`,
    `${version}.${body}.${mac}.extra`,
    `v2.${body}.${mac}`,
    `${version}.${body}.not base64url!`,
    // A non-canonical base64url tail: the final sextet of a 32-byte MAC must
    // carry zero low bits, so replacing the last character is a *format* error.
    `${version}.${body}.${mac.slice(0, -1)}x`,
  ]
  for (const token of cases) {
    const verdict = verifyDecisionSignature(KEY, token, 1_500_000, 'dec-1')
    assert.equal(verdict.ok, false, `token "${token}" must not verify`)
    assert.equal(verdict.code, 'malformed', `token "${token}"`)
  }
})

test('token: an edited body is a signature failure, an authorized-but-invalid body is malformed', () => {
  const valid = signDecision(KEY, { version: 1, id: 'dec-1', expiresAt: 2_000_000 })
  const [version, , mac] = valid.split('.')
  const notJson = Buffer.from('not json', 'utf8').toString('base64url')
  const missingId = Buffer.from('{"version":1}', 'utf8').toString('base64url')

  // The MAC is verified before the body is parsed, so reusing a valid MAC with a
  // different body can never look like a payload problem.
  for (const body of [notJson, missingId]) {
    const verdict = verifyDecisionSignature(KEY, `v1.${body}.${mac}`, 1_500_000, 'dec-1')
    assert.equal(verdict.ok, false)
    assert.equal(verdict.code, 'bad-signature', `body ${body}`)
  }

  // Properly signed by the real key, but not a payload this module signs: an
  // undecodable body, a body that is not JSON, and a JSON body missing fields.
  for (const body of ['***', notJson, missingId]) {
    const signed = createHmac('sha256', KEY).update(body).digest('base64url')
    const verdict = verifyDecisionSignature(KEY, `v1.${body}.${signed}`, 1_500_000, 'dec-1')
    assert.equal(verdict.ok, false)
    assert.equal(verdict.code, 'malformed', `body ${body}`)
  }
})

test('token: empty secret material is refused loudly (no accidental universal key)', () => {
  assert.throws(() => decisionKey(''), /non-empty signing secret/)
  assert.throws(() => decisionKey(new Uint8Array(0)), /non-empty signing secret/)
  assert.throws(() => new DecisionStore({ secret: '' }), /non-empty signing secret/)
})

test('token: the derived key is 32 bytes, stable, and domain-separated from the input secret', () => {
  const a = decisionKey(SECRET)
  const b = decisionKey(SECRET)
  assert.equal(a.byteLength, 32)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, OTHER_KEY)
  // The raw secret must not be recoverable from the token text.
  const token = signDecision(a, { version: 1, id: 'dec-1', expiresAt: 2_000_000 })
  assert.ok(!token.includes(SECRET.toString('base64url')))
})

// ── store: four refusal classes, each on its own ─────────────────────────────

test('refusal 1/4 — bad signature: a tampered token is refused and consumes nothing', () => {
  const clock = createStore()
  const issued = clock.store.issue()

  // Tamper inside the MAC while keeping the base64url canonical: replacing the
  // tail would be a *format* error (see the malformed test), not a MAC mismatch.
  const [version, body, mac] = issued.t.split('.')
  const tampered = `${version}.${body}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`
  const verdict = clock.store.verify({ id: issued.id, t: tampered })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'bad-signature')

  // Nothing was consumed: the untouched link still works.
  assert.equal(clock.store.pending().length, 1)
  assert.equal(clock.store.verify({ id: issued.id, t: issued.t }).ok, true)
})

test('refusal 2/4 — used: the second attempt with the same link is a replay', () => {
  const clock = createStore()
  const issued = clock.store.issue()

  const first = clock.store.verify({ id: issued.id, t: issued.t })
  assert.equal(first.ok, true)
  assert.equal(first.id, issued.id)
  assert.equal(first.pending.expiresAt, issued.expiresAt)

  const second = clock.store.verify({ id: issued.id, t: issued.t })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'used')

  // Consumed means gone from the table and remembered as used.
  assert.deepEqual(clock.store.pending(), [])
  assert.equal(clock.store.isUsed(issued.id), true)

  // A third attempt is still a replay, not an "unknown".
  assert.equal(clock.store.verify({ id: issued.id, t: issued.t }).code, 'used')
})

test('refusal 3/4 — expired: the boundary instant is already expired, and expiry consumes nothing', () => {
  const clock = createStore()
  const issued = clock.store.issue({ ttlMs: 1000 })
  assert.equal(issued.expiresAt, clock.at() + 1000)

  // One millisecond before the deadline the link is good — and it consumes.
  const justBefore = clock.store.verify({ id: issued.id, t: issued.t }, issued.expiresAt - 1)
  assert.equal(justBefore.ok, true, 'now < expiresAt must still be accepted')
  const replay = clock.store.verify({ id: issued.id, t: issued.t }, issued.expiresAt - 1)
  assert.equal(replay.code, 'used')

  // The boundary itself: `now === expiresAt` is already expired.
  const other = clock.store.issue({ ttlMs: 1000 })
  const atDeadline = clock.store.verify({ id: other.id, t: other.t }, other.expiresAt)
  assert.equal(atDeadline.ok, false)
  assert.equal(atDeadline.code, 'expired', 'now === expiresAt is already expired')
  // An expired link must NOT burn the id: the row is still pending…
  assert.equal(clock.store.pending().length, 1)
  assert.equal(clock.store.isUsed(other.id), false)
  // …and it would still be usable before the deadline (proves nothing was consumed).
  const stillAlive = clock.store.verify({ id: other.id, t: other.t }, other.expiresAt - 1)
  assert.equal(stillAlive.ok, true)
})

test('refusal 4/4 — unknown: a well-signed id that is not pending is refused', () => {
  const clock = createStore()
  const stranger = new DecisionStore({ secret: SECRET, now: () => clock.at() })
  const foreign = stranger.issue()

  // Valid MAC (same secret), but this store never minted that id.
  const verdict = clock.store.verify({ id: foreign.id, t: foreign.t })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'unknown')
  assert.equal(clock.store.pending().length, 0)
})

test('refusal order: malformed input is answered before any state is consulted', () => {
  const clock = createStore()
  const issued = clock.store.issue()
  for (const input of [{}, { id: issued.id }, { id: '', t: issued.t }, { id: issued.id, t: '' }, null, undefined]) {
    const verdict = clock.store.verify(input)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.code, 'malformed')
  }
  assert.equal(clock.store.pending().length, 1, 'no refusal may consume the pending row')
})

// ── pending table ────────────────────────────────────────────────────────────

test('pending: rows carry id, created/expiry times and the display context', () => {
  const clock = createStore()
  const issued = clock.store.issue({ summary: 'run rm -rf build', subject: 'bash' })

  assert.deepEqual(clock.store.pending(), [issued.pending])
  assert.equal(issued.pending.summary, 'run rm -rf build')
  assert.equal(issued.pending.subject, 'bash')
  assert.equal(issued.pending.createdAt, clock.at())
  assert.equal(issued.pending.expiresAt, clock.at() + DEFAULT_TTL_MS)
})

test('pending: the table is bounded, and the dropped id becomes unknown', () => {
  const clock = createStore({ store: { pendingLimit: 2 } })
  const first = clock.store.issue()
  clock.store.issue()
  clock.store.issue()

  assert.equal(clock.store.pending().length, 2)
  assert.equal(clock.store.verify({ id: first.id, t: first.t }).code, 'unknown')
})

test('prune: removes only expired rows, leaving live links decidable', () => {
  const clock = createStore()
  const dying = clock.store.issue({ ttlMs: 100 })
  const living = clock.store.issue({ ttlMs: 10_000 })

  clock.advance(200)
  assert.equal(clock.store.prune(), 1)
  assert.deepEqual(clock.store.pending().map((row) => row.id), [living.id])
  assert.equal(clock.store.verify({ id: living.id, t: living.t }).ok, true)
  // Expiry is carried by the signed payload, so it is decided before the table
  // is consulted: a pruned expired link is still reported as expired, not as
  // unknown (only a *live* id that vanished from the table is unknown).
  assert.equal(clock.store.verify({ id: dying.id, t: dying.t }).code, 'expired')
})

test('issue: an invalid lifetime is refused instead of producing a broken link', () => {
  const clock = createStore()
  for (const ttlMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => clock.store.issue({ ttlMs }), /ttlMs must be a positive integer/)
  }
  assert.equal(clock.store.pending().length, 0)
})

test('integration shape: id + token are the two URL parameters R2 expects', () => {
  const clock = createStore()
  const issued = clock.store.issue()
  // `?d=<id>&t=<base64url>` — both URL-safe, no encoding surprises.
  assert.match(issued.id, /^[0-9a-f-]{36}$/)
  assert.match(issued.t, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  const search = new URLSearchParams({ d: issued.id, t: issued.t }).toString()
  assert.equal(search.includes('+'), false)
  assert.equal(decodeURIComponent(search).includes(issued.t), true)
  assert.equal(TOKEN_VERSION, 'v1')
})

test('issue: expired rows never consume the pending bound', () => {
  const clock = createStore({ store: { pendingLimit: 2, ttlMs: 100 } })
  const dead = clock.store.issue()
  clock.advance(200)
  const live1 = clock.store.issue({ ttlMs: 10_000 })
  const live2 = clock.store.issue({ ttlMs: 10_000 })

  // With prune-on-issue the bound holds live rows only; without it the dead row
  // would have evicted one of them.
  assert.equal(clock.store.pending().length, 2)
  assert.equal(clock.store.verify({ id: live1.id, t: live1.t }).ok, true)
  assert.equal(clock.store.verify({ id: live2.id, t: live2.t }).ok, true)
  assert.equal(clock.store.verify({ id: dead.id, t: dead.t }).code, 'expired')
})

// ── fail-closed composition (what t10 will actually call) ────────────────────

test('resolve: every one of the four refusal classes yields unavailable, never a grant', () => {
  const clock = createStore()

  // 1/4 bad signature
  const tamperSource = clock.store.issue()
  const [v, b, mac] = tamperSource.t.split('.')
  const badSignature = clock.store.verify({
    id: tamperSource.id,
    t: `${v}.${b}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`,
  })
  // 2/4 used (replay of a consumed link)
  const consumed = clock.store.issue()
  assert.equal(clock.store.verify({ id: consumed.id, t: consumed.t }).ok, true)
  const used = clock.store.verify({ id: consumed.id, t: consumed.t })
  // 3/4 expired
  const dying = clock.store.issue({ ttlMs: 1000 })
  const expired = clock.store.verify({ id: dying.id, t: dying.t }, dying.expiresAt)
  // 4/4 unknown (signed with the same secret, but never minted by this store)
  const stranger = new DecisionStore({ secret: SECRET, now: clock.at })
  const foreign = stranger.issue()
  const unknown = clock.store.verify({ id: foreign.id, t: foreign.t })
  // plus malformed, the fifth closed class
  const malformed = clock.store.verify({ id: '', t: '' })

  const refused = [['bad-signature', badSignature], ['used', used], ['expired', expired], ['unknown', unknown], ['malformed', malformed]]
  for (const [expected, verdict] of refused) {
    assert.equal(verdict.ok, false, expected)
    assert.equal(verdict.code, expected)
    for (const rawWord of ['allow', 'yes', 'Allow ', undefined, null, {}]) {
      const resolved = resolveDecision(verdict, rawWord)
      assert.equal(resolved.ok, false)
      assert.equal(resolved.code, expected)
      assert.equal(resolved.word, 'unavailable', `${expected} + ${JSON.stringify(rawWord)} must not grant`)
    }
  }
})

test('resolve: a verified link carries the normalized word, and garbage is unavailable', () => {
  const clock = createStore()
  const accepts = [
    ['allow', 'allow'],
    ['deny', 'deny'],
    ['cancel', 'cancel'],
    ['unavailable', 'unavailable'],
    ['Allow', 'unavailable'],
    ['yes', 'unavailable'],
    [' allow', 'unavailable'],
    ['', 'unavailable'],
    [undefined, 'unavailable'],
    [42, 'unavailable'],
  ]
  for (const [rawWord, expected] of accepts) {
    const issued = clock.store.issue()
    const verdict = clock.store.verify({ id: issued.id, t: issued.t })
    const resolved = resolveDecision(verdict, rawWord)
    assert.equal(resolved.ok, true)
    assert.equal(resolved.id, issued.id)
    assert.equal(resolved.code, 'ok')
    assert.equal(resolved.word, expected, `${JSON.stringify(rawWord)} -> ${expected}`)
  }
  // The verified link is consumed either way: a garbled answer still decides.
  assert.deepEqual(clock.store.pending(), [])
})
