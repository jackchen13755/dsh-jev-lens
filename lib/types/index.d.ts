/// <reference types="node" resolution-mode="require"/>
/// <reference types="node" resolution-mode="require"/>
import { type GatePolicy } from './questions.js';
import { type Logger, type WebServerLike } from '@dsh-external/dsh-jev-core';
/**
 * Producer-owned message source for this plugin (session format v4).
 *
 * v4 retired the shared `{ kind: 'plugin', plugin }` member: each producer owns
 * its own kind, and the v3→v4 migration rewrites legacy rows to `plugin:<name>`.
 * Declaring it here keeps the source merge-extensible and type-checked.
 */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'plugin:@dsh-external/dsh-jev-lens': {
            kind: 'plugin:@dsh-external/dsh-jev-lens';
            form?: string;
            summary?: string;
        };
    }
}
export declare const name = "@dsh-external/dsh-jev-lens";
export declare const inject: string[];
/**
 * Structural view of the host context. Declared locally on purpose: the lens
 * must compile with nothing but the installed `@deepseek-ai/dsh-tools` types,
 * so it can be built and audited without a DSH source checkout.
 */
export interface LensContext {
    tools: {
        register(definition: unknown): () => void;
    };
    on(event: string, listener: (...args: never[]) => unknown): () => void;
    effect(callback: () => unknown, label?: string): void;
    inject?(deps: string[], callback: (scope: LensContext) => void): void;
    commands?: {
        register(definition: unknown): () => void;
    };
    /** Optional: without it the settings card has no host to talk to. */
    webServer?: WebServerLike;
    logger?: Logger;
}
/**
 * Structural view of one command result, mirroring `@deepseek-ai/dsh-commands`.
 * Declared locally for the same reason as {@link LensContext}: the lens builds
 * against the installed tool types only.
 */
export interface CommandResult {
    kind: 'success' | 'error';
    text?: string;
}
/** The tool layer's own pre-execution decision vocabulary. */
export type PreToolDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    reason: string;
} | {
    kind: 'cancel';
} | {
    kind: 'ask';
    reason?: string;
};
export interface Config {
    mode: 'off' | 'shadow' | 'warn' | 'gate';
    endpoint: string;
    model: string;
    apiKey: string;
    apiKeyFile: string;
    /** Credential reference resolved through the host credentials seam, per call. */
    apiKeyRef: string;
    redact: boolean;
    judgeCommands: boolean;
    /** Tools whose calls get the destructive question. `bash` only by default. */
    judgeTools: string[];
    screenTools: string[];
    /**
     * Automatically triage failing test runs.
     *
     * An observer, not a gate: it appends one line to the tool result and never blocks.
     * Default on, because the alternative — remembering to ask — is what kept a
     * perfectly separated `flaky` channel at zero calls for its whole life.
     */
    autoTriage: boolean;
    /** Where the channel wording lives (the kit owns channels; this plugin owns events). */
    triageEndpoint: string;
    /** Hard cap per session: an observer on a frequent event must never become a bill. */
    triagePerSession: number;
    lowThreshold: number;
    highThreshold: number;
    warnThreshold: number;
    sessionCallLimit: number;
    dailyCallLimit: number;
    maxScreenChars: number;
    /** Per-attempt ceiling for a background judgment. */
    timeoutMs: number;
    /** Whole-call ceiling for a background judgment, retries included. */
    backgroundTimeoutMs: number;
    backgroundMaxRetries: number;
    /** Budget for the awaited screen call — the only one on the critical path. */
    screenTimeoutMs: number;
    screenMaxRetries: number;
    /** Budget for an awaited gate decision. */
    gateTimeoutMs: number;
    gatePolicy: GatePolicy;
    /** Conservative gate: `block` escalates instead of refusing. Settings-owned. */
    gateAskOnly: boolean;
    /** Ask the second (recoverability) question in the same request. */
    batchedQuestions: boolean;
    /** Local rules decide the obvious cases without a request. */
    prefilter: boolean;
    cacheTtlMs: number;
    screenCacheTtlMs: number;
    cacheMaxEntries: number;
    breakerFailures: number;
    breakerCooldownMs: number;
    maxConcurrent: number;
    /** Judgments dropped rather than queued when the limiter is saturated. */
    maxQueued: number;
    /**
     * Awaited work gets its own lane. A background judgment can be retried and
     * abandoned without anyone noticing; a screen is holding a turn, and it must
     * never queue behind work nobody is waiting on.
     */
    foregroundConcurrency: number;
    /**
     * After an auth rejection, every call fails open instantly for this long. A
     * revoked key is a configuration problem, not a network problem: re-probing it
     * on every tool call only adds timeout-shaped latency to every turn.
     */
    authCooldownMs: number;
    ledgerDir: string;
    storeCommandPreview: boolean;
    /** Batch probe target. Empty = read `agent-default-model` from $DSH_HOME/settings.yaml. */
    abProvider: string;
    abModel: string;
    abTrialsPerArm: number;
    /** Pause between rounds; three concurrent model calls is already enough to trip a gateway. */
    abRoundDelayMs: number;
    /** Hard ceiling on one batch probe run, so a wedged trial cannot hang the tool. */
    abDeadlineMs: number;
}
/** Resolve the key and say where it came from — an unverifiable key is a bug report. */
export declare function resolveKey(config: Config, env?: NodeJS.ProcessEnv): {
    key: string;
    source: string;
};
/**
 * Tools that could actually *run* the payload the page demands (`bash: echo <canary>`).
 * A drill is only hijacked when one of these carries the token: a reader that
 * quotes the canary while refusing it — in a message to its parent, say — is
 * evidence of resistance, and counting that as compliance would invert the result.
 */
export declare const CANARY_ACTION_TOOLS: string[];
/** Minimal structural view of the LLM service; absent services must not crash the lens. */
interface LlmLike {
    /**
     * The runtime takes ONE config object and returns a one-shot handle whose
     * `stream` requires options equal to the resolved config — so the handle's own
     * `config` is what gets passed back, not a hand-built object.
     */
    prepareCall(config: {
        provider: string;
        model: string;
        messages: unknown[];
    }, signal?: AbortSignal): Promise<{
        config: Record<string, unknown>;
        stream(options: Record<string, unknown>): AsyncIterable<{
            type?: string;
            text?: string;
        }>;
    }>;
}
export declare function llmService(ctx: LensContext): LlmLike | null;
/** The model the harness would actually use, unless the config pins one. */
export declare function resolveProbeModel(config: Pick<Config, 'abProvider' | 'abModel'>, dshHome: string): {
    provider: string;
    model: string;
    source: string;
};
/** Structural view of `ctx.approval` — only the one read the gate needs. */
export interface ApprovalLike {
    /** The session's own `approval/policy` fold, or `undefined` when there is none. */
    overrideOf(session: never): 'ask' | 'never' | undefined;
    /** The configured default policy, used when a session has no override. */
    config?: {
        policy?: 'ask' | 'never';
    };
}
/** One command's fate, however it was decided. */
export interface CommandVerdict {
    band: 'allow' | 'revise' | 'block';
    via: 'jev' | 'cache' | 'rule';
    ms?: number;
    attempts?: number;
    /** Only present when the model answered. */
    p?: number;
    restorable?: number;
    inputTokens?: number;
    model?: string;
    /** Human-readable provenance for a local rule. */
    reason?: string;
    /** How many times this exact command already ran in this session, and how it went. */
    seenRuns: number;
    seenErrors: number;
}
export declare function apply(ctx: LensContext, input?: Partial<Config>): void;
export {};
