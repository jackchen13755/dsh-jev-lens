/** Where a user creates a TypeSafe API key. Shown as a link in the settings card. */
export declare const TYPESAFE_KEYS_URL = "https://console.typesafe.ai/keys";
/**
 * Default credential reference.
 *
 * Deliberately the same environment variable the official TypeSafe SDK reads, so
 * anyone already using Jev with the official tooling works with no setup.
 */
export declare const DEFAULT_API_KEY_REF = "TYPESAFE_API_KEY";
/** The four operating modes, in the words the card and the report both use. */
export declare const LENS_MODES: readonly ["off", "shadow", "warn", "gate"];
export type LensMode = typeof LENS_MODES[number];
/** Resolved settings shape. */
export interface LensSettings {
    /** Master switch. Off means every automatic judgment and screen is inert. */
    enabled: boolean;
    /** `shadow` measures, `warn` adds the screening notice, `gate` also enforces on commands. */
    mode: LensMode;
    /** Credential reference the key is resolved from, re-resolved on every operation. */
    apiKeyRef: string;
    /** Judge shell commands at all (pre-execute accounting / gating). */
    judgeCommands: boolean;
    /** Ask the second (recoverability) question in the same request. */
    batchedQuestions: boolean;
    /** Band edges on the destructive probability. */
    lowThreshold: number;
    highThreshold: number;
    /** Probability at which a screened page earns a warning. */
    warnThreshold: number;
    /**
     * Hard ceiling on one background judgment. The knob that answers "don't hang":
     * a dead endpoint costs this much once, and then the breaker skips it.
     */
    requestTimeoutMs: number;
    /** Budget for the one call a turn actually waits on. */
    screenTimeoutMs: number;
    /** Budget for an awaited gate decision. */
    gateTimeoutMs: number;
    sessionCallLimit: number;
    dailyCallLimit: number;
}
/** Resolved defaults, used whenever storage is absent or unreadable. */
export declare const LENS_DEFAULTS: LensSettings;
/**
 * Check the constraints a type cannot state, with a message that names the field
 * and the range. Returns `undefined` when the value is usable.
 */
export declare function validateSettings(value: LensSettings): string | undefined;
/** Merge a partial, untrusted patch onto the defaults, dropping anything unusable. */
export declare function mergeSettings(base: LensSettings, patch: unknown): LensSettings;
/** Read the stored settings. A corrupt or absent file is simply "no opinion". */
export declare function loadStored(dir: string): Partial<LensSettings> | undefined;
/** Persist settings, host-side and owner-only. Returns false when it could not land. */
export declare function saveStored(dir: string, value: LensSettings): boolean;
/**
 * The fallback key store, for a profile without the credential service.
 *
 * 0600, host-written, and only ever read back into memory — the value never
 * rides an HTTP response, which is what keeps the card honest about not echoing
 * a secret.
 */
export declare function loadSecret(dir: string): string;
/** Store the fallback key. Best-effort: the caller reports the failure. */
export declare function saveSecret(dir: string, apiKey: string): boolean;
