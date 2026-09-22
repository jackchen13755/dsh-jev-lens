/**
 * The settings surface: what a human can change without editing a patch file.
 *
 * The reason this exists at all is the failure mode it removes. Every knob here
 * was previously a composition value, which meant "the key is wrong" and "the
 * timeout is too long" could only be fixed by editing YAML and restarting the
 * harness — and a wrong key could hold a call for the full transport timeout on
 * every single invocation. An input box plus a hard timeout is the whole feature.
 *
 * Storage is deliberately local and deliberately boring: a JSON document next to
 * the ledger, written by the host, never by the agent. The obvious alternative —
 * the harness settings provider — would drag a schema-builder dependency into
 * this plugin's module graph, and a plugin whose configuration surface can break
 * the loader is worse than one without a card. The credential itself still goes
 * to the harness credential store when that service exists; the local file is
 * only the fallback for a profile that has none.
 *
 * `enabled: false` is exactly as inert as a missing key: no request, no judgment,
 * no warning — but the tools still work, so the instrument can be inspected while
 * it is switched off.
 *
 * @module dsh-jev-lens/settings
 */
import fs from 'node:fs'
import path from 'node:path'

/** Where a user creates a TypeSafe API key. Shown as a link in the settings card. */
export const TYPESAFE_KEYS_URL = 'https://console.typesafe.ai/keys'

/**
 * Default credential reference.
 *
 * Deliberately the same environment variable the official TypeSafe SDK reads, so
 * anyone already using Jev with the official tooling works with no setup.
 */
export const DEFAULT_API_KEY_REF = 'TYPESAFE_API_KEY'

/** The four operating modes, in the words the card and the report both use. */
export const LENS_MODES = ['off', 'shadow', 'warn', 'gate'] as const
export type LensMode = typeof LENS_MODES[number]

/** Resolved settings shape. */
export interface LensSettings {
  /** Master switch. Off means every automatic judgment and screen is inert. */
  enabled: boolean
  /** `shadow` measures, `warn` adds the screening notice, `gate` also enforces on commands. */
  mode: LensMode
  /** Credential reference the key is resolved from, re-resolved on every operation. */
  apiKeyRef: string
  /** Judge shell commands at all (pre-execute accounting / gating). */
  judgeCommands: boolean
  /** Ask the second (recoverability) question in the same request. */
  batchedQuestions: boolean
  /** Band edges on the destructive probability. */
  lowThreshold: number
  highThreshold: number
  /** Probability at which a screened page earns a warning. */
  warnThreshold: number
  /**
   * Hard ceiling on one background judgment. The knob that answers "don't hang":
   * a dead endpoint costs this much once, and then the breaker skips it.
   */
  requestTimeoutMs: number
  /** Budget for the one call a turn actually waits on. */
  screenTimeoutMs: number
  /** Budget for an awaited gate decision. */
  gateTimeoutMs: number
  /**
   * Gate conservatively: a `block` escalates to the human instead of refusing.
   * The one-line answer to "I want the warning but not the veto".
   */
  gateAskOnly: boolean
  sessionCallLimit: number
  dailyCallLimit: number
}

/** Resolved defaults, used whenever storage is absent or unreadable. */
export const LENS_DEFAULTS: LensSettings = {
  enabled: true,
  mode: 'shadow',
  apiKeyRef: DEFAULT_API_KEY_REF,
  judgeCommands: true,
  batchedQuestions: true,
  lowThreshold: 0.5,
  highThreshold: 0.7,
  warnThreshold: 0.75,
  // Measured on this machine: ~200 ms network + ~270–340 ms service time, so
  // ~0.5 s warm and ~1 s cold. 8 s is a ceiling, not an expectation.
  requestTimeoutMs: 8000,
  screenTimeoutMs: 1200,
  gateTimeoutMs: 4000,
  gateAskOnly: false,
  sessionCallLimit: 300,
  dailyCallLimit: 2000,
}

/** One numeric field's bounds. */
const BOUNDS: Record<string, [number, number]> = {
  lowThreshold: [0, 1],
  highThreshold: [0, 1],
  warnThreshold: [0, 1],
  requestTimeoutMs: [300, 60_000],
  screenTimeoutMs: [200, 30_000],
  gateTimeoutMs: [200, 60_000],
  sessionCallLimit: [0, 100_000],
  dailyCallLimit: [0, 1_000_000],
}

/**
 * Check the constraints a type cannot state, with a message that names the field
 * and the range. Returns `undefined` when the value is usable.
 */
export function validateSettings (value: LensSettings): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.apiKeyRef)) {
    return `apiKeyRef 必须形如 ENV_VAR_NAME（当前 ${JSON.stringify(value.apiKeyRef)}）`
  }
  if (!LENS_MODES.includes(value.mode)) return `mode 必须是 ${LENS_MODES.join(' / ')} 之一`
  for (const [field, [min, max]] of Object.entries(BOUNDS)) {
    const number = (value as unknown as Record<string, unknown>)[field]
    if (typeof number !== 'number' || !Number.isFinite(number)) return `${field} 必须是数字`
    if (number < min || number > max) return `${field} 必须在 ${min}–${max} 之间（当前 ${number}）`
  }
  if (value.lowThreshold > value.highThreshold) {
    return `lowThreshold(${value.lowThreshold}) 不能大于 highThreshold(${value.highThreshold})`
  }
  return undefined
}

/** Merge a partial, untrusted patch onto the defaults, dropping anything unusable. */
export function mergeSettings (base: LensSettings, patch: unknown): LensSettings {
  const p = (patch ?? {}) as Partial<LensSettings>
  const out: LensSettings = { ...base }
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled
  if (typeof p.mode === 'string' && (LENS_MODES as readonly string[]).includes(p.mode)) out.mode = p.mode as LensMode
  if (typeof p.apiKeyRef === 'string' && p.apiKeyRef.trim()) out.apiKeyRef = p.apiKeyRef.trim()
  if (typeof p.judgeCommands === 'boolean') out.judgeCommands = p.judgeCommands
  if (typeof p.batchedQuestions === 'boolean') out.batchedQuestions = p.batchedQuestions
  if (typeof p.gateAskOnly === 'boolean') out.gateAskOnly = p.gateAskOnly
  for (const field of Object.keys(BOUNDS) as Array<keyof LensSettings>) {
    const value = p[field]
    if (typeof value === 'number' && Number.isFinite(value)) (out[field] as number) = value
  }
  return out
}

const settingsFile = (dir: string): string => path.join(dir, 'config.json')
const secretFile = (dir: string): string => path.join(dir, 'secret.json')

/** Read the stored settings. A corrupt or absent file is simply "no opinion". */
export function loadStored (dir: string): Partial<LensSettings> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(dir), 'utf8')) as Partial<LensSettings>
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Persist settings, host-side and owner-only. Returns false when it could not land. */
export function saveStored (dir: string, value: LensSettings): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(settingsFile(dir), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/**
 * The fallback key store, for a profile without the credential service.
 *
 * 0600, host-written, and only ever read back into memory — the value never
 * rides an HTTP response, which is what keeps the card honest about not echoing
 * a secret.
 */
export function loadSecret (dir: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(secretFile(dir), 'utf8')) as { apiKey?: string }
    return typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : ''
  } catch {
    return ''
  }
}

/** Store the fallback key. Best-effort: the caller reports the failure. */
export function saveSecret (dir: string, apiKey: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(secretFile(dir), JSON.stringify({ apiKey }, null, 2) + '\n', { mode: 0o600 })
    return true
  } catch {
    return false
  }
}
