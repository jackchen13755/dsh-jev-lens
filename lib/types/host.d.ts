/**
 * Structural shapes for the host services this plugin consumes.
 *
 * Deliberately NOT imported from `@deepseek-ai/dsh-*`: the npm-published
 * packages lag the running harness, so a plugin that type-depends on them
 * compiles against signatures the host does not have. The real contract is the
 * **service key string** plus the shapes below, and structural typing keeps this
 * plugin working across harness releases instead of breaking on a type rename.
 *
 * @module dsh-jev-lens/host
 */
/** A resolved credential value and where it came from. */
export interface ResolvedCredential {
    readonly value: string;
    readonly source: string;
}
/** Configuration-surface description of a credential reference. Never carries the literal. */
export interface CredentialInfo {
    readonly configured: boolean;
    readonly source?: string;
    readonly writable: boolean;
}
/**
 * `ctx.credentials` — the reference half.
 *
 * One rule binds every consumer: **resolution is per operation**. A consumer must
 * re-resolve at each call and must not cache across calls; that per-operation
 * read is what lets a user paste a corrected key and have the very next judgment
 * use it, with no restart and no stale 401 loop.
 */
export interface CredentialsService {
    resolve(ref: string): Promise<ResolvedCredential | undefined>;
    describe(ref: string): Promise<CredentialInfo>;
    /** The only ref write path. Absent on a read-only provider. */
    set?(ref: string, value: string): Promise<void>;
    unset?(ref: string): Promise<void>;
}
/** One HTTP route owned by this plugin. The handler owns the whole response. */
export interface WebRoute {
    kind: 'exact' | 'prefix';
    /** Absolute pathname, no trailing slash. */
    path: string;
    handler: (req: WebRequestLike, res: WebResponseLike) => void | Promise<void>;
}
/** The slice of `node:http`'s request this plugin actually uses. */
export interface WebRequestLike {
    method?: string;
    url?: string;
    on(event: string, listener: (...args: never[]) => void): unknown;
}
/** The slice of `node:http`'s response this plugin actually uses. */
export interface WebResponseLike {
    writeHead(status: number, headers: Record<string, string>): unknown;
    end(body?: string): unknown;
}
/** `ctx.webServer` — the browser HTTP carrier. */
export interface WebServerLike {
    register(route: WebRoute): () => void;
}
/** Hooks one optional-settings consumer supplies to the settings provider. */
export interface SettingsSectionHooks<T> {
    setSource(current: () => T): void;
    onChange(): void;
    validate?(value: T): void;
}
/** `ctx.settings` — namespace registration and configuration surfaces. */
export interface SettingsService {
    installSection(owner: unknown, ns: string, schema: unknown, entry: unknown, hooks: SettingsSectionHooks<never>): void;
    get(ns: string): unknown;
}
/** Logging surface. Optional: a context without it must not crash the plugin. */
export interface Logger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
/**
 * Read one optional service off a context without assuming the shape of `ctx`.
 *
 * The `get` call is guarded on purpose: cordis *throws* when a plugin reads a
 * service it did not declare, and a plugin that dies while looking for an
 * optional seam is worse than one that runs without it. A caller that needs the
 * service for real must still obtain it through `ctx.inject`, which is what
 * makes the dependency visible to the loader.
 */
export declare function serviceOf<T>(ctx: unknown, key: string): T | undefined;
