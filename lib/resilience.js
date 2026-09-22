/**
 * Two pieces of machinery that keep a third-party classifier from becoming a
 * third-party outage.
 *
 *   · {@link createBreaker} — after `failures` consecutive failures the circuit
 *     opens and every call fails over instantly for `cooldownMs`. Without it, a
 *     down endpoint costs the *full* timeout on every single call: a screen that
 *     awaits on the critical path would add `timeout × calls` seconds to a turn.
 *   · {@link createLimiter} — a bounded number of in-flight requests. Judging
 *     every bash call fire-and-forget means a burst of twenty calls would
 *     otherwise open twenty sockets and invite a 429 storm, and a 429 storm is
 *     how a "free" instrument starts adding latency to the thing it measures.
 *
 * `now` is injectable in both so the behaviour is testable without sleeping.
 *
 * @module dsh-jev-lens/resilience
 */
/**
 * Consecutive-failure breaker with a cooldown. A single probe is allowed through
 * after the cooldown (half-open); its outcome decides whether the next window
 * opens again.
 */
export function createBreaker(options) {
    const now = options.now ?? Date.now;
    let failures = 0;
    /*
     * `null`, not `0`: an injectable clock legitimately starts at zero, and using
     * zero as the "never opened" sentinel makes that breaker permanently closed.
     * (Found by the offline test, which drives the clock from 0.)
     */
    let openedAt = null;
    let probing = false;
    const state = { open: false, failures: 0, opens: 0, shortCircuits: 0 };
    return {
        isOpen() {
            if (openedAt === null)
                return false;
            if (now() - openedAt < options.cooldownMs) {
                state.open = true;
                state.shortCircuits++;
                return true;
            }
            // Cooldown elapsed: let exactly one call through to test the water.
            if (probing) {
                state.shortCircuits++;
                return true;
            }
            probing = true;
            state.open = false;
            return false;
        },
        ok() {
            failures = 0;
            openedAt = null;
            probing = false;
            state.open = false;
            state.failures = 0;
        },
        fail() {
            failures++;
            probing = false;
            state.failures = failures;
            if (failures >= options.failures) {
                openedAt = now();
                state.open = true;
                state.opens++;
            }
        },
        state,
    };
}
/** FIFO semaphore: `max` tasks in flight, the rest wait their turn. */
export function createLimiter(max) {
    let active = 0;
    const waiters = [];
    return {
        async run(task) {
            if (active >= max)
                await new Promise(resolve => waiters.push(resolve));
            active++;
            try {
                return await task();
            }
            finally {
                active--;
                const next = waiters.shift();
                if (next)
                    next();
            }
        },
        get active() { return active; },
        get queued() { return waiters.length; },
    };
}
/** p50/p95/max in one pass — the numbers a latency claim needs. */
export function percentiles(values) {
    if (!values.length)
        return { p50: 0, p95: 0, max: 0, mean: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
        p50: Math.round(at(0.5)),
        p95: Math.round(at(0.95)),
        max: Math.round(sorted[sorted.length - 1] ?? 0),
        mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    };
}
//# sourceMappingURL=resilience.js.map