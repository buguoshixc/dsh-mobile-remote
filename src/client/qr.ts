/**
 * A self-contained QR Code encoder — no third-party package.
 *
 * Scope, deliberately narrow and frozen:
 *
 * - **model 2** (the only model in use), **byte mode** (UTF-8 payloads),
 *   **error-correction level M**;
 * - **the version is chosen from the payload length**, smallest first, over
 *   versions 1–10 — i.e. up to 213 bytes, far more than a pairing URL needs;
 * - the module matrix for one input is a pure function of that input, so the
 *   tests can pin its hash (`test/client-pair.test.mjs`).
 *
 * The tables below carry only the numbers that are genuinely tabulated by
 * ISO/IEC 18004 (total codewords, EC codewords per block, block count). Every
 * other quantity — data codewords per block, short/long block split, alignment
 * pattern positions, format/version bits — is *derived*, so the encoder and the
 * test share no hand-copied constant.
 *
 * @module dsh-mobile-remote/client/qr
 */

/** Total codewords (data + EC) for versions 1–10 — index 0 is version 1. */
const TOTAL_CODEWORDS: readonly number[] = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]

/** EC codewords per block at level M, versions 1–10. */
const EC_PER_BLOCK_M: readonly number[] = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]

/** RS block count at level M, versions 1–10. */
const BLOCKS_M: readonly number[] = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]

/** Highest version this encoder emits (213 bytes at level M). */
export const MAX_VERSION = TOTAL_CODEWORDS.length

/** Byte-mode character-count field width, in bits, for one version. */
function countBits(version: number): number {
  return version < 10 ? 8 : 16
}

/** Data codewords available in one version at level M. */
export function dataCodewords(version: number): number {
  const total = TOTAL_CODEWORDS[version - 1]
  const blocks = BLOCKS_M[version - 1]
  const ec = EC_PER_BLOCK_M[version - 1]
  if (total === undefined || blocks === undefined || ec === undefined) {
    throw new QrCapacityError(`unsupported QR version ${version}`)
  }
  return total - ec * blocks
}

/** How many payload bytes one version at level M can carry in byte mode. */
export function byteCapacity(version: number): number {
  return dataCodewords(version) - 1 - countBits(version) / 8
}

/**
 * The largest payload this encoder accepts, in bytes (level M, version 10).
 *
 * This is the published byte-mode capacity of version 10-M (213); the tests pin
 * the whole capacity series against the same table.
 */
export const PAYLOAD_LIMIT = byteCapacity(MAX_VERSION)

/**
 * Thrown when the payload does not fit the highest supported version.
 *
 * The card catches this and falls back to "show the URL, no code" — a QR
 * failure must never break the pairing surface.
 */
export class QrCapacityError extends Error {
  /** Payload length that did not fit, in bytes. */
  readonly bytes: number

  /**
   * @param message - human-readable reason.
   * @param bytes - the rejected payload length.
   */
  constructor(message: string, bytes = 0) {
    super(message)
    this.name = 'QrCapacityError'
    this.bytes = bytes
  }
}

/** One encoded matrix: a square grid of dark/light modules. */
export interface QrMatrix {
  /** QR version (1–10). */
  readonly version: number
  /** Modules per side (= 17 + 4 · version). */
  readonly size: number
  /** The chosen data mask (0–7). */
  readonly mask: number
  /** `modules[row][column]`, `true` = dark. */
  readonly modules: readonly (readonly boolean[])[]
}

// ---------------------------------------------------------------------------
// GF(256) arithmetic and Reed–Solomon
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

for (let i = 0, x = 1; i < 255; i += 1) {
  GF_EXP[i] = x
  GF_LOG[x] = i
  x <<= 1
  if ((x & 0x100) !== 0) x ^= 0x11d
}
for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255] as number

/** Multiply two GF(256) elements. */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[(GF_LOG[a] as number) + (GF_LOG[b] as number)] as number
}

/**
 * The Reed–Solomon generator polynomial of the given degree, highest power
 * first, with a leading coefficient of 1.
 */
