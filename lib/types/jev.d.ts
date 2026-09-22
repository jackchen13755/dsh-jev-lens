/**
 * Jev transport for the lens: one endpoint, pinned model, bounded retries,
 * and a redaction pass that runs before anything leaves the machine.
 *
 * Deliberately dependency-free: the plugin talks to the documented HTTP
 * contract rather than pulling in an SDK (the trial must not add supply chain
 * to a measurement instrument).
 *
 * Two policies here were changed after measuring what a bad day costs:
 *
 *   · **A non-retryable status is not retried.** A 401 (revoked key) or a 400
 *     (malformed state) cannot succeed on the second attempt; retrying it three
 *     times only delays fail-open by `timeout × attempts` on a call that is
 *     already on the critical path.
 *   · **Every call carries its own timeout and attempt budget.** A fire-and-forget
 *     judgment can afford 20 s; a screen that the turn is waiting on cannot. The
 *     caller decides, because only the caller knows whether anyone is waiting.
 *
 * @module dsh-jev-lens/jev
 */
/// <reference types="node" resolution-mode="require"/>
/** The three primitives. A question is exactly one of these. */
export type JevQuestion = {
    type: 'noul';
    instructions: string;
    criteria?: Record<string, string>;
} | {
    type: 'choice';
    instructions: string;
    criteria: Record<string, string>;
} | {
    type: 'score';
    instructions: string;
    criteria: string[];
};
/** One typed answer as the API returns it. */
export interface JevAnswer {
    type: string;
    noul?: number;
    choice?: string;
    score?: number;
    confidence?: number;
    probabilities?: Record<string, number>;
}
export interface JevUsage {
    input_tokens?: number;
    output_tokens?: number;
}
export interface JevResult {
    answers: Record<string, JevAnswer>;
    model: string;
    usage?: JevUsage;
    /** Wall-clock of the request that succeeded, including retries. */
    ms: number;
    /** 1 on the first try; >1 when a retryable failure was survived. */
    attempts: number;
}
export interface JevModel {
    name?: string;
    description?: string;
    release_date?: string;
}
export interface JevOptions {
    endpoint: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
}
/** Per-call overrides. A caller that is blocking a turn passes a small budget. */
export interface AskOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
}
/** HTTP statuses worth a second attempt: throttling and server-side faults. */
export declare function isRetryableStatus(status: number): boolean;
/**
 * Strip the shapes that must not reach a third party. This is a mitigation and
 * not a permission: an unrecognised secret in free text still passes through.
 *
 * The built-in set covers only shapes that are universal — home directories,
 * e-mail addresses, and the token formats every provider uses. Anything
 * organisation-specific (an intranet domain, an internal host suffix) belongs in
 * `redactExtra`, because a published default that names one company's domains
 * leaks that company in exchange for protecting it. Compile the extras once with
 * {@link compileExtraPatterns}; an invalid pattern is dropped, never thrown.
 */
export declare function redact(text: string, extra?: readonly RegExp[]): string;
/** Build the caller's patterns once. A bad regex is skipped, not fatal. */
export declare function compileExtraPatterns(sources?: readonly string[]): RegExp[];
/** Normalize an abort reason into something a log line can carry. */
export declare function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal;
export interface JevStats {
    calls: number;
    failures: number;
    inputTokens: number;
    /** Total wall-clock spent inside `ask`, including failed attempts. */
    spentMs: number;
}
export interface Jev {
    ask(state: unknown, questions: Record<string, JevQuestion>, options?: AskOptions): Promise<JevResult>;
    /** Live model list — the only endpoint that can prove a key still works. */
    models(options?: {
        timeoutMs?: number;
    }): Promise<{
        models: JevModel[];
    }>;
    /** Requests that actually left the process, for the report. */
    readonly stats: JevStats;
}
/** An error carrying the status, so callers can tell auth from outage. */
export declare class JevError extends Error {
    readonly status: number;
    readonly retryable: boolean;
    constructor(message: string, status: number, retryable: boolean);
}
/** Build a transport. Every failure is the caller's to interpret; nothing is retried forever. */
export declare function createJev(options: JevOptions): Jev;
