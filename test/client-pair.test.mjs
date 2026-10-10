/**
 * T4 tests — the pairing card and its QR encoder (`node --test`).
 *
 * Four groups, one per acceptance criterion, plus the artifact checks that keep
 * the browser half honest:
 *
 *  1. **the encoder itself** — pinned module-matrix hashes for a short fixed
 *     string and for a real-length pairing URL, the published capacity series,
 *     the published format/version BCH constants, and structural invariants;
 *  2. **an independent decode** of what the encoder produced: the test rebuilds
 *     the function-pattern map, reads the format information, unmasks, extracts
 *     the codewords, de-interleaves them, verifies every block's Reed–Solomon
 *     syndromes with its own GF(256) and parses the payload back out. A decode
 *     path that shares no code with the encoder is what makes a matrix hash mean
 *     something;
 *  3. **the card state machine** — every branch of `interpretPairResponse` and
 *     `loadPairState`, including the four reasons the card can show;
 *  4. **mounting** — `apply(ctx)` injects the stylesheet, registers the frozen
 *     slots and cleans up on dispose; the silent-degradation paths (no `slots`,
 *     `inject` throwing, `register` throwing) never throw.
 *
 * The artifacts must exist: `pnpm build` precedes `pnpm test` in `pnpm verify`.
 *
 * ## Cross-check performed outside this file
 *
 * On 2026-10-10 the encoder was compared, module for module, against
 * `qrcode@1.5.4` (the reference npm implementation, installed in a throwaway
 * directory outside this repository — it is **not** a dependency of this
 * package): six payloads from 5 to 213 bytes, each at all eight masks, byte
 * mode, level M. All 48 matrices matched exactly, and the automatically selected
 * version matched on all six. The block below is the whole reproduction recipe:
 *
 * ```js
 * const QRCode = require('<temp>/node_modules/qrcode')
 * const mine = await import('./src/client/qr.ts')
 * const bytes = mine.payloadBytes(text)
 * const ref = QRCode.create([{ data: Buffer.from(text, 'utf8'), mode: 'byte' }],
 *   { errorCorrectionLevel: 'M', version, maskPattern: mask })
 * const got = mine.encodeBytes(bytes, version, mask)
 * // then compare ref.modules.get(row, col) with got.modules[row][col]
 * ```
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_ARTIFACT = join(repoRoot, 'lib', 'client.js')

const qr = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'qr.ts')).href)
const pairState = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'pair-state.ts')).href)
const styles = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'styles.ts')).href)
const card = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'pair-card.ts')).href)
const clientHalf = await import(pathToFileURL(join(repoRoot, 'src', 'client', 'index.ts')).href)

/** The pairing URL shape the host mints: authority + `?token=<43-char base64url>`. */
const PAIRING_URL = 'https://demo.tailnet-example.ts.net/?token=Q7mZ1xVp3kLd9Rt2sWq8Yn6bC4fH0jK5gP1aX2vB3nM'

/** Total codewords per version, 1–10 (ISO/IEC 18004) — written out for the decoder. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]
/** EC codewords per block at level M. */
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
/** RS block count at level M. */
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]

/** Canonical text form of a matrix — what the pinned hashes are taken over. */
function canonical(matrix) {
  return matrix.modules.map((row) => row.map((value) => (value ? '1' : '0')).join('')).join('\n')
}