function rsGenerator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      const coefficient = poly[j] as number
      next[j] = (next[j] as number) ^ coefficient
      next[j + 1] = (next[j + 1] as number) ^ gfMul(coefficient, GF_EXP[i] as number)
    }
    poly = next
  }
  return poly
}

/** The `degree` EC codewords for one block of data codewords. */
function rsRemainder(data: readonly number[], degree: number): number[] {
  const generator = rsGenerator(degree)
  const remainder = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number)
    remainder.shift()
    remainder.push(0)
    for (let i = 0; i < degree; i += 1) {
      remainder[i] = (remainder[i] as number) ^ gfMul(generator[i + 1] as number, factor)
    }
  }
  return remainder
}

/**
 * Split data codewords into blocks, append each block's EC codewords and
 * interleave everything into the final codeword stream.
 */
function addEccAndInterleave(data: readonly number[], version: number): number[] {
  const total = TOTAL_CODEWORDS[version - 1] as number
  const blockCount = BLOCKS_M[version - 1] as number
  const ecLength = EC_PER_BLOCK_M[version - 1] as number
  const shortBlockCount = blockCount - (total % blockCount)
  const shortBlockLength = Math.floor(total / blockCount)
  const shortDataLength = shortBlockLength - ecLength

  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  for (let i = 0, offset = 0; i < blockCount; i += 1) {
    const dataLength = shortDataLength + (i < shortBlockCount ? 0 : 1)
    const blockData = data.slice(offset, offset + dataLength)
    offset += dataLength
    dataBlocks.push(blockData)
    ecBlocks.push(rsRemainder(blockData, ecLength))
  }

  // Interleave: first the data codewords column by column (long blocks have one
  // more), then every block's EC codewords the same way.
  const result: number[] = []
  const longestData = shortDataLength + (shortBlockCount === blockCount ? 0 : 1)
  for (let i = 0; i < longestData; i += 1) {
    for (let b = 0; b < blockCount; b += 1) {
      const value = (dataBlocks[b] as number[])[i]
      if (value !== undefined) result.push(value)
    }
  }
  for (let i = 0; i < ecLength; i += 1) {
    for (let b = 0; b < blockCount; b += 1) result.push((ecBlocks[b] as number[])[i] as number)
  }
  return result
}

// ---------------------------------------------------------------------------
// Bit-level helpers (BCH for the format and version information)
// ---------------------------------------------------------------------------

/** Remainder of `value` modulo the given BCH generator polynomial. */
function bchRemainder(value: number, generator: number, degree: number): number {
  let remainder = value
  for (let i = 0; i < degree; i += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> (degree - 1)) & 1) === 1 ? generator : 0)
  }
  return (remainder ^ (value << degree)) >>> 0
}

/**
 * The 15 format-information bits for level M and one mask.
 *
 * The 5 data bits are `(ecBits << 3) | mask` with `ecBits = 0` for level M, the
 * error-correcting code is BCH(15, 5) with generator `0x537`, and the spec
 * masks the result with `0x5412` — so level M with mask 0 is exactly `0x5412`.
 */
export function formatInfoBits(mask: number): number {
  const data = (0 << 3) | (mask & 7)
  const ecBits = bchRemainder(data, 0x537, 10)
  return (((data << 10) | (ecBits & 0x3ff)) ^ 0x5412) & 0x7fff
}

/**
 * The 18 version-information bits, BCH(18, 6) with generator `0x1F25`.
 *
 * Published spot values this must reproduce: v7 = `0x07C94`, v8 = `0x085BC`,
 * v9 = `0x09A99`, v10 = `0x0A4D3`.
 */
export function versionInfoBits(version: number): number {
  return (version << 12) | (bchRemainder(version, 0x1f25, 12) & 0xfff)
}

/** Alignment pattern centre coordinates for one version. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const size = 17 + 4 * version
  const count = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2
  const positions: number[] = new Array<number>(count).fill(0)
  positions[0] = 6
  for (let i = count - 1, pos = size - 7; i >= 1; i -= 1, pos -= step) positions[i] = pos
  return positions
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

/** Working state for one encoding pass. */
interface Canvas {
  /** Modules per side. */
  size: number
  /** Dark-module flags, row-major. */
  dark: Uint8Array
  /** 1 where the module belongs to a function pattern (never masked). */
  fixed: Uint8Array
}

