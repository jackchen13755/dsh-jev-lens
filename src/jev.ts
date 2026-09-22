/**
 * Jev transport for the lens: one endpoint, pinned model, bounded retries,
 * and a redaction pass that runs before anything leaves the machine.
 *
 * Deliberately dependency-free: the plugin talks to the documented HTTP
 * contract rather than pulling in an SDK (the trial must not add supply chain
 * to a measurement instrument).
 *
 * Two policies here were changed after measuring what a bad day costs:
 *
 *   · **A non-retryable status is not retried.** A 401 (revoked key) or a 400
 *     (malformed state) cannot succeed on the second attempt; retrying it three
 *     times only delays fail-open by `timeout × attempts` on a call that is
 *     already on the critical path.
 *   · **Every call carries its own timeout and attempt budget.** A fire-and-forget
 *     judgment can afford 20 s; a screen that the turn is waiting on cannot. The
 *     caller decides, because only the caller knows whether anyone is waiting.
 *
 * @module dsh-jev-lens/jev
 */

/** The three primitives. A question is exactly one of these. */
export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: Record<string, string> }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

/** One typed answer as the API returns it. */
export interface JevAnswer {
  type: string
  noul?: number
  choice?: string
  score?: number
  confidence?: number
  probabilities?: Record<string, number>
}

export interface JevUsage {
  input_tokens?: number
  output_tokens?: number
}

export interface JevResult {
  answers: Record<string, JevAnswer>
  model: string
  usage?: JevUsage
  /** Wall-clock of the request that succeeded, including retries. */
  ms: number
  /** 1 on the first try; >1 when a retryable failure was survived. */
  attempts: number
}

export interface JevModel {
  name?: string
  description?: string
  release_date?: string
}

export interface JevOptions {
  endpoint: string
  model: string
  apiKey: string
  timeoutMs: number
  maxRetries: number
}

/** Per-call overrides. A caller that is blocking a turn passes a small budget. */
export interface AskOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
}

/** HTTP statuses worth a second attempt: throttling and server-side faults. */
export function isRetryableStatus (status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 529 || status >= 500
}

/**
 * Strip the shapes that must not reach a third party. This is a mitigation and
 * not a permission: an unrecognised secret in free text still passes through.
 *
 * The built-in set covers only shapes that are universal — home directories,
 * e-mail addresses, and the token formats every provider uses. Anything
 * organisation-specific (an intranet domain, an internal host suffix) belongs in
 * `redactExtra`, because a published default that names one company's domains
 * leaks that company in exchange for protecting it. Compile the extras once with
 * {@link compileExtraPatterns}; an invalid pattern is dropped, never thrown.
 */