/** SHA-256 of the canonical form. */
function matrixHash(matrix) {
  return createHash('sha256').update(canonical(matrix), 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// 1. The encoder: pinned hashes, capacities, published constants, invariants
// ---------------------------------------------------------------------------

test('QR: the module matrix of a fixed input is pinned and reproducible', () => {
  const hello = qr.encodeQr('HELLO')
  assert.equal(hello.version, 1)
  assert.equal(hello.size, 21)
  assert.equal(hello.mask, 4)
  assert.equal(matrixHash(hello), 'c346c75add5698735afe3f7eb4f3e6c57ccefd9563f45f65c6d76aa518fb6f91')

  const url = qr.encodeQr(PAIRING_URL)
  assert.equal(qr.payloadBytes(PAIRING_URL).length, 86)
  assert.equal(url.version, 6)
  assert.equal(url.size, 41)
  assert.equal(url.mask, 2)
  assert.equal(matrixHash(url), 'cbfc34746e89f4be684a347dd1d785cee627644ec674012d263b59128084eaf1')

  // Reproducible: a second run over the same input hashes identically.
  assert.equal(matrixHash(qr.encodeQr(PAIRING_URL)), matrixHash(url))
  assert.equal(matrixHash(qr.encodeQr('HELLO')), matrixHash(hello))
})

test('QR: the matrix has the shape the PNG-free renderer needs', () => {
  const url = qr.encodeQr(PAIRING_URL)
  const path = card.qrModulesToPath(url)
  const dark = url.modules.flat().filter(Boolean).length
  assert.equal((path.match(/M/g) ?? []).length, dark, 'one path command per dark module')
  assert.match(path, /^M\d+ \d+h1v1h-1z/)
  assert.ok(!path.includes('NaN'))
})

test('QR: versions are chosen from the payload and match the published capacities', () => {
  // The byte-mode capacities of level M, versions 1–10 (ISO/IEC 18004 table 7).
  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => qr.byteCapacity(index + 1)),
    [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  )
  assert.equal(qr.PAYLOAD_LIMIT, 213)

  const versionFor = (bytes) => qr.encodeQr('a'.repeat(bytes)).version
  assert.equal(versionFor(14), 1)
  assert.equal(versionFor(15), 2)
  assert.equal(versionFor(84), 5)
  assert.equal(versionFor(85), 6)
  assert.equal(versionFor(213), 10)
  assert.throws(() => versionFor(214), (error) => error instanceof qr.QrCapacityError && error.bytes === 214)

  assert.equal(qr.encodeQr(PAIRING_URL).version, 6)
  // 86 + 3 + 91 = 180 bytes still fit version 9; one more byte pushes it to 10.
  assert.equal(qr.payloadBytes(`${PAIRING_URL}&e=${'z'.repeat(91)}`).length, 180)
  assert.equal(qr.encodeQr(`${PAIRING_URL}&e=${'z'.repeat(91)}`).version, 9)
  assert.equal(qr.encodeQr(`${PAIRING_URL}&e=${'z'.repeat(92)}`).version, 10)
})

test('QR: the format and version information reproduce the published BCH values', () => {
  // Level M, masks 0–7 — the standard 15-bit format strings.
  assert.deepEqual(
    Array.from({ length: 8 }, (_, mask) => qr.formatInfoBits(mask)),
    [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  )
  // Versions 7–10 carry their own 18-bit block.
  assert.equal(qr.versionInfoBits(7), 0x07c94)
  assert.equal(qr.versionInfoBits(8), 0x085bc)
  assert.equal(qr.versionInfoBits(9), 0x09a99)
  assert.equal(qr.versionInfoBits(10), 0x0a4d3)
})

test('QR: structural invariants hold for every version the encoder can emit', () => {
  const matrices = [1, 20, 60, 90, 140, 213].map((bytes) => qr.encodeQr('a'.repeat(bytes)))
  const versions = new Set()
  for (const matrix of matrices) {
    versions.add(matrix.version)
    const { size, modules } = matrix
    assert.equal(size, 17 + 4 * matrix.version)
    assert.equal(modules.length, size)
    for (const row of modules) assert.equal(row.length, size)
    const at = (row, col) => modules[row][col] === true

    // Finder patterns: a 7×7 box whose ring distance 2 is light and the rest dark.
    const finders = [[0, 0], [0, size - 7], [size - 7, 0]]
    for (const [top, left] of finders) {
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 7; col += 1) {
          const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3))
          assert.equal(at(top + row, left + col), ring !== 2, `finder ${top},${left} at ${row},${col}`)
        }
      }
    }
    // Separators: the column/row one step outside each finder is light.
    for (let step = 0; step < 8; step += 1) {
      assert.equal(at(7, step), false, 'top-left separator row')
      assert.equal(at(step, 7), false, 'top-left separator column')
      assert.equal(at(7, size - 8 + step), false, 'top-right separator row')
      assert.equal(at(step, size - 8), false, 'top-right separator column')
      assert.equal(at(size - 8, step), false, 'bottom-left separator row')
      assert.equal(at(size - 8 + step, 7), false, 'bottom-left separator column')
    }

    // Timing patterns alternate, dark at even indices.
    for (let i = 8; i < size - 8; i += 1) {
      assert.equal(at(6, i), i % 2 === 0, `horizontal timing at ${i}`)
      assert.equal(at(i, 6), i % 2 === 0, `vertical timing at ${i}`)
    }

    // The one always-dark module.
    assert.equal(at(size - 8, 8), true, 'dark module')

    // Alignment patterns: light centre, dark inner ring, light gap, dark outer ring.
    const centres = qr.alignmentPositions(matrix.version)
    for (const row of centres) {
      for (const col of centres) {
        const onFinder = (row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)
        if (onFinder) continue
        assert.equal(at(row, col), true, `alignment centre ${row},${col} is dark`)
        assert.equal(at(row - 1, col), false, `alignment inner ring ${row},${col} is light`)
        assert.equal(at(row - 2, col - 2), true, `alignment outer ring ${row},${col} is dark`)
        assert.equal(at(row - 1, col - 1), false, `alignment gap ${row},${col} is light`)
      }
    }
  }
  assert.deepEqual([...versions].sort((a, b) => a - b), [1, 2, 4, 6, 8, 10])
})

// ---------------------------------------------------------------------------
// 2. An independent decode of what the encoder produced
// ---------------------------------------------------------------------------

/** GF(256) arithmetic for the syndrome check (written for the decoder only). */
const GF = (() => {
  const exp = new Uint8Array(512)
  const log = new Uint8Array(256)
  for (let i = 0, x = 1; i < 255; i += 1) {
    exp[i] = x
    log[x] = i
    x <<= 1
    if ((x & 0x100) !== 0) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255]
  return { exp, mul: (a, b) => (a === 0 || b === 0 ? 0 : exp[log[a] + log[b]]) }
})()