/** Bit `index` of `bits`, counted from the least significant bit. */
function bitAt(bits: number, index: number): boolean {
  return ((bits >>> index) & 1) !== 0
}

/** Set one module and mark it as a function pattern. */
function setFixed(canvas: Canvas, row: number, col: number, dark: boolean): void {
  if (row < 0 || col < 0 || row >= canvas.size || col >= canvas.size) return
  const at = row * canvas.size + col
  canvas.dark[at] = dark ? 1 : 0
  canvas.fixed[at] = 1
}

/** The version-information block must be set even when the payload is smaller. */
function drawFunctionPatterns(canvas: Canvas, version: number): void {
  const { size } = canvas

  // Timing patterns.
  for (let i = 0; i < size; i += 1) {
    setFixed(canvas, 6, i, i % 2 === 0)
    setFixed(canvas, i, 6, i % 2 === 0)
  }

  // Finder patterns with their separators (a 9×9 neighbourhood clipped at the
  // edges): distance 2 and 4 from the centre are light, everything else dark.
  const finder = (centreRow: number, centreCol: number): void => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        setFixed(canvas, centreRow + dy, centreCol + dx, distance !== 2 && distance !== 4)
      }
    }
  }
  finder(3, 3)
  finder(3, size - 4)
  finder(size - 4, 3)

  // Alignment patterns, skipping the three that would sit on a finder.
  const positions = alignmentPositions(version)
  const last = positions.length - 1
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const skip = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)
      if (skip) continue
      const centreRow = positions[i] as number
      const centreCol = positions[j] as number
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFixed(canvas, centreRow + dy, centreCol + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // Reserve the format-information areas by drawing a dummy mask value; the
  // real bits are written after the data mask is chosen. Drawing (rather than
  // blanket-setting) matters: the reservation must not touch the timing modules
  // at (6, 8) and (8, 6), which live inside the format area's rows.
  drawFormatBits(canvas, 0)

  // Version information for versions 7 and up.
  if (version >= 7) {
    const bits = versionInfoBits(version)
    for (let i = 0; i < 18; i += 1) {
      const dark = bitAt(bits, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFixed(canvas, b, a, dark)
      setFixed(canvas, a, b, dark)
    }
  }

  // The one always-dark module.
  setFixed(canvas, size - 8, 8, true)
}

/** Draw both copies of the format information. */
function drawFormatBits(canvas: Canvas, mask: number): void {
  const { size } = canvas
  const bits = formatInfoBits(mask)
  for (let i = 0; i <= 5; i += 1) setFixed(canvas, i, 8, bitAt(bits, i))
  setFixed(canvas, 7, 8, bitAt(bits, 6))
  setFixed(canvas, 8, 8, bitAt(bits, 7))
  setFixed(canvas, 8, 7, bitAt(bits, 8))
  for (let i = 9; i < 15; i += 1) setFixed(canvas, 8, 14 - i, bitAt(bits, i))
  for (let i = 0; i < 8; i += 1) setFixed(canvas, 8, size - 1 - i, bitAt(bits, i))
  for (let i = 8; i < 15; i += 1) setFixed(canvas, size - 15 + i, 8, bitAt(bits, i))
  setFixed(canvas, size - 8, 8, true)
}

/** Place the codeword bits in the standard upward/downward zigzag. */
function drawCodewords(canvas: Canvas, codewords: readonly number[], mask: number): void {
  const { size } = canvas
  let bitIndex = 0
  const totalBits = codewords.length * 8

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const col = right - column
        const row = upward ? size - 1 - vertical : vertical
        const at = row * size + col
        if (canvas.fixed[at] === 1) continue
        let dark = false
        if (bitIndex < totalBits) {
          dark = bitAt(codewords[bitIndex >>> 3] as number, 7 - (bitIndex & 7))
        }
        bitIndex += 1
        if (maskApplies(mask, row, col)) dark = !dark
        canvas.dark[at] = dark ? 1 : 0
      }
    }
  }
}

