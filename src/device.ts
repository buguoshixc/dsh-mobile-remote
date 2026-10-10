/**
 * Device-level grants (P4): per-device credentials, single-device revocation, and
 * all-device rotation.
 *
 * Token shape is the shipped credential idiom (`v1.<body>.<signature>`, exactly
 * what `client-connection` uses for its browser cookie —
 * docs/evidence/dsh-client-connection__lib__index.js:302-304), and the key is
 * HKDF-derived from the caller's secret (the same 32-byte
 * `client-connection/browser-session` secret, evidence :223), domain-separated so
 * a device grant can never be replayed as a cookie.
 *
 * Fail-closed rules: a token must verify, belong to a known device, not be
 * revoked, and carry the registry's **current grant generation** (`grantSeq`).
 * Rotation bumps the generation, which invalidates every outstanding grant
 * without touching the signature key. State is process-local and never persisted.
 *
 * @module dsh-mobile-remote/device
 */

import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto'

/** Token version this module mints and accepts. */
export const DEVICE_TOKEN_VERSION = 'v1'
/** Domain separation for the derived device-grant key. */
export const DEVICE_KEY_INFO = 'dsh-mobile-remote/device-grant/v1'
/** Default grant lifetime: 30 days, matching the shipped cookie's default. */
export const DEFAULT_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Default bound on the device table. */
export const DEFAULT_DEVICE_LIMIT = 32

/** One registered device. */
export interface DeviceRecord {
  id: string
  label: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}

/** The signed payload of one device grant. */
export interface DeviceGrantPayload {
  version: 1
  deviceId: string
  issuedAt: number
  expiresAt: number
  grantSeq: number
}

/** Why a grant was refused. Closed set. */
export type DeviceRejection = 'malformed' | 'bad-signature' | 'expired' | 'unknown-device' | 'revoked' | 'rotated'

/** Result of verifying a grant. */
export type DeviceVerdict =
  | { ok: true; device: DeviceRecord; payload: DeviceGrantPayload }
  | { ok: false; code: DeviceRejection }

/**
 * Derive the device-grant signing key.
 *
 * @param secret - the caller's secret material (never hardcoded here).
 * @returns a 32-byte HMAC key.
 * @throws when the secret is empty (an empty key would sign for everyone).
 */
export function deviceKey(secret: Uint8Array | string): Buffer {
  const ikm = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret)
  if (ikm.byteLength === 0) throw new Error('device: a non-empty signing secret is required')
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from('dsh-mobile-remote', 'utf8'), Buffer.from(DEVICE_KEY_INFO, 'utf8'), 32))
}

const BASE64URL = /^[A-Za-z0-9_-]*$/

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

