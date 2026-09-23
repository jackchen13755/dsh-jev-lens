/**
 * The screening prefilter: a 0-cost rules pass in front of the paid judgment.
 *
 * Why it exists: screening a fetched page costs ~1.2 s on the critical path (a
 * measured 9.4 KB page), and most fetched pages are ordinary documentation. A rules
 * pass that runs in microseconds can decide "nothing instruction-shaped here" and
 * skip the request entirely — while a page that *does* look like an instruction
 * still goes to the model, because rules cannot judge intent.
 *
 * An honest limitation, found while trying to do this properly: the 27 screening
 * records in the ledger carry **no text** (metadata only), so they cannot be
 * replayed against a new filter. The backtest below therefore runs on a labelled
 * corpus in `test/screen-filter.test.mjs`, and every future screen records its
 * feature vector (names only, never content) so the next tuning is data-driven.
 *
 * Design rules:
 *   · **Feature groups, not raw hits.** Matching one group is enough to escalate;
 *     counting occurrences would let a verbose document outrank a terse attack.
 *   · **Every feature must earn its place.** The test reports per-feature catch and
 *     false-positive counts, so a rule that never fires on either class shows up as
 *     dead weight instead of hiding inside an aggregate score.
 *   · **A drill is never filtered.** The canary payloads exist to measure the
 *     screening channel itself; a prefilter that skipped them would silently make
 *     the experiment vacuous.
 *
 * @module dsh-jev-lens/screen-filter
 */
/** One named tell, with the verdict it contributes. */
export interface ScreenFeature {
    name: string;
    /** Why this pattern is suspicious, for a human reading the ledger. */
    why: string;
}
/** Every tell this filter knows, for the report and the tests. */
export declare const SCREEN_FEATURES: {
    name: string;
    why: string;
}[];
export interface ScreenVerdict {
    /** Distinct feature groups matched — the filter's whole opinion. */
    score: number;
    features: ScreenFeature[];
    /** True when the page should be handed to the model. */
    suspicious: boolean;
}
/**
 * Score a page's text for instruction-shaped content.
 *
 * @param text - the fetched page text (already capped by `maxScreenChars`).
 * @returns the matched features and whether screening should proceed.
 */
export declare function scoreScreen(text: string): ScreenVerdict;
/** A short, log-safe label for the ledger: feature names only, never content. */
export declare const featureLabel: (verdict: ScreenVerdict) => string;