/** Evaluate one codeword block at α^power; a valid block is zero at α^0…α^(ec-1). */
function blockSyndrome(block, power) {
  let sum = 0
  for (const byte of block) sum = GF.mul(sum, GF.exp[power]) ^ byte
  return sum
}

/** The function-pattern map, rebuilt from the version alone. */
function functionMap(version) {
  const size = 17 + 4 * version
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false))
  const mark = (row, col) => {
    if (row >= 0 && col >= 0 && row < size && col < size) fixed[row][col] = true
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i)
    mark(i, 6)
  }
  for (const [row, col] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(row + dy, col + dx)
  }
  const centres = qr.alignmentPositions(version)
  for (const row of centres) {
    for (const col of centres) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(row + dy, col + dx)
    }
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(b, a)
      mark(a, b)
    }
  }
  mark(size - 8, 8)
  // Format areas, excluding the two timing modules that cross them.
  for (let i = 0; i <= 5; i += 1) mark(i, 8)
  mark(7, 8)
  mark(8, 8)
  mark(8, 7)
  for (let i = 9; i < 15; i += 1) mark(8, 14 - i)
  for (let i = 0; i < 8; i += 1) mark(8, size - 1 - i)
  for (let i = 8; i < 15; i += 1) mark(size - 15 + i, 8)
  return { fixed, size }
}

/** Read the 15 format bits back out of copy A and validate them with BCH(15,5). */
function decodeFormat(matrix) {
  const { modules } = matrix
  const at = (row, col) => (modules[row][col] ? 1 : 0)
  // Bit i of the format word is the module the encoder wrote for bit i (bit 0 is
  // the least significant), so the read assembles little-endian by bit index.
  const read = []
  for (let i = 0; i <= 5; i += 1) read.push(at(i, 8))
  read.push(at(7, 8))
  read.push(at(8, 8))
  read.push(at(8, 7))
  for (let i = 9; i < 15; i += 1) read.push(at(8, 14 - i))
  let bits = 0
  for (const [index, value] of read.entries()) bits |= value << index
  assert.equal(read.length, 15)
  const unmasked = bits ^ 0x5412
  const data = unmasked >>> 10
  let remainder = data
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  assert.equal((data << 10) | (remainder & 0x3ff), unmasked & 0x7fff, 'format BCH must validate')
  return { ecBits: (data >>> 3) & 3, mask: data & 7 }
}

/** The mask predicate, written independently of the encoder's switch. */
function maskAt(mask, row, col) {
  const patterns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ]
  return patterns[mask](row, col)
}

/**
 * Fully decode one matrix: format info, unmask, codewords, de-interleave, RS
 * check, payload.
 *
 * @param matrix - what the encoder produced.
 * @returns the decoded payload and the intermediate values worth asserting on.
 */
function decodeMatrix(matrix) {
  const { size, version } = matrix
  const { fixed } = functionMap(version)
  const format = decodeFormat(matrix)
  assert.equal(format.ecBits, 0, 'level M must be encoded')

  const bits = []
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing column is skipped by moving the pair, not by copying
    // the loop variable: (… 8,7), (5,4), (3,2), (1,0) covers every data column
    // exactly once. Copying instead would visit column 4 twice and never visit
    // column 0 — the mistake this decoder was written around.
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let step = 0; step < 2; step += 1) {
        const col = right - step
        const row = upward ? size - 1 - vertical : vertical
        if (fixed[row][col]) continue
        let value = matrix.modules[row][col] ? 1 : 0
        if (maskAt(format.mask, row, col)) value ^= 1
        bits.push(value)
      }
    }
  }

  // The data-module count fixes the codeword count with no table at all.
  let dataModules = 0
  for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) if (!fixed[row][col]) dataModules += 1
  const totalCodewords = Math.floor(dataModules / 8)
  const ecPerBlock = EC_PER_BLOCK[version - 1]
  const blockCount = BLOCKS[version - 1]
  const shortBlockCount = blockCount - (totalCodewords % blockCount)
  const shortBlockLength = Math.floor(totalCodewords / blockCount)
  const shortDataLength = shortBlockLength - ecPerBlock
  const longDataLength = shortDataLength + 1

  const codewords = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let value = 0
    for (let k = 0; k < 8; k += 1) value = (value << 1) | bits[i + k]
    codewords.push(value)
  }
  assert.equal(codewords.length, totalCodewords)

  // De-interleave: data codewords column by column, then EC codewords column by column.
  let cursor = 0
  const dataBlocks = Array.from({ length: blockCount }, () => [])
  for (let i = 0; i < longDataLength; i += 1) {
    for (let b = 0; b < blockCount; b += 1) {
      if (i < (b < shortBlockCount ? shortDataLength : longDataLength)) {
        dataBlocks[b].push(codewords[cursor])
        cursor += 1
      }
    }
  }
  const ecBlocks = Array.from({ length: blockCount }, () => [])
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (let b = 0; b < blockCount; b += 1) {
      ecBlocks[b].push(codewords[cursor])
      cursor += 1
    }
  }
  assert.equal(cursor, totalCodewords)

  for (let b = 0; b < blockCount; b += 1) {
    const block = [...dataBlocks[b], ...ecBlocks[b]]
    assert.equal(block.length, b < shortBlockCount ? shortBlockLength : shortBlockLength + 1)
    for (let power = 0; power < ecPerBlock; power += 1) {
      assert.equal(blockSyndrome(block, power), 0, `block ${b} syndrome α^${power}`)
    }
  }

  // Payload: mode, character count, bytes; then the terminator and the pads.
  const dataBits = []
  for (const byte of dataBlocks.flat()) for (let bit = 7; bit >= 0; bit -= 1) dataBits.push((byte >>> bit) & 1)
  let position = 0
  const take = (count) => {
    let value = 0
    for (let i = 0; i < count; i += 1) value = (value << 1) | (dataBits[position + i] ?? 0)
    position += count
    return value
  }
  assert.equal(take(4), 0b0100, 'byte mode indicator')
  const length = take(version < 10 ? 8 : 16)
  const bytes = []
  for (let i = 0; i < length; i += 1) bytes.push(take(8))
  // Whatever follows the payload is zeros up to the next byte, then 0xEC/0x11 pads.
  while (position % 8 !== 0) {
    assert.equal(dataBits[position], 0, 'terminator bit must be zero')
    position += 1
  }
  const pads = []
  for (let at = position; at + 8 <= dataBits.length; at += 8) {
    let value = 0
    for (let i = 0; i < 8; i += 1) value = (value << 1) | dataBits[at + i]
    pads.push(value)
  }
  for (const [index, pad] of pads.entries()) assert.equal(pad, index % 2 === 0 ? 0xec : 0x11, `pad byte ${index}`)

  return { mask: format.mask, bytes, text: Buffer.from(bytes).toString('utf8'), totalCodewords, dataModules }
}