export function redact (text: string, extra: readonly RegExp[] = []): string {
  let out = String(text)
    .replace(/\/Users\/[A-Za-z0-9._-]+/g, '~')
    .replace(/\/home\/[A-Za-z0-9._-]+/g, '~')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>')
    .replace(/ghp_[A-Za-z0-9]+/g, '<GITHUB_TOKEN>')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '<GITHUB_TOKEN>')
    .replace(/apikey_[A-Za-z0-9_]+/g, '<API_KEY>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '<API_KEY>')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '<JWT>')
    .replace(/(x-access-token:)[^@"\s]+/g, '$1<TOKEN>')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1<TOKEN>')
    // Private address space, by RFC: those hosts are never public, so naming
    // them cannot leak anything a public reader did not already know.
    .replace(/\b(?:[a-z0-9-]+\.)+(?:internal|intranet|corp|lan|local)\b/gi, '<internal-host>')
  for (const pattern of extra) out = out.replace(pattern, '<redacted>')
  return out
}

/** Build the caller's patterns once. A bad regex is skipped, not fatal. */
export function compileExtraPatterns (sources: readonly string[] = []): RegExp[] {
  const out: RegExp[] = []
  for (const source of sources) {
    if (typeof source !== 'string' || !source.trim()) continue
    try { out.push(new RegExp(source, 'gi')) } catch { /* an unusable pattern must not break dispatch */ }
  }
  return out
}

/** Normalize an abort reason into something a log line can carry. */
export function combineSignals (a?: AbortSignal, b?: AbortSignal): AbortSignal {
  if (a && b) return AbortSignal.any([a, b])
  return a ?? b ?? new AbortController().signal
}

export interface JevStats {
  calls: number
  failures: number
  inputTokens: number
  /** Total wall-clock spent inside `ask`, including failed attempts. */
  spentMs: number
}

export interface Jev {
  ask (state: unknown, questions: Record<string, JevQuestion>, options?: AskOptions): Promise<JevResult>
  /** Live model list — the only endpoint that can prove a key still works. */
  models (options?: { timeoutMs?: number }): Promise<{ models: JevModel[] }>
  /** Requests that actually left the process, for the report. */
  readonly stats: JevStats
}

/** An error carrying the status, so callers can tell auth from outage. */
export class JevError extends Error {
  constructor (message: string, readonly status: number, readonly retryable: boolean) {
    super(message)
    this.name = 'JevError'
  }
}

/** Build a transport. Every failure is the caller's to interpret; nothing is retried forever. */
export function createJev (options: JevOptions): Jev {
  const stats: JevStats = { calls: 0, failures: 0, inputTokens: 0, spentMs: 0 }

  async function ask (state: unknown, questions: Record<string, JevQuestion>, overrides: AskOptions = {}): Promise<JevResult> {
    const body = JSON.stringify({ model: options.model, state, questions })
    const timeoutMs = overrides.timeoutMs ?? options.timeoutMs
    const maxRetries = overrides.maxRetries ?? options.maxRetries
    const started = Date.now()
    let lastError = 'unknown'

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs)
      try {
        stats.calls++
        const response = await fetch(options.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body,
          signal: combineSignals(overrides.signal, timeout),
        })
        if (!response.ok) {
          stats.failures++
          const retryable = isRetryableStatus(response.status)
          const detail = (await response.text().catch(() => '')).slice(0, 200)
          const error = new JevError(`Jev ${response.status} ${detail}`, response.status, retryable)
          // A caller-visible failure that cannot succeed on retry ends here.
          if (!retryable) { stats.spentMs += Date.now() - started; throw error }
          lastError = error.message
          const retryAfter = Number(response.headers.get('retry-after'))
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt
          if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, Math.min(backoff, 5000)))
          continue
        }
        const parsed = await response.json() as { answers?: Record<string, JevAnswer>; model?: string; usage?: JevUsage }
        if (!parsed.answers || typeof parsed.answers !== 'object') {
          stats.failures++
          throw new JevError('Jev response carried no answers', 200, false)
        }
        stats.inputTokens += parsed.usage?.input_tokens ?? 0
        stats.spentMs += Date.now() - started
        return {
          answers: parsed.answers,
          model: parsed.model ?? options.model,
          usage: parsed.usage,
          ms: Date.now() - started,
          attempts: attempt + 1,
        }
      } catch (error) {
        if (error instanceof JevError && !error.retryable) throw error
        // A cancelled turn is not a Jev failure: stop immediately and let the
        // caller see the abort rather than sleeping through its retries.
        if (overrides.signal?.aborted) { stats.spentMs += Date.now() - started; throw error }
        lastError = error instanceof Error ? error.message : String(error)
        stats.failures++
        if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt))
      }
    }
    stats.spentMs += Date.now() - started
    throw new JevError(`Jev unavailable: ${lastError}`, 0, true)
  }

  async function models (overrides: { timeoutMs?: number } = {}): Promise<{ models: JevModel[] }> {
    const response = await fetch(`${options.endpoint.replace(/\/v1\/systemone\/?$/, '')}/v1/models`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(overrides.timeoutMs ?? 5000),
    })
    if (!response.ok) throw new JevError(`Jev ${response.status} on /v1/models`, response.status, isRetryableStatus(response.status))
    const parsed = await response.json() as { models?: JevModel[] } | JevModel[]
    return { models: Array.isArray(parsed) ? parsed : parsed.models ?? [] }
  }

  return { ask, models, stats }
}