/** Sign one payload into `v1.<body>.<signature>`. Pure: key in, clock not read. */
export function signDeviceGrant(key: Buffer, payload: DeviceGrantPayload): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${DEVICE_TOKEN_VERSION}.${body}.${encodeBase64Url(createHmac('sha256', key).update(body).digest())}`
}

function isGrantPayload(value: unknown): value is DeviceGrantPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record['version'] === 1
    && typeof record['deviceId'] === 'string' && record['deviceId'].length > 0
    && Number.isSafeInteger(record['issuedAt'])
    && Number.isSafeInteger(record['expiresAt'])
    && Number.isSafeInteger(record['grantSeq'])
}

/**
 * Verify one grant without touching registry state: format, MAC (constant time),
 * expiry. `now >= expiresAt` is already expired.
 */
export function verifyDeviceGrant(key: Buffer, token: string, now: number): { ok: true; payload: DeviceGrantPayload } | { ok: false; code: 'malformed' | 'bad-signature' | 'expired' } {
  if (typeof token !== 'string') return { ok: false, code: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, code: 'malformed' }
  const [version, body, encodedSignature] = parts as [string, string, string]
  if (version !== DEVICE_TOKEN_VERSION) return { ok: false, code: 'malformed' }
  const actual = decodeBase64Url(encodedSignature)
  if (actual === undefined) return { ok: false, code: 'malformed' }
  const expected = createHmac('sha256', key).update(body).digest()
  if (actual.byteLength !== expected.byteLength) return { ok: false, code: 'bad-signature' }
  if (!timingSafeEqual(actual, expected)) return { ok: false, code: 'bad-signature' }
  const bodyBytes = decodeBase64Url(body)
  if (bodyBytes === undefined) return { ok: false, code: 'malformed' }
  let decoded: unknown
  try { decoded = JSON.parse(bodyBytes.toString('utf8')) } catch { return { ok: false, code: 'malformed' } }
  if (!isGrantPayload(decoded)) return { ok: false, code: 'malformed' }
  if (now >= decoded.expiresAt) return { ok: false, code: 'expired' }
  return { ok: true, payload: decoded }
}

/** Options for {@link DeviceRegistry}. */
export interface DeviceRegistryOptions {
  /** Signing secret (never hardcoded); see {@link deviceKey}. */
  secret: Uint8Array | string
  /** Clock override, epoch ms. */
  now?: () => number
  /** Default grant lifetime. */
  ttlMs?: number
  /** Bound on the device table (oldest non-revoked is dropped beyond it). */
  limit?: number
}

/** The device table plus grant revocation and rotation. */
export class DeviceRegistry {
  private readonly key: Buffer
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly limit: number
  private readonly rows = new Map<string, DeviceRecord>()
  private generation = 1

  constructor(options: DeviceRegistryOptions) {
    this.key = deviceKey(options.secret)
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = options.ttlMs ?? DEFAULT_DEVICE_TTL_MS
    this.limit = options.limit ?? DEFAULT_DEVICE_LIMIT
  }

  /** Mint a grant for a new device (or re-issue one for an existing id). */
  register(label: string, options: { deviceId?: string; ttlMs?: number } = {}): { device: DeviceRecord; token: string; expiresAt: number } {
    const issuedAt = this.now()
    const ttl = options.ttlMs ?? this.ttlMs
    if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('device: ttlMs must be a positive integer')
    const id = options.deviceId ?? randomUUID()
    const existing = this.rows.get(id)
    const device: DeviceRecord = existing ?? { id, label, createdAt: issuedAt, lastSeenAt: issuedAt }
    device.label = label
    // **F2 (t29): re-registering must not resurrect a revoked device.**
    //
    // The caller may name a `deviceId` (a reissue), but that is not an amnesty:
    // clearing `revokedAt` here let anyone holding the shared fence cookie undo
    // a revocation — t14 measured `register {deviceId:<revoked>}` ⇒ 200 with a
    // fresh credential and `revokedAt` back to null. The flag now survives, and
    // the token issued here simply will not verify while the row is revoked.
    // Reversal is the explicit, audited {@link unrevoke} below.
    this.rows.set(id, device)
    while (this.rows.size > this.limit) {
      // **Eviction must never drop a revoked row.** A revoked row *is* the record
      // of the revocation: dropping it made `isRevoked()` false and let the same
      // `deviceId` register again into a token that verifies — reproduced end to
      // end (t33), and exactly the F2/t14 resurrection the comment above claims to
      // have closed. Only the oldest row that is neither the one just registered
      // nor revoked is evictable; when nothing qualifies, the table is allowed to
      // stand above its limit, because a bounded table is not worth losing a
      // revocation record.
      const evictable = [...this.rows.values()]
        .filter((row) => row.id !== id && row.revokedAt === undefined)
        .sort((a, b) => a.createdAt - b.createdAt)[0]
      if (evictable === undefined) break
      this.rows.delete(evictable.id)
    }
    const expiresAt = issuedAt + ttl
    const payload: DeviceGrantPayload = { version: 1, deviceId: id, issuedAt, expiresAt, grantSeq: this.generation }
    // The row stays in the table; the caller gets a copy, exactly as `verify()`
    // does. Handing out the live object let a caller mutate `revokedAt` or
    // `label` without going through `revoke()`/`unrevoke()` — the two audited
    // paths that are supposed to be the only way those fields change.
    return { device: { ...device }, token: signDeviceGrant(this.key, payload), expiresAt }
  }

  /**
   * Verify one grant against the live table: signature/expiry first (stateless),
   * then known device, revocation, and the current grant generation.
   * Returns a **copy** of the record so callers cannot mutate the table.
   */
  verify(token: string, nowOverride?: number): DeviceVerdict {
    const now = nowOverride ?? this.now()
    const verdict = verifyDeviceGrant(this.key, token, now)
    if (!verdict.ok) return { ok: false, code: verdict.code }
    const device = this.rows.get(verdict.payload.deviceId)
    if (device === undefined) return { ok: false, code: 'unknown-device' }
    if (verdict.payload.grantSeq !== this.generation) return { ok: false, code: 'rotated' }
    if (device.revokedAt !== undefined) return { ok: false, code: 'revoked' }
    device.lastSeenAt = now
    return { ok: true, device: { ...device }, payload: verdict.payload }
  }

  /** Revoke one device immediately. Returns false when the id is unknown. */
  revoke(deviceId: string): boolean {
    const device = this.rows.get(deviceId)
    if (device === undefined) return false
    device.revokedAt = this.now()
    return true
  }

  /**
   * Clear one device's revocation **explicitly** (F2 / t29).
   *
   * Deliberately not part of {@link register}: reversal must be a separate,
   * audited, operator-only action (the route refuses it for remote sources and
   * records `result: "device-unrevoked"`), never a side effect of reissuing.
   *
   * @param deviceId - the device to restore.
   * @returns whether the device exists.
   */
  unrevoke(deviceId: string): boolean {
    const device = this.rows.get(deviceId)
    if (device === undefined) return false
    device.revokedAt = undefined
    return true
  }

  /** Bump the grant generation: every outstanding grant becomes `rotated`. */
  rotateGrants(): number {
    this.generation += 1
    return this.generation
  }

  /** Current grant generation, for diagnostics and the audit trail. */
  grantSequence(): number { return this.generation }

  /** The device table, oldest first (copies). */
  devices(): readonly DeviceRecord[] {
    return [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt).map((row) => ({ ...row }))
  }

  /** Whether a device id exists and is revoked. */
  isRevoked(deviceId: string): boolean {
    return this.rows.get(deviceId)?.revokedAt !== undefined
  }
}