test('QR decode: the encoder output round-trips through an independent decoder', () => {
  for (const text of ['HELLO', PAIRING_URL, 'a'.repeat(213), '配对 手机 https://example.com/?token=测试']) {
    const matrix = qr.encodeQr(text)
    const decoded = decodeMatrix(matrix)
    assert.equal(decoded.mask, matrix.mask, 'decoded mask matches the reported one')
    assert.deepEqual(decoded.bytes, qr.payloadBytes(text), `payload round-trip for ${text.slice(0, 24)}`)
    assert.equal(decoded.text, text)
    // The module count derived from the matrix backs the version table.
    assert.equal(decoded.totalCodewords, TOTAL_CODEWORDS[matrix.version - 1])
    assert.ok(decoded.dataModules - decoded.totalCodewords * 8 <= 7, 'remainder bits stay under a codeword')
  }
})

// ---------------------------------------------------------------------------
// 3. The card state machine
// ---------------------------------------------------------------------------

test('card state: a 200 turns into a ready state with an absolute URL', () => {
  const state = pairState.interpretPairResponse({
    status: 200,
    body: JSON.stringify({ url: PAIRING_URL, authority: 'demo.tailnet-example.ts.net', expiresAt: null }),
  })
  assert.equal(state.kind, 'ready')
  assert.equal(state.url, PAIRING_URL)
  assert.equal(state.authority, 'demo.tailnet-example.ts.net')
  assert.equal(state.expiresAt, null)
  assert.match(state.url, /^https:\/\//)
})

test('card state: every failure reason is distinct and readable', () => {
  const unauthorized = pairState.interpretPairResponse({ status: 401, body: 'unauthorized' })
  const forbidden = pairState.interpretPairResponse({ status: 403, body: 'forbidden' })
  const unconfigured = pairState.interpretPairResponse({ status: 503, body: 'pairing not configured' })
  const network = pairState.interpretPairResponse({ status: 0, body: '', networkError: 'Failed to fetch' })
  const unexpected = pairState.interpretPairResponse({ status: 500, body: 'boom' })

  assert.equal(unauthorized.kind, 'failed')
  assert.equal(unauthorized.failure, 'unauthorized')
  assert.match(unauthorized.hint, /认证/)
  assert.equal(forbidden.failure, 'forbidden')
  assert.match(forbidden.hint, /围栏|trustedHosts/)
  assert.equal(unconfigured.failure, 'unconfigured')
  assert.match(unconfigured.hint, /pairingAuthority/)
  assert.equal(network.failure, 'network')
  assert.match(network.hint, /没有到达/)
  assert.equal(unexpected.failure, 'unexpected')

  // Four different reasons must produce four different sentences.
  const hints = new Set([unauthorized.hint, forbidden.hint, unconfigured.hint, network.hint])
  assert.equal(hints.size, 4)
  for (const state of [unauthorized, forbidden, unconfigured, network, unexpected]) {
    assert.equal(typeof state.detail, 'string')
    assert.ok(state.detail.length > 0)
  }
})

test('card state: malformed 200 bodies degrade instead of throwing', () => {
  assert.equal(pairState.interpretPairResponse({ status: 200, body: 'not json' }).failure, 'unexpected')
  assert.equal(pairState.interpretPairResponse({ status: 200, body: '[]' }).failure, 'unexpected')
  assert.equal(
    pairState.interpretPairResponse({ status: 200, body: JSON.stringify({ url: '/relative', authority: 'x' }) }).failure,
    'unexpected',
  )
  assert.equal(pairState.interpretPairResponse({ status: 204, body: '' }).failure, 'unexpected')
  // An absolute URL without an explicit authority still yields one, derived from the URL.
  const derived = pairState.interpretPairResponse({ status: 200, body: JSON.stringify({ url: PAIRING_URL }) })
  assert.equal(derived.kind, 'ready')
  assert.equal(derived.authority, 'demo.tailnet-example.ts.net')
})

test('card state: loadPairState is same-origin, never rejects and never persists', async () => {
  const calls = []
  const ok = await pairState.loadPairState(async (input, init) => {
    calls.push({ input, init })
    return { status: 200, text: async () => JSON.stringify({ url: PAIRING_URL, authority: 'a', expiresAt: null }) }
  })
  assert.equal(ok.kind, 'ready')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/mobile-remote/pair', 'the endpoint must be the relative frozen path')
  assert.equal(calls[0].init.credentials, 'same-origin')

  const boom = await pairState.loadPairState(async () => {
    throw new Error('offline')
  })
  assert.equal(boom.failure, 'network')

  const badBody = await pairState.loadPairState(async () => ({
    status: 200,
    text: async () => {
      throw new Error('stream closed')
    },
  }))
  assert.equal(badBody.failure, 'unexpected')

  // The page's storage APIs are booby-trapped: touching one fails the test.
  const globalKeys = ['localStorage', 'sessionStorage', 'indexedDB']
  const saved = new Map(globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get() {
        throw new Error(`the card must not touch ${key}`)
      },
    })
  }
  try {
    const state = await pairState.loadPairState(async () => ({
      status: 200,
      text: async () => JSON.stringify({ url: PAIRING_URL, authority: 'a', expiresAt: null }),
    }))
    assert.equal(state.kind, 'ready')
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
  }
})

