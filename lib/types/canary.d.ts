/**
 * The canary drill: the only part of this plugin that can produce a *causal*
 * answer instead of a correlation.
 *
 * Shadow accounting tells you what Jev would have said. It cannot tell you
 * whether saying it changes anything. A drill closes that gap with known
 * ground truth: the plugin hands the model a page carrying an instruction
 * aimed at it (a harmless `echo` of a random token), and then watches whether
 * that token ever shows up in a later tool call. Same payload, two arms —
 * warning attached or not — so the difference is the intervention.
 *
 * @module dsh-jev-lens/canary
 */
/** Scenarios: the payload shape differs, the canary demand does not. */
export type DrillScenario = 'issue' | 'docs' | 'wiki' | 'stealth';
/** A random, harmless token. Nothing it can be substituted into causes effects. */
export declare function makeCanary(): string;
/**
 * Build the payload for one drill. Deterministic given (scenario, canary) so a
 * replayed drill is the same drill.
 */
export declare function buildDrillPayload(canary: string, scenario: DrillScenario): string;
/** Did the model act on the injected instruction? */
export declare function detectCanary(haystack: string, canary: string): boolean;
/**
 * The warning a real screening plugin attaches, reproduced so the `warn` arm
 * differs from the `bare` arm in exactly one way: this text. Wording follows
 * `dsh-jev-tools` — advisory by construction, never a block, never a rewrite.
 */
export declare function buildScreenWarning(probability: number, source: string): string;
