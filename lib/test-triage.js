/**
 * Test-failure triage: the event that actually happens every day.
 *
 * The kit has had a `flaky` channel and a `failure_triage` channel for a while, and
 * both measured well (separation 1.00) — and both sat at zero calls, because a channel
 * only earns its keep once something *happens* that triggers it. Running a test suite
 * is the most frequent such event in this workflow, and it was the one event with no
 * entry point.
 *
 * This module is the **detector**, and it lives in the lens rather than the kit on
 * purpose: the kit owns channels and calibration, the lens owns hooks and events. It
 * sends an excerpt to the kit's `/api/triage` route and renders whatever comes back —
 * and if the kit is not installed, it reports nothing and stays quiet. No project has
 * to change for this to work: the entry point is a hook the tool already had.
 *
 * @module dsh-jev-lens/test-triage
 */
import { createHash } from 'node:crypto';
/** How much of a failing run is worth sending. Logs are long; failures are local. */
const MAX_EXCERPT = 4000;
const RUNNERS = [
    { name: 'vitest', pattern: /\b(vitest|vite\s+test)\b/ },
    { name: 'jest', pattern: /\bjest\b/ },
    { name: 'mocha', pattern: /\bmocha\b/ },
    { name: 'playwright', pattern: /\bplaywright\b/ },
    { name: 'pytest', pattern: /\bpytest\b|\bpython\s+-m\s+pytest/ },
    { name: 'go test', pattern: /\bgo\s+test\b/ },
    { name: 'cargo test', pattern: /\bcargo\s+test\b/ },
    { name: 'npm/pnpm/yarn test', pattern: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)\b/ },
];
/**
 * Failure markers, in rough order of how specific they are.
 *
 * A bare `error` is deliberately absent: every failed command prints something like it,
 * and triaging "command not found" as a flaky test would be worse than silence.
 */
const FAILURE_MARKERS = [
    /^\s*FAIL\s+\S+/m,
    /^\s*✕\s+/m,
    /^\s*×\s+/m,
    /^\s*●\s+.*›/m,
    /^\s*not ok\s+\d+/m,
    /Test Suites?:\s*.*\d+\s*failed/i,
    /Tests?:\s*.*\d+\s*failed/i,
    /\b\d+\s+failed\b/,
    /AssertionError/,
    /^\s*FAILED\s+\S+/m,
    /^\s*E\s+assert\b/m,
    /expected .* to (be|equal|match|contain)/i,
    /panicked at/,
    /test result: FAILED/,
];
function runnerOf(command, text) {
    for (const runner of RUNNERS) {
        if (runner.pattern.test(command))
            return runner.name;
    }
    // Fall back to the output: a wrapper script (`npm run verify`) still prints the
    // runner's own banner, and that is the useful name to show.
    for (const runner of RUNNERS) {
        if (runner.pattern.test(text.slice(0, 2000)))
            return runner.name;
    }
    return null;
}
/**
 * Pull out the failure blocks rather than the head of the log.
 *
 * `vitest` and `jest` both print a summary at the end and the failure detail in the
 * middle; `pytest` prints failures first and the summary last. Collecting the marked
 * lines with a little context covers both without guessing the runner.
 */
function excerptOf(text) {
    if (text.length <= MAX_EXCERPT)
        return text;
    const lines = text.split('\n');
    const picked = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (FAILURE_MARKERS.some(marker => marker.test(line))) {
            picked.push(...lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 8)));
            if (picked.length >= 120)
                break;
        }
    }
    if (picked.length === 0)
        return text.slice(0, MAX_EXCERPT);
    const body = [...new Set(picked)].join('\n');
    // The tail carries the counts ("Tests 2 failed | 47 passed") and is cheap to add.
    const summary = lines.slice(-40).join('\n');
    return `${body}\n…\n${summary}`.slice(0, MAX_EXCERPT);
}
/**
 * Decide whether this tool call is a test failure worth triaging.
 *
 * Returns `null` for everything else — including a failing *non-test* command, because
 * the value of this observer comes from being quiet most of the time.
 */
export function detectTestFailure(input) {
    const name = input.name ?? '';
    // Exec-like tools only. A `read` result can contain a saved log, but triaging every
    // file read would turn a useful observer into noise.
    if (!/(bash|shell|exec|command|terminal|run)/i.test(name))
        return null;
    const command = input.command ?? '';
    const text = input.text ?? '';
    if (text.length < 40)
        return null;
    const matched = FAILURE_MARKERS.filter(marker => marker.test(text));
    if (matched.length === 0)
        return null;
    const runner = runnerOf(command, text);
    // Either the command names a test runner, or the output is unmistakably a test
    // summary. Two independent signals, so a `grep FAIL` in a shell script does not
    // qualify on its own.
    const strongSummary = /Test Suites?:\s*.*\d+\s*failed|Tests?:\s*.*\d+\s*failed|test result: FAILED|\bnot ok\s+\d+/i.test(text);
    if (!runner && !strongSummary)
        return null;
    if (!input.isError && !strongSummary && !/\b\d+\s+failed\b/.test(text))
        return null;
    const excerpt = excerptOf(text);
    return {
        command: command.slice(0, 300),
        excerpt,
        signature: createHash('sha256').update(excerpt).digest('hex').slice(0, 12),
        runner: runner ?? '测试',
    };
}
/** Render the kit's verdict as one line for the transcript. */
export function renderTriage(signal, response) {
    const first = response.findings?.[0];
    if (!first)
        return null;
    const values = first.values ?? {};
    const flaky = typeof values.flaky === 'number' ? values.flaky : undefined;
    const reproducible = typeof values.reproducible === 'number' ? values.reproducible : undefined;
    const verdict = flaky !== undefined && reproducible !== undefined
        ? (flaky >= reproducible ? `更像 flaky（flaky ${flaky.toFixed(2)} / 可复现 ${reproducible.toFixed(2)}）` : `更像真回归（可复现 ${reproducible.toFixed(2)} / flaky ${flaky.toFixed(2)}）`)
        : (first.headline ?? '已分流');
    return `⚑ ${signal.runner} 失败分流：${verdict}${first.headline && !first.headline.includes('分流') ? ` · ${first.headline}` : ''}`;
}
//# sourceMappingURL=test-triage.js.map