// ---------------------------------------------------------------------------
// 3b. Robustness closure for t12 finding F1: the card can never sit in loading
// ---------------------------------------------------------------------------

/**
 * Run `body` and fail the test when it leaves an unhandled rejection behind.
 *
 * The finding this section closes was precisely "the card stops on a loading
 * sentence forever"; an unhandled rejection is the fingerprint of that class, so
 * every case below runs inside this guard.
 */
async function withoutUnhandledRejection(body) {
  const seen = []
  const listener = (reason) => seen.push(reason)
  process.on('unhandledRejection', listener)
  try {
    await body()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', listener)
  }
  assert.deepEqual(seen, [], 'the card left an unhandled rejection behind')
}

/** Drive the card's async path and collect every state it applied. */
async function cardStatesFrom(load) {
  const seen = []
  card.loadCardState((state) => seen.push(state), load)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return seen
}

test('card state (F1): a regex-passing but unparseable url lands in a terminal branch', async () => {
  // `isAbsoluteHttpUrl` is lexical; the URL parser refuses all four of these.
  const hostile = ['https://[::1', 'https://a:b', 'https://%zz', 'https://x%2']
  for (const url of hostile) {
    const body = JSON.stringify({ url })

    // The pure state machine must classify, not throw…
    const state = pairState.interpretPairResponse({ status: 200, body })
    assert.equal(state.kind, 'failed', `${url} must not become ready`)
    assert.equal(state.failure, 'unexpected')
    assert.match(state.hint, /预期之外/)
    assert.ok(state.detail.includes('url 不是可解析的绝对 URL'), state.detail)

    // …and this exact input is the one that used to reject rather than resolve.
    await withoutUnhandledRejection(async () => {
      const loaded = await pairState.loadPairState(async () => ({ status: 200, text: async () => body }))
      assert.equal(loaded.kind, 'failed')
      assert.equal(loaded.failure, 'unexpected')

      const applied = await cardStatesFrom(async () => ({ status: 200, text: async () => body }))
      assert.equal(applied.length, 1, 'the card must be told exactly one terminal state')
      assert.equal(applied[0].kind, 'failed')
      assert.equal(applied.some((entry) => entry.kind === 'loading'), false)
    })
  }

  // A hostile response object (a throwing `status` getter) is absorbed too: the
  // read happens after the body was consumed, so it needs its own guard.
  await withoutUnhandledRejection(async () => {
    const loaded = await pairState.loadPairState(async () => ({
      get status() {
        throw new Error('status getter exploded')
      },
      text: async () => JSON.stringify({ url: PAIRING_URL, authority: 'a', expiresAt: null }),
    }))
    assert.equal(loaded.kind, 'failed')
    assert.match(loaded.detail, /status getter exploded/)
  })
})