/** Whether one mask pattern inverts the module at `(row, col)`. */
function maskApplies(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return false
  }
}

/**
 * Mask penalty score (ISO/IEC 18004 §8.8.2, all four rules).
 *
 * Lower is better; the encoder keeps the mask with the smallest score. Rules 1
 * and 3 share one run-length scan per line (the 1:1:3:1:1 finder pattern is a
 * property of the run-length history, not of raw module pairs), which is the
 * standard formulation of the two rules.
 *
 * @param canvas - the masked matrix: `dark[row * size + col] === 1` means dark.
 * @returns the total penalty.
 */
export function penaltyScore(canvas: { size: number; dark: Uint8Array }): number {
  const { size, dark } = canvas
  const at = (row: number, col: number): boolean => dark[row * size + col] === 1
  let score = 0

  /** Rule 1 + rule 3 for every row and every column. */
  const scanLine = (value: (step: number) => boolean): void => {
    let runDark = false
    let runLength = 0
    let history: number[] = []
    const pushHistory = (length: number): void => {
      // A run at the line's start is padded with the light border of the quiet
      // zone (size modules), and the history only ever needs seven entries.
      const padded = history[0] === undefined ? length + size : length
      history = [padded, ...history].slice(0, 7)
    }
    for (let step = 0; step < size; step += 1) {
      const current = value(step)
      if (current === runDark) {
        runLength += 1
        if (runLength === 5) score += 3
        else if (runLength > 5) score += 1
      } else {
        pushHistory(runLength)
        if (!runDark) score += finderPenaltyCount(history) * 40
        runDark = current
        runLength = 1
      }
    }
    if (runDark) {
      pushHistory(runLength)
      pushHistory(size) // the trailing light border
    } else {
      pushHistory(runLength + size) // the last light run merged with the border
    }
    score += finderPenaltyCount(history) * 40
  }

  for (let line = 0; line < size; line += 1) scanLine((step) => at(line, step))
  for (let line = 0; line < size; line += 1) scanLine((step) => at(step, line))

  // Rule 2: 2×2 blocks of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = at(row, col)
      if (value === at(row, col + 1) && value === at(row + 1, col) && value === at(row + 1, col + 1)) {
        score += 3
      }
    }
  }

  // Rule 4: deviation from an even dark/light balance.
  let darkCount = 0
  for (let i = 0; i < dark.length; i += 1) if (dark[i] === 1) darkCount += 1
  const total = size * size
  const steps = Math.floor((Math.abs(darkCount * 20 - total * 10) + total - 1) / total) - 1
  score += steps * 10

  return score
}

/**
 * Rule-3 helper: count 1:1:3:1:1 finder-like patterns in a run-length history.
 *
 * `history[1]` is the centre run: the pattern is dark:light:dark:light:dark with
 * the middle dark run three times as long, flanked by at least four light
 * modules (or the quiet zone) on the relevant side.
 */
function finderPenaltyCount(history: readonly number[]): number {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = history
  const n = b
  const core = n > 0 && c === n && d === n * 3 && e === n && f === n
  if (!core) return 0
  return (a >= n * 4 && (history[6] ?? 0) >= n ? 1 : 0) + ((history[6] ?? 0) >= n * 4 && a >= n ? 1 : 0)
}


/** Encode UTF-8 bytes into the smallest version that fits at level M. */
function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (byteLength <= byteCapacity(version)) return version
  }
  throw new QrCapacityError(
    `QR payload is ${byteLength} bytes; the highest supported version (${MAX_VERSION}, level M) carries ${byteCapacity(MAX_VERSION)}`,
    byteLength,
  )
}

