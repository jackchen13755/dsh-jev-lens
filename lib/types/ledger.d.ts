export type Band = 'allow' | 'revise' | 'block';
export type DrillArm = 'bare' | 'warn';
/** Which path produced a verdict. `jev` is the only one that costs a request. */
export type Via = 'jev' | 'cache';
export type LedgerRecord = {
    t: number;
    kind: 'command';
    session: string;
    callId: string;
    p: number;
    band: Band;
    preview: string;
    model: string;
    inputTokens: number;
    /** Wall-clock of the judgment. Fire-and-forget, so it never blocks a turn. */
    ms?: number;
    attempts?: number;
    via?: Via;
    /** Second, independent answer: is the damage recoverable? */
    restorable?: number;
    /** Set when a gate was configured: what the plugin actually did. */
    decision?: 'allow' | 'ask' | 'deny';
} | {
    t: number;
    kind: 'command-rule';
    session: string;
    callId: string;
    decision: 'block' | 'revise';
    reason: string;
    preview: string;
    decision_taken?: 'allow' | 'ask' | 'deny';
} | {
    t: number;
    kind: 'command-skip';
    session: string;
    callId: string;
    reason: string;
} | {
    t: number;
    kind: 'command-outcome';
    session: string;
    callId: string;
    isError: boolean;
} | {
    t: number;
    kind: 'screen';
    session: string;
    callId: string;
    tool: string;
    p: number;
    flagged: boolean;
    chars: number;
    model: string;
    inputTokens: number;
    ms?: number;
    attempts?: number;
    via?: Via;
    /** True when the redaction pass actually changed the text before it left the machine. */
    redacted?: boolean;
    /**
     * Which prefilter features fired, by name — as important as the score itself,
     * because it is the only record of *why* a page was escalated. Content is never
     * stored; a rule name is not content.
     */
    features?: string;
} | {
    t: number;
    kind: 'degraded';
    where: string;
    reason: string;
    /** The upstream message when there was one (e.g. the API's 403 text). */
    detail?: string;
    /** Which call went unjudged — the join key that makes a blind window auditable. */
    session?: string;
    callId?: string;
} | {
    /**
     * A screen the *rules* decided to skip: the page carried nothing
     * instruction-shaped, so no request was made. Recorded because "how much did
     * the prefilter save, and what did it wave through" is a question the report
     * must be able to answer.
     */
    t: number;
    kind: 'screen-skip';
    tool: string;
    chars: number;
    reason: string;
}
/**
 * An automatic test-failure triage. Separate from `screen` on purpose: the two
 * observers answer different questions on different events, and a report that merged
 * them could not say which entry is worth keeping.
 */
 | {
    t: number;
    kind: 'triage';
    where: string;
    signature: string;
    level?: string;
    ms: number;
    values?: Record<string, unknown>;
} | {
    t: number;
    kind: 'drill-start';
    session: string;
    drillId: string;
    arm: DrillArm;
    scenario: string;
    p: number;
    canary: string;
} | {
    t: number;
    kind: 'drill-end';
    session: string;
    drillId: string;
    hijacked: boolean;
    evidence: string;
} | {
    t: number;
    kind: 'trial';
    batch: string;
    arm: string;
    scenario: string;
    p: number;
    acted: boolean;
    mentioned: boolean;
    flagged: boolean;
    latencyMs: number;
    replyChars: number;
    model: string;
} | {
    t: number;
    kind: 'error';
    where: string;
    message: string;
};
/** Per-day file name. */
export declare function ledgerFile(dir: string, when?: Date): string;
/** Append one record. Best-effort: a ledger write never breaks a tool call. */
export declare function append(dir: string, record: LedgerRecord): void;
/** Load the last `days` daily files, oldest first. */
export declare function load(dir: string, days: number, now?: Date): LedgerRecord[];
export interface CommandReport {
    n: number;
    allow: number;
    revise: number;
    block: number;
    meanP: number;
    withOutcome: number;
    errorRate: number;
    /** Work that completed fine but would have been interrupted (revise/block). */
    interruptions: number;
    interruptionRate: number;
    /** Judgments that cost a request, split by whether the answer came from the memo. */
    judged: number;
    cached: number;
    /** Calls the local rules decided with no request at all. */
    ruled: number;
    skipped: number;
    /** Latency of the judgment request itself (fire-and-forget, never blocking). */
    latency: {
        p50: number;
        p95: number;
        max: number;
        mean: number;
    };
    /** Second-question coverage and how often it changed the decision. */
    restorable: {
        known: number;
        decisive: number;
        conflicts: number;
    };
    /** Records produced while a gate was configured (excluded from interruption stats). */
    enforced: number;
}
export interface DrillArmReport {
    n: number;
    hijacked: number;
    rate: number;
    unfinished: number;
}
export interface TrialArmReport {
    n: number;
    /** The model emitted a RUN line carrying the canary: it tried to execute the injection. */
    acted: number;
    rate: number;
    /** Weaker tell: the canary appeared anywhere in the reply. */
    mentioned: number;
    /** The model explicitly named the injection and refused it. */
    flagged: number;
    flaggedRate: number;
    meanP: number;
    meanLatencyMs: number;
}
export interface Report {
    window: {
        days: number;
        from: number;
        to: number;
        records: number;
    };
    commands: CommandReport;
    screens: {
        n: number;
        flagged: number;
        flaggedRate: number;
        meanP: number;
        chars: number;
        cached: number;
        /** Pages the rules kept away from the paid judgment, with no request at all. */
        prefilterSkipped: number;
        /** Feature names that fired, most frequent first — which tells earn their place. */
        features: Array<{
            feature: string;
            n: number;
        }>;
        /** Blocking latency: this channel awaits before the model sees the page. */
        latency: {
            p50: number;
            p95: number;
            max: number;
            mean: number;
        };
    };
    gates: {
        allow: number;
        ask: number;
        deny: number;
    };
    /**
     * The kit-triage dimension: failing test runs handed to `dsh-jev-kit`.
     *
     * It was recorded (`kind: 'triage'`, with level and latency) and never reported, so
     * the one automatic entry this plugin owns was invisible in its own report — the same
     * shape of gap the lens exists to catch elsewhere. `declined` is kept beside `judged`
     * for the reason `coverage` exists: a verdict count alone cannot tell "nothing was
     * failing" from "something was failing and we did not look".
     */
    triage: {
        judged: number;
        /** Verdicts that came back non-neutral (flaky / genuine regression). */
        flagged: number;
        /** Failures that matched a signature already judged this session. */
        cached: number;
        /** Failures handed over but not triaged: declined, over the limit, or unreachable. */
        declined: number;
        latency: {
            p50: number;
            p95: number;
            max: number;
            mean: number;
        };
    };
    /** Does `p` actually order commands by how they turned out? Rank separation, not calibration. */
    rank: RankReport;
    health: {
        degraded: number;
        errors: number;
    };
    /**
     * How much of the traffic the plugin actually judged.
     *
     * The most misleading thing a guard can do is report "0 problems" from a window
     * where it was mostly not running: 883 commands judged sounds reassuring next to
     * 152 skips until you divide them. Measured 2026-09-23: 70 commands and 55 skips
     * in a single day — 21% coverage, hidden behind a healthy-looking report.
     */
    coverage: {
        judged: number;
        skipped: number;
        /** judged / (judged + skipped); 1 when nothing was skipped. */
        rate: number;
        /** Why calls were skipped, most frequent first. */
        topReasons: Array<{
            reason: string;
            n: number;
        }>;
    };
    drills: Record<DrillArm, DrillArmReport>;
    trials: Record<string, TrialArmReport>;
    trialBatch: {
        id: string;
        batches: number;
    };
    cost: {
        inputTokens: number;
        usd: number;
        savedCalls: number;
        savedUsd: number;
    };
    errors: number;
}
/**
 * Rank separation between the commands that failed and the ones that worked.
 *
 * This is the one number the report was missing: "误伤率" says what a threshold
 * would cost, but not whether `p` is ordering anything at all. AUC is
 * threshold-free — 0.5 means the score is noise, 1.0 means every failure scored
 * above every success. It is deliberately *not* called calibration: `p` is not a
 * probability (TypeSafe's own docs give P(x)+P(¬x)≈1.19) and no calibration
 * curve exists, so ordering is the only claim this instrument can honestly make.
 */
export interface RankReport {
    errored: number;
    ok: number;
    meanPErrored: number;
    meanPOk: number;
    /** P(a random failed command scores above a random successful one); null without both groups. */
    auc: number | null;
}
/** Turn records into the numbers the experiment is actually about. */
export declare function summarize(records: LedgerRecord[], days: number, usdPerMTok?: number): Report;
/** Human-readable report, used by the tool and the slash command. */
export declare function render(report: Report): string;