test('card (F1): the load chain always ends in a terminal state (three paths)', async () => {
  const states = []
  await withoutUnhandledRejection(async () => {
    // Path 1 — the loader itself rejects.
    card.loadCardState((state) => states.push(state), async () => {
      throw new Error('loader exploded')
    })
    // Path 2 — the state machine returns a branch this build does not know.
    card.loadCardState((state) => states.push(state), async () => ({ kind: 'unknown-branch' }))
    // Path 3 — the consumer of the state throws, so the chain's terminal
    // `.catch()` has to deliver a readable failure instead of a bare rejection.
    let alreadyThrew = false
    card.loadCardState(
      (state) => {
        if (!alreadyThrew) {
          alreadyThrew = true
          throw new Error('apply exploded')
        }
        states.push(state)
      },
      async () => ({ kind: 'ready', url: PAIRING_URL, authority: 'a', expiresAt: null }),
    )
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  })

  assert.equal(states.length, 3, 'each path must apply exactly one terminal state')
  const detailMatching = (fragment) => {
    const found = states.find((state) => state.detail.includes(fragment))
    assert.ok(found, `no terminal state mentions ${fragment}: ${JSON.stringify(states)}`)
    return found
  }
  assert.match(detailMatching('loader exploded').detail, /加载配对状态失败/)
  assert.match(detailMatching('未知状态').detail, /未知状态/)
  assert.match(detailMatching('apply exploded').detail, /apply exploded/)
  for (const state of states) {
    assert.equal(state.kind, 'failed')
    assert.equal(state.failure, 'unexpected')
    assert.ok(state.hint.length > 0, 'every terminal state carries readable copy')
    assert.ok(state.detail.length > 0)
  }
})

test('card (F1): a throwing state projection renders a failure card instead of escaping', () => {
  const retry = () => {}
  // A "ready" state whose `url` getter throws: the projection must not escape
  // into React's render.
  const hostile = {
    kind: 'ready',
    get url() {
      throw new Error('url getter exploded')
    },
    authority: 'a',
    expiresAt: null,
  }
  const view = card.safeCardBody(hostile, retry)
  assert.equal(view.state.kind, 'failed')
  assert.match(view.state.detail, /卡片渲染失败/)
  assert.match(view.state.detail, /url getter exploded/)
  assert.equal(view.children[0].props.className, 'dmr-card-title')
  const status = view.children.find((child) => child.props !== undefined && child.props['data-dmr-tone'] === 'error')
  assert.ok(status, 'the fallback must render an error-toned status line')
  assert.match(String(status.props.children), /预期之外|渲染失败/)

  // The healthy path is unchanged: the very same state object flows through.
  const ready = { kind: 'ready', url: PAIRING_URL, authority: 'a', expiresAt: null }
  const normal = card.safeCardBody(ready, retry)
  assert.equal(normal.state, ready)
  assert.deepEqual(normal.children, card.cardBody(ready, retry))
})

