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
export interface BreakerState {
    open: boolean;
    /** Consecutive failures since the last success. */
    failures: number;
    /** How many times the circuit has opened, for the report. */
    opens: number;
    /** Calls that were skipped because the circuit was open. */
    shortCircuits: number;
}
export interface Breaker {
    /** True when calls should be skipped right now. */
    isOpen(): boolean;
    ok(): void;
    fail(): void;
    readonly state: BreakerState;
}
/**
 * Consecutive-failure breaker with a cooldown. A single probe is allowed through
 * after the cooldown (half-open); its outcome decides whether the next window
 * opens again.
 */
export declare function createBreaker(options: {
    failures: number;
    cooldownMs: number;
    now?: () => number;
}): Breaker;
export interface Limiter {
    run<T>(task: () => Promise<T>): Promise<T>;
    readonly active: number;
    readonly queued: number;
}
/** FIFO semaphore: `max` tasks in flight, the rest wait their turn. */
export declare function createLimiter(max: number): Limiter;
/** p50/p95/max in one pass — the numbers a latency claim needs. */
export declare function percentiles(values: number[]): {
    p50: number;
    p95: number;
    max: number;
    mean: number;
};
