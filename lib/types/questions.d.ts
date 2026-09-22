/**
 * The questions this instrument asks, kept verbatim next to their provenance.
 *
 * Using the shipped wording of published plugins matters: the numbers this
 * lens produces are only comparable to a real plugin's behaviour if the
 * question is the same question. Changing the wording here silently invalidates
 * the comparison, so each constant names where it came from.
 *
 * The second question is additive on purpose. TypeSafe's own guidance is to ask
 * independent questions over the same state *together* — they run in parallel,
 * so a second judgment costs a few input tokens and no extra latency. It is
 * never allowed to rewrite the calibrated question; it only resolves the middle
 * of the band, where "probably destructive" is not yet a decision.
 *
 * @module dsh-jev-lens/questions
 */
import type { JevQuestion } from './jev.js';
/**
 * `dsh-jev-guard` v0.1 — the zh-CN wording its 0.5/0.7 thresholds were
 * calibrated against (114 labelled cases, 90.4%). Do not translate this: the
 * guard's own measurements show an English phrasing of the same question moves
 * the boundary by ≈0.04 and flips probes toward permissive.
 */
export declare const DESTRUCTIVE_QUESTION: JevQuestion;
/**
 * `dsh-jev-tools` v0.3 — screening wording. It names the *shape* of the thing
 * looked for rather than an attack list, and draws the line at "aimed at an AI",
 * which is what separates an injection from documentation that mentions agents.
 */
export declare const INJECTION_QUESTION: JevQuestion;
/**
 * The second, independent judgment: is the damage recoverable?
 *
 * This is what separates `rm -rf node_modules` from `rm -rf ~/Pictures`, a
 * distinction the destructive question deliberately does not make (it draws the
 * line at "destructive", not at "regrettable"). It exists to de-escalate the
 * revise band without weakening the block band, and it is only *consulted* for
 * a command that landed in revise or block — a read-only command is allowed by
 * the first answer alone, whatever this one says.
 */
export declare const RESTORABLE_QUESTION: JevQuestion;
/** Answer keys, so the ledger and the report agree on names. */
export declare const DESTRUCTIVE_KEY = "q";
export declare const RESTORABLE_KEY = "restorable";
/**
 * The question map for one command.
 *
 * `batched: false` reproduces the original single-question request exactly —
 * which is what keeps the lens's numbers comparable to the plugins it is
 * modelled on, and what makes the batching itself measurable rather than
 * assumed.
 */
export declare function commandQuestions(batched: boolean): Record<string, JevQuestion>;
/** State handed to the destructive question. Kept small: context rot is real. */
export declare function destructiveState(command: string, cwd?: string): Record<string, string>;
/** Band mapping for the destructive question, in the guard's own vocabulary. */
export declare function destructiveBand(p: number, low?: number, high?: number): 'allow' | 'revise' | 'block';
/** The enforcement vocabulary, mirroring the tool layer's own decision types. */
export type GateAction = 'allow' | 'ask' | 'deny';
/** Which bands a gate enforces. `revise` escalates to the human, `block` refuses. */
export interface GatePolicy {
    /** Bands that escalate to a human instead of running. */
    ask: boolean;
    /** Bands that refuse outright. */
    deny: boolean;
    /** Let a recoverable command through the revise band without asking. */
    allowRestorable: boolean;
}
export declare const DEFAULT_GATE_POLICY: GatePolicy;
/**
 * Turn two probabilities into one action.
 *
 * The asymmetry is the whole point: the first answer decides whether the gate
 * cares at all, and only then does recoverability get a vote — and it can only
 * ever *relax* a revise into an allow. A block stays a block unless the command
 * is explicitly recoverable, in which case it is still escalated, never run
 * silently.
 */
export declare function gateAction(band: 'allow' | 'revise' | 'block', restorable: number | undefined, policy?: GatePolicy): GateAction;
/**
 * What the gate should do once the session's approval policy is known.
 *
 * `ask` is only a real option when somebody can be asked. Under an
 * `approval: never` session the harness resolves every ask as *rejected* — and
 * reports it as if the user had declined — so an "ask-only" gate would silently
 * become a hard block with a false reason. When the question cannot be put to a
 * human, the honest behaviour is to let the command through and say so in the
 * ledger; a guard must never manufacture a refusal nobody made.
 *
 * @param band - the destructive band from the first question.
 * @param restorable - the second answer, when asked.
 * @param policy - the configured gate policy.
 * @param approval - the session's approval override, or `undefined` when unknown.
 * @returns the action, plus a degrade reason when the ask could not be delivered.
 */
export declare function resolveGateAction(band: 'allow' | 'revise' | 'block', restorable: number | undefined, policy?: GatePolicy, approval?: 'ask' | 'never' | undefined): {
    action: GateAction;
    degraded?: string;
};
/**
 * The text the model behind the agent reads when the gate refuses or escalates.
 * Advisory in form, and always names which channel decided — a refusal whose
 * provenance is invisible cannot be debugged or trusted.
 */
export declare function gateMessage(action: GateAction, band: string, p: number, restorable: number | undefined, reason?: string): string;
