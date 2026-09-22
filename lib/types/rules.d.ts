/**
 * Local rules: the free tier in front of the paid judgment.
 *
 * Two rules, with deliberately opposite error budgets:
 *
 *   · `locallySafe` may only *skip* the API call for a command that provably
 *     cannot write anything. A false skip costs a real judgment, so the gate is
 *     strict: one simple command, no shell control operators, a read-only verb,
 *     no destructive flag anywhere in the line.
 *   · `matchDestructive` may only *flag* a command whose pattern is
 *     unmistakable (`rm -rf /`, `dd of=/dev/…`, `DROP TABLE`). A false flag
 *     interrupts real work, so anything ambiguous is left to Jev.
 *
 * Everything else returns `null` and costs one request. The rules exist to make
 * the common case free, not to replace the model — the report counts how many
 * calls each path took, so a rule that eats judgments is visible rather than
 * silently authoritative.
 *
 * @module dsh-jev-lens/rules
 */
/** A command that no longer needs a Jev call: it cannot write. */
export interface SafeSkip {
    safe: true;
    reason: string;
}
/** A command whose shape is unmistakable, decided without a request. */
export interface RuleFlag {
    decision: 'block' | 'revise';
    reason: string;
}
/**
 * Decide whether a command can skip the model entirely.
 *
 * Returns `null` for everything that is not provably harmless: a piped command,
 * a multi-line script, an unknown verb, a command that mentions a writing verb.
 */
export declare function locallySafe(raw: string): SafeSkip | null;
/** Flag an unmistakable destructive command. Ambiguity returns `null` on purpose. */
export declare function matchDestructive(raw: string): RuleFlag | null;
/**
 * What the prefilter decided about one command.
 *
 * `judge` means "spend a request": the default, and the only outcome for
 * anything the rules do not recognise.
 */
export type Prefilter = {
    kind: 'skip';
    reason: string;
} | {
    kind: 'flag';
    decision: 'block' | 'revise';
    reason: string;
} | {
    kind: 'judge';
};
/** Rules first, model second. Exported so the ordering is testable on its own. */
export declare function prefilter(raw: string): Prefilter;