/** Build the final codeword stream for one payload and version. */
function buildCodewords(bytes: readonly number[], version: number): number[] {
  const capacity = dataCodewords(version)
  const bits: number[] = []

  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1)
  }

  push(0b0100, 4) // byte mode
  push(bytes.length, countBits(version))
  for (const byte of bytes) push(byte, 8)

  const capacityBits = capacity * 8
  const terminator = Math.min(4, capacityBits - bits.length)
  push(0, terminator)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] ?? 0)
    codewords.push(value)
  }
  for (let pad = 0; codewords.length < capacity; pad += 1) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11)
  }
  return addEccAndInterleave(codewords, version)
}

/** UTF-8 encode without depending on `TextEncoder` being present. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = []
  for (const character of text) {
    const code = character.codePointAt(0) as number
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

/**
 * Encode one text payload into a QR module matrix.
 *
 * @param text - the payload; encoded as UTF-8 in byte mode.
 * @returns the smallest version that fits, masked with the lowest-penalty mask.
 * @throws QrCapacityError when the payload exceeds 213 bytes.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = utf8Bytes(text)
  const version = chooseVersion(bytes.length)
  return encodeBytes(bytes, version)
}

/**
 * Encode already-encoded payload bytes at a pinned version.
 *
 * Exported so the tests (and the one-off cross-check against a reference
 * encoder) can pin both the version and the mask instead of relying on the
 * penalty search.
 *
 * @param bytes - payload bytes (length must fit the version).
 * @param version - the QR version to use.
 * @param mask - pin this mask (0–7) instead of searching for the best one.
 * @returns the masked matrix.
 * @throws RangeError when `mask` is outside 0–7. The mask used to be folded with
 *   `mask & 7`, so an out-of-contract value was silently *reduced* to a different
 *   mask (9 became 1, 100 became 4) and the caller got a matrix it had not asked
 *   for; a pinned-mask API has to fail loudly instead (t34 finding C7). Nothing in
 *   the UI passes a mask, so this only ever fires for a caller.
 */
export function encodeBytes(bytes: readonly number[], version: number, mask?: number): QrMatrix {
  if (version < 1 || version > MAX_VERSION) {
    throw new QrCapacityError(`QR version ${version} is not supported (1–${MAX_VERSION})`, bytes.length)
  }
  if (bytes.length > byteCapacity(version)) {
    throw new QrCapacityError(`payload of ${bytes.length} bytes does not fit version ${version}`, bytes.length)
  }
  if (mask !== undefined && (!Number.isInteger(mask) || mask < 0 || mask > 7)) {
    throw new RangeError(`QR mask ${String(mask)} is not a mask (expected an integer 0–7)`)
  }

  const size = 17 + 4 * version
  const codewords = buildCodewords(bytes, version)

  let best: { mask: number; canvas: Canvas; score: number } | undefined
  for (let candidate = 0; candidate < 8; candidate += 1) {
    if (mask !== undefined && candidate !== mask) continue
    const canvas: Canvas = { size, dark: new Uint8Array(size * size), fixed: new Uint8Array(size * size) }
    drawFunctionPatterns(canvas, version)
    drawFormatBits(canvas, candidate)
    drawCodewords(canvas, codewords, candidate)
    const score = penaltyScore(canvas)
    if (best === undefined || score < best.score) best = { mask: candidate, canvas, score }
  }

  if (best === undefined) {
    // Unreachable while the range guard above holds (`mask` pins exactly one
    // candidate, and the search always runs eight). Kept total so the old
    // `best as …` cast — which threw a bare TypeError at the first read — has no
    // successor here.
    throw new RangeError(`QR mask ${String(mask)} produced no candidate`)
  }
  const chosen = best
  const modules: boolean[][] = []
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = []
    for (let col = 0; col < size; col += 1) line.push(chosen.canvas.dark[row * size + col] === 1)
    modules.push(line)
  }
  return { version, size, mask: chosen.mask, modules }
}

/**
 * The payload bytes an encoder run would use — exposed for the tests so the
 * "what was encoded" half can be checked without duplicating the UTF-8 logic.
 *
 * @param text - the payload.
 * @returns the UTF-8 bytes.
 */
export function payloadBytes(text: string): number[] {
  return utf8Bytes(text)
}
