export interface FailureSignal {
    /** The command that failed, when the tool call exposed one. */
    command: string;
    /** The interesting part of the output: failure blocks, not the whole log. */
    excerpt: string;
    /** Stable id of this failure, for caching and for "seen this one before". */
    signature: string;
    /** What kind of runner this looks like — used in the rendered line. */
    runner: string;
}
/**
 * Decide whether this tool call is a test failure worth triaging.
 *
 * Returns `null` for everything else — including a failing *non-test* command, because
 * the value of this observer comes from being quiet most of the time.
 */
export declare function detectTestFailure(input: {
    name?: string;
    command?: string;
    text?: string;
    isError?: boolean;
}): FailureSignal | null;
/** Render the kit's verdict as one line for the transcript. */
export declare function renderTriage(signal: FailureSignal, response: {
    findings?: Array<{
        level?: string;
        headline?: string;
        values?: Record<string, unknown>;
    }>;
}): string | null;