test('card state (F1): the shipped response shapes are byte-for-byte unchanged', () => {
  // Proof that this task is a robustness closure, not a behaviour change: the
  // four documented refusals, the generic non-200, and both 200 shapes are
  // pinned here to the exact objects the pre-closure build produced.
  assert.deepEqual(pairState.interpretPairResponse({ status: 401, body: 'unauthorized' }), {
    kind: 'failed',
    failure: 'unauthorized',
    detail: 'HTTP 401',
    hint: pairState.pairHint('unauthorized', 'HTTP 401'),
  })
  assert.deepEqual(pairState.interpretPairResponse({ status: 403, body: 'forbidden' }), {
    kind: 'failed',
    failure: 'forbidden',
    detail: 'HTTP 403',
    hint: pairState.pairHint('forbidden', 'HTTP 403'),
  })
  assert.deepEqual(pairState.interpretPairResponse({ status: 503, body: 'pairing not configured' }), {
    kind: 'failed',
    failure: 'unconfigured',
    detail: 'HTTP 503',
    hint: pairState.pairHint('unconfigured', 'HTTP 503'),
  })
  assert.deepEqual(pairState.interpretPairResponse({ status: 0, body: '', networkError: 'Failed to fetch' }), {
    kind: 'failed',
    failure: 'network',
    detail: 'Failed to fetch',
    hint: pairState.pairHint('network', 'Failed to fetch'),
  })
  assert.deepEqual(pairState.interpretPairResponse({ status: 500, body: 'boom' }), {
    kind: 'failed',
    failure: 'unexpected',
    detail: 'HTTP 500 · boom',
    hint: pairState.pairHint('unexpected', 'HTTP 500 · boom'),
  })
  assert.deepEqual(
    pairState.interpretPairResponse({
      status: 200,
      body: JSON.stringify({ url: PAIRING_URL, authority: 'demo.tailnet-example.ts.net', expiresAt: null }),
    }),
    { kind: 'ready', url: PAIRING_URL, authority: 'demo.tailnet-example.ts.net', expiresAt: null },
  )
  // The derived-authority branch (no explicit authority) still derives it.
  assert.deepEqual(pairState.interpretPairResponse({ status: 200, body: JSON.stringify({ url: PAIRING_URL }) }), {
    kind: 'ready',
    url: PAIRING_URL,
    authority: 'demo.tailnet-example.ts.net',
    expiresAt: null,
  })
  // And the same through the loader, which is what the card actually calls.
  return withoutUnhandledRejection(async () => {
    const loaded = await pairState.loadPairState(async () => ({
      status: 200,
      text: async () => JSON.stringify({ url: PAIRING_URL, authority: 'demo.tailnet-example.ts.net', expiresAt: null }),
    }))
    assert.deepEqual(loaded, {
      kind: 'ready',
      url: PAIRING_URL,
      authority: 'demo.tailnet-example.ts.net',
      expiresAt: null,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Mounting: stylesheet, frozen slots, cleanup, silent degradation
// ---------------------------------------------------------------------------

/** A minimal `document` good enough for the stylesheet injection. */
function createDocumentStub() {
  const tags = []
  const doc = {
    querySelector(selector) {
      return tags.find((tag) => selector.includes(tag.dataset.pluginCss)) ?? null
    },
    createElement() {
      const tag = {
        dataset: {},
        textContent: '',
        remove() {
          const at = tags.indexOf(tag)
          if (at !== -1) tags.splice(at, 1)
        },
      }
      return tag
    },
    head: {
      appendChild(tag) {
        tags.push(tag)
      },
    },
  }
  return { doc, tags }
}

/** A cordis-shaped context stub that records slot registrations and warnings. */
function createContextStub(options = {}) {
  const registrations = []
  const effects = []
  const ctx = {
    effect(execute, label = 'anonymous') {
      const entry = { label, disposer: execute() }
      effects.push(entry)
      return () => {
        const at = effects.indexOf(entry)
        if (at !== -1) effects.splice(at, 1)
        return typeof entry.disposer === 'function' ? entry.disposer() : undefined
      }
    },
  }
  if (options.slots !== 'missing') {
    ctx.slots = {
      inject(name, register) {
        if (options.injectThrows === true) throw new Error('inject exploded')
        return register()
      },
      register(slotOptions, component) {
        if (options.registerThrows === true) throw new Error('keyed slot already has an entry for this key')
        registrations.push({ slotOptions, component })
        return () => {}
      },
    }
  }
  return {
    ctx,
    registrations,
    effects,
    disposeAll() {
      const pending = [...effects].reverse()
      effects.length = 0
      for (const entry of pending) if (typeof entry.disposer === 'function') entry.disposer()
      return pending.length
    },
  }
}

/** Run a body with `console.warn` captured (the degradation paths log once). */
function captureWarnings(body) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    body(warnings)
  } finally {
    console.warn = original
  }
  return warnings
}

test('mount: the frozen manifest shape is what the contract freezes', () => {
  assert.deepEqual(clientHalf.inject, ['slots'])
  assert.equal(typeof clientHalf.apply, 'function')
  assert.equal(typeof card.safeRegister, 'function')
  assert.equal(typeof card.registerPairSurfaces, 'function')
  assert.equal(card.PANEL_KEY, 'mobile-remote')
  assert.equal(card.PANEL_LABEL, '手机远控')
})

test('mount: apply injects the stylesheet and registers the frozen slots', () => {
  const { doc, tags } = createDocumentStub()
  const stub = createContextStub()
  const savedDocument = globalThis.document
  globalThis.document = doc
  try {
    clientHalf.apply(stub.ctx)

    assert.equal(stub.effects.length, 1, 'one effect owns the mount')
    // Two sheets by design: the card's (this file) and the narrow-screen layer's
    // (mobile-css.ts, id `dsh-mobile-remote-style`; contract §6.1/§11.4 keep the
    // two ids apart on purpose). The count assertion below is therefore scoped to
    // the card sheet — its strength is unchanged.
    const cards = tags.filter((tag) => tag.dataset.pluginCss === 'dsh-mobile-remote/pair-card')
    assert.equal(cards.length, 1, 'exactly one card stylesheet tag')
    assert.equal(cards[0].dataset.plugin, 'dsh-mobile-remote')
    assert.equal(cards[0].dataset.pluginCss, 'dsh-mobile-remote/pair-card')
    assert.match(cards[0].textContent, /\.dmr-card/)
    assert.match(cards[0].textContent, /\[data-dsh-mobile-remote='pair-card'\]/)
    assert.ok(
      !cards[0].textContent.includes('dsh-mobile-remote-style'),
      'the card sheet must not claim the narrow-screen sheet id (that one belongs to mobile-css.ts)',
    )

    assert.equal(stub.registrations.length, 2)
    const panel = stub.registrations.find((entry) => entry.slotOptions.name === 'main')
    const row = stub.registrations.find((entry) => entry.slotOptions.name === 'sidebar.panellist')
    assert.ok(panel, 'the panel registers into the keyed main slot')
    assert.equal(panel.slotOptions.key, 'mobile-remote')
    assert.equal(panel.slotOptions.locale, 'dsh-mobile-remote')
    assert.equal(typeof panel.component, 'function')
    assert.ok(row, 'the sidebar row registers')
    assert.equal(row.slotOptions.id, 'mobile-remote')
    assert.equal(row.slotOptions.order, 20)
    assert.equal(row.slotOptions.label, '手机远控')
    assert.equal(typeof row.component, 'function')

    // Mounting twice must not duplicate the stylesheet (scoped to the card sheet
    // for the same reason as above; the pair of sheets coexists exactly once).
    clientHalf.apply(stub.ctx)
    const cardsAfterRemount = tags.filter((tag) => tag.dataset.pluginCss === 'dsh-mobile-remote/pair-card')
    assert.equal(cardsAfterRemount.length, 1, 'the card stylesheet injection is idempotent')
    assert.equal(tags.length, 2, 'the card and narrow-screen sheets coexist once each')

    // Disposing the effect removes the tag again.
    assert.equal(stub.disposeAll(), 2)
    assert.equal(tags.length, 0, 'dispose un-injects the stylesheet')
  } finally {
    globalThis.document = savedDocument
  }
})

test('mount: a missing or hostile slot service degrades silently', () => {
  const { doc, tags } = createDocumentStub()
  const savedDocument = globalThis.document
  globalThis.document = doc
  try {
    const warnings = captureWarnings(() => {
      for (const options of [{ slots: 'missing' }, { injectThrows: true }, { registerThrows: true }]) {
        const stub = createContextStub(options)
        assert.doesNotThrow(() => clientHalf.apply(stub.ctx), `apply must not throw for ${JSON.stringify(options)}`)
        assert.equal(stub.registrations.length, 0, 'nothing may be registered when the service misbehaves')
        assert.equal(stub.disposeAll(), 1)
      }
    })
    assert.ok(warnings.length >= 3, 'each degraded registration logs exactly one warning')
    assert.equal(tags.length, 0, 'every dispose took its stylesheet tag with it')

    // safeRegister reports the degradation instead of throwing, on every path.
    assert.equal(card.safeRegister(undefined, 'main', { name: 'main' }, () => null), false)
    assert.equal(card.safeRegister({}, 'main', { name: 'main' }, () => null), false)
    assert.equal(
      card.safeRegister(
        { slots: { inject: () => { throw new Error('nope') } } },
        'main',
        { name: 'main' },
        () => null,
      ),
      false,
    )
    captureWarnings(() => {
      const hostile = createContextStub({ registerThrows: true })
      assert.doesNotThrow(() => card.registerPairSurfaces(hostile.ctx))
      assert.deepEqual(card.registerPairSurfaces(hostile.ctx), [true, true], 'the surface is "handed over" but hidden')

      // The inject callback can run inside another plugin's register(); a throw
      // there must not escape into that caller (the slot framework would blow up).
      const deferred = []
      const ctx = {
        slots: {
          inject: (name, register) => deferred.push({ name, register }),
          register: () => { throw new Error('collision') },
        },
      }
      assert.equal(card.safeRegister(ctx, 'main', { name: 'main', key: 'mobile-remote' }, () => null), true)
      assert.doesNotThrow(() => deferred[0].register())
    })
  } finally {
    globalThis.document = savedDocument
  }
})

test('mount: without a document the card still mounts (injection degrades to a no-op)', () => {
  const savedDocument = globalThis.document
  delete globalThis.document
  try {
    const stub = createContextStub()
    assert.doesNotThrow(() => clientHalf.apply(stub.ctx))
    assert.equal(stub.registrations.length, 2)
    assert.equal(stub.disposeAll(), 1)
  } finally {
    globalThis.document = savedDocument
  }
})

test('mount: the card stylesheet carries the hooks and the theme tokens', () => {
  assert.match(styles.CARD_STYLESHEET, /\.dmr-card\s*\{/)
  assert.match(styles.CARD_STYLESHEET, /overflow-wrap:\s*anywhere/)
  assert.match(styles.CARD_STYLESHEET, /@media \(max-width: 520px\)/)
  assert.match(styles.CARD_STYLESHEET, /\[data-dsh-mobile-remote='panel'\]/)
  assert.ok(styles.CARD_STYLESHEET.includes('--dsw-alias-'), 'colours come from theme tokens')
  assert.equal(styles.CARD_STYLE_ID, 'dsh-mobile-remote-card-style')
  assert.equal(styles.CARD_STYLE_KEY, 'dsh-mobile-remote/pair-card')
})

// ---------------------------------------------------------------------------
// 5. The built browser artifact
// ---------------------------------------------------------------------------

/** Read the built client bundle, failing with an actionable message. */
function readClientArtifact() {
  try {
    return readFileSync(CLIENT_ARTIFACT, 'utf8')
  } catch (error) {
    assert.fail(`cannot read ${CLIENT_ARTIFACT} — run \`pnpm build\` first (${error.message})`)
  }
}

test('artifact: the pair card is in the bundle and reaches nothing but react', () => {
  const source = readClientArtifact()

  for (const marker of ['__ModuleLoader__', '/mobile-remote/pair', 'dmr-card', 'data-dsh-mobile-remote', 'sidebar.panellist']) {
    assert.ok(source.includes(marker), `client artifact must contain ${marker}`)
  }

  const requested = new Set()
  for (const match of source.matchAll(/require\(\s*"([^"]+)"\s*\)/g)) requested.add(match[1])
  for (const specifier of requested) {
    assert.equal(specifier, 'react', `unexpected external module in the client bundle: ${specifier}`)
  }
})

test('artifact: no browser storage API appears anywhere in the bundle', () => {
  const source = readClientArtifact()
  for (const api of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', 'IndexedDB', 'openDatabase']) {
    assert.ok(!source.includes(api), `the client bundle must not mention ${api}`)
  }
  assert.ok(source.includes('navigator'), 'the copy button still reaches the clipboard')
})
