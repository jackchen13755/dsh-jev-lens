/**
 * Offline tests for the machinery added in v0.1: the local rules, the memo, the
 * breaker and limiter, the gate mapping, and the ledger's new honesty fields.
 *
 * Same rule as the other suite: no network, no key, no DSH host. Every number a
 * report claims must be reproducible from these tests without spending a cent.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { locallySafe, matchDestructive, prefilter } from '../lib/rules.js'
import { createCache, keyOf } from '../lib/cache.js'
import { createBreaker, createLimiter, percentiles } from '../lib/resilience.js'
import { isRetryableStatus, redact } from '../lib/jev.js'
import { commandQuestions, destructiveBand, gateAction, gateMessage, RESTORABLE_QUESTION, DESTRUCTIVE_KEY, RESTORABLE_KEY } from '../lib/questions.js'
import { append, load, render, summarize } from '../lib/ledger.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jev-lens-h-'))

/* ── local rules: the free tier ──────────────────────────────────────── */

test('the skip rule only skips what provably cannot write', () => {
  for (const safe of ['ls -la', 'pwd', 'cat package.json', 'git status --short', 'git log --oneline -5', 'wc -l src/index.ts', 'rg -n TODO src', 'node -v']) {
    assert.ok(locallySafe(safe), `${safe} should be skippable`)
  }
  for (const unsafe of [
    'ls && rm -rf /tmp/x',        // chained: the second command is the point
    'cat a > b',                  // redirection writes
    'find . -name "*.ts" -delete', // find that deletes
    'sed -i s/a/b/ file',          // in-place edit
    'git push origin main',        // modifies the remote
    'git stash drop',              // discards work
    'npm install left-pad',        // writes and executes
    'python3 -c "open(1)"',        // executes code
    'rm -rf ~/x',                  // obviously not read-only
    '',                            // nothing to judge
  ]) {
    assert.equal(locallySafe(unsafe), null, `${unsafe} must go to Jev`)
  }
})

test('the flag rule fires only on unmistakable destruction', () => {
  assert.equal(matchDestructive('rm -rf /')?.decision, 'block')
  assert.equal(matchDestructive('rm -rf ~')?.decision, 'block')
  assert.equal(matchDestructive('dd if=/dev/zero of=/dev/disk2 bs=1m')?.decision, 'block')
  assert.equal(matchDestructive('sqlite3 mem.db "DROP TABLE memories;"')?.decision, 'block')
  assert.equal(matchDestructive('git push --force origin main')?.decision, 'revise')
  assert.equal(matchDestructive('git reset --hard HEAD~3')?.decision, 'revise')
  // ambiguity is Jev's job, not the regex's
  assert.equal(matchDestructive('rm -rf ~/Desktop/dsh/github/dsh-jev-lens/lib'), null)
  assert.equal(matchDestructive('git push origin main'), null)
  assert.equal(matchDestructive('ls -la'), null)
})

test('destruction beats the skip list when both could match', () => {
  assert.equal(prefilter('rm -rf /').kind, 'flag')
  assert.equal(prefilter('ls -la').kind, 'skip')
  assert.equal(prefilter('mv src lib').kind, 'judge')
})

/* ── memo ────────────────────────────────────────────────────────────── */

test('the memo expires entries and evicts least-recently-used', () => {
  let clock = 0
  const cache = createCache(2, 100, () => clock)
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.get('a'), 1)
  cache.set('c', 3) // 'b' is now the least recently used
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  clock = 1000
  assert.equal(cache.get('a'), undefined) // TTL, not just LRU
  assert.equal(cache.stats.hits, 2)
  assert.equal(cache.stats.evictions, 1)
})

test('the cache key hashes the state instead of storing it', () => {
  const secret = 'rm -rf ~/Desktop/work/private-thing'
  const key = keyOf(['q', secret])
  assert.equal(key.length, 32)
  assert.ok(!key.includes('private-thing'))
  assert.equal(key, keyOf(['q', secret]))
  assert.notEqual(key, keyOf(['q', `${secret} `]))
})

/* ── breaker + limiter ───────────────────────────────────────────────── */

test('the breaker opens after consecutive failures and probes once after cooldown', () => {
  let clock = 0
  const breaker = createBreaker({ failures: 3, cooldownMs: 1000, now: () => clock })
  assert.equal(breaker.isOpen(), false)
  breaker.fail(); breaker.fail()
  assert.equal(breaker.isOpen(), false)
  breaker.fail()
  assert.equal(breaker.isOpen(), true)   // open: calls are skipped instantly
  assert.equal(breaker.state.opens, 1)
  clock = 1500
  assert.equal(breaker.isOpen(), false)  // exactly one probe is allowed
  assert.equal(breaker.isOpen(), true)   // …and only one
  breaker.ok()
  assert.equal(breaker.isOpen(), false)
  assert.equal(breaker.state.failures, 0)
})

test('the limiter caps concurrency and releases queued work', async () => {
  const limiter = createLimiter(2)
  let peak = 0
  const task = async () => {
    peak = Math.max(peak, limiter.active)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)))
  assert.equal(peak, 2)
  assert.equal(limiter.active, 0)
  assert.equal(limiter.queued, 0)
})

test('percentiles report p50/p95/max without dropping the tail', () => {
  assert.deepEqual(percentiles([10, 20, 30, 40, 1000]), { p50: 30, p95: 1000, max: 1000, mean: 220 })
  assert.deepEqual(percentiles([]), { p50: 0, p95: 0, max: 0, mean: 0 })
})

/* ── transport policy ────────────────────────────────────────────────── */

test('a rejected key is not retried, a throttle is', () => {
  assert.equal(isRetryableStatus(401), false)
  assert.equal(isRetryableStatus(403), false)
  assert.equal(isRetryableStatus(400), false)
  assert.equal(isRetryableStatus(422), false)
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(500), true)
  assert.equal(isRetryableStatus(529), true)
})

test('redaction covers the shapes that actually leak', () => {
  const dirty = 'curl -H "authorization: Bearer sk-live-abcdefghijkl" -d "password=hunter2" https://x.example.internal/a?m=dev@example.com'
  const clean = redact(dirty)
  assert.ok(!clean.includes('sk-live-abcdefghijkl'))
  assert.ok(!clean.includes('dev@example.com'))
  assert.ok(!clean.includes('x.example.internal'))
})

/* ── the gate mapping ────────────────────────────────────────────────── */

test('the second question can only relax a revise, never a block', () => {
  /*
   * Polarity is pinned to the question's own wording: it asks "could the data be
   * restored?", so a HIGH noul is the recoverable answer and the only one that
   * may relax a band. Getting this backwards interrupts harmless work *and*
   * waves through the unrecoverable command, so it is tested explicitly.
   */
  assert.match(RESTORABLE_QUESTION.instructions, /could the data it affects be restored/i)
  assert.match(String(RESTORABLE_QUESTION.criteria?.true), /reproducible or backed up/)
  // allow is decided by the first answer alone
  assert.equal(gateAction('allow', 0.99), 'allow')
  assert.equal(gateAction('allow', 0.01), 'allow')
  assert.equal(gateAction('allow', undefined), 'allow')
  // revise + recoverable costs nothing; revise + unrecoverable asks a human
  assert.equal(gateAction('revise', 0.9), 'allow')
  assert.equal(gateAction('revise', 0.1), 'ask')
  assert.equal(gateAction('revise', undefined), 'ask')
  // block stays a block unless recoverable, and even then it escalates
  assert.equal(gateAction('block', 0.1), 'deny')
  assert.equal(gateAction('block', 0.9), 'ask')
  assert.equal(gateAction('block', undefined), 'deny')
  // policy can switch a gate off without touching the band
  assert.equal(gateAction('block', 0.1, { ask: true, deny: false, allowRestorable: true }), 'ask')
  // Ask-only: even an unrecoverable block escalates rather than refusing.
  assert.equal(gateAction('block', 0.1, { ask: true, deny: false, allowRestorable: true }), 'ask')
  assert.equal(gateAction('revise', 0.1, { ask: false, deny: true, allowRestorable: true }), 'allow')
})

test('a refusal names its provenance and never reads as a silent no-op', () => {
  const deny = gateMessage('deny', 'block', 0.91, 0.8)
  assert.match(deny, /拦截/)
  assert.match(deny, /0\.91/)
  const rule = gateMessage('deny', 'block', 0, undefined, 'rm on the filesystem root')
  assert.match(rule, /本地规则/)
  const ask = gateMessage('ask', 'revise', 0.6, 0.9)
  assert.match(ask, /升级给用户/)
  assert.ok(!/已拦截/.test(ask))
})

test('the two modes of asking stay separate', () => {
  assert.deepEqual(Object.keys(commandQuestions(false)), [DESTRUCTIVE_KEY])
  assert.deepEqual(Object.keys(commandQuestions(true)), [DESTRUCTIVE_KEY, RESTORABLE_KEY])
})

/* ── the ledger's new honesty fields ─────────────────────────────────── */

test('skipped and degraded calls are recorded, never silently dropped', () => {
  const dir = tmp()
  const now = Date.now()
  append(dir, { t: now, kind: 'command-skip', session: 's1', callId: 'c1', reason: 'read-only ls' })
  append(dir, { t: now + 1, kind: 'command-rule', session: 's1', callId: 'c2', decision: 'block', reason: 'rm on the filesystem root', preview: 'rm -rf /', decision_taken: 'deny' })
  append(dir, { t: now + 2, kind: 'degraded', where: 'command', reason: 'degraded:breaker-open' })
  const report = summarize(load(dir, 1, new Date(now)), 1)
  assert.equal(report.commands.n, 0)          // nothing was judged…
  assert.equal(report.commands.skipped, 1)    // …and the report says so
  assert.equal(report.commands.ruled, 1)
  assert.equal(report.health.degraded, 1)
  assert.equal(report.gates.deny, 1)
  assert.equal(report.cost.savedCalls, 2)
  const text = render(report)
  assert.match(text, /本地规则跳过 1/)
  assert.match(text, /熔断\/预算/)
})

test('enforced rows are excluded from the shadow false-positive rate', () => {
  const dir = tmp()
  const now = Date.now()
  // shadow: judged revise, ran fine → a real false positive
  append(dir, { t: now, kind: 'command', session: 's1', callId: 's1', p: 0.6, band: 'revise', preview: 'a', model: 'm', inputTokens: 10 })
  append(dir, { t: now + 1, kind: 'command-outcome', session: 's1', callId: 's1', isError: false })
  // gated: judged block, never ran because the gate refused it → not evidence of anything
  append(dir, { t: now + 2, kind: 'command', session: 's1', callId: 's2', p: 0.95, band: 'block', preview: 'b', model: 'm', inputTokens: 10, decision: 'deny' })
  append(dir, { t: now + 3, kind: 'command-outcome', session: 's1', callId: 's2', isError: false })
  const report = summarize(load(dir, 1, new Date(now)), 1)
  assert.equal(report.commands.n, 2)
  assert.equal(report.commands.enforced, 1)
  assert.equal(report.commands.interruptions, 1)      // only the shadow row
  assert.equal(report.commands.interruptionRate, 1)   // 1/1 shadow rows with an outcome
})

test('latency, cache and the second question all reach the report', () => {
  const dir = tmp()
  const now = Date.now()
  append(dir, { t: now, kind: 'command', session: 's1', callId: 'c1', p: 0.2, band: 'allow', preview: 'ls', model: 'm', inputTokens: 400, ms: 480, attempts: 1, via: 'jev', restorable: 0.05 })
  append(dir, { t: now + 1, kind: 'command', session: 's1', callId: 'c2', p: 0.2, band: 'allow', preview: 'ls', model: 'm', inputTokens: 0, via: 'cache', restorable: 0.05 })
  // restorable 0.8 = "the data can be recovered", the answer that relaxes a block
  append(dir, { t: now + 2, kind: 'command', session: 's1', callId: 'c3', p: 0.8, band: 'block', preview: 'x', model: 'm', inputTokens: 400, ms: 900, attempts: 2, via: 'jev', restorable: 0.8 })
  append(dir, { t: now + 3, kind: 'screen', session: 's1', callId: 'c4', tool: 'fetch_page', p: 0.9, flagged: true, chars: 4000, model: 'm', inputTokens: 900, ms: 700, attempts: 1, via: 'jev', redacted: true })
  const report = summarize(load(dir, 1, new Date(now)), 1)
  assert.equal(report.commands.judged, 2)
  assert.equal(report.commands.cached, 1)
  // Nearest-rank: with two samples the upper one is p50, which keeps the
  // reported latency on the pessimistic side rather than interpolating it away.
  assert.equal(report.commands.latency.p50, 900)
  assert.equal(report.commands.restorable.known, 3)
  assert.equal(report.commands.restorable.decisive, 1) // the block that is recoverable
  assert.equal(report.commands.restorable.conflicts, 1)
  assert.equal(report.screens.latency.p50, 700)
  const text = render(report)
  assert.match(text, /第二问（可恢复性）覆盖 3\/3/)
  assert.match(text, /这是唯一挡在路上的通道/)
  assert.match(text, /排序信号/)
})

test('an unreadable answer is not recorded as a clean page', () => {
  // A transport failure surfaces as an error record; nothing is written to
  // `screen`, so a broken link cannot look like "nothing suspicious found".
  const dir = tmp()
  append(dir, { t: Date.now(), kind: 'error', where: 'screen', message: 'Jev unavailable: fetch failed' })
  const report = summarize(load(dir, 1), 1)
  assert.equal(report.screens.n, 0)
  assert.equal(report.health.errors, 1)
})

test('rank separation answers "is p ordering anything at all"', () => {
  const now = Date.now()
  const build = (pairs) => {
    const dir = tmp()
    pairs.forEach(([p, isError], i) => {
      append(dir, { t: now + i * 2, kind: 'command', session: 's', callId: `c${i}`, p, band: destructiveBand(p), preview: 'x', model: 'm', inputTokens: 1 })
      append(dir, { t: now + i * 2 + 1, kind: 'command-outcome', session: 's', callId: `c${i}`, isError })
    })
    return summarize(load(dir, 1, new Date(now)), 1)
  }

  // A perfectly separating score: every failure scored above every success.
  const good = build([[0.9, true], [0.8, true], [0.2, false], [0.1, false]]).rank
  assert.equal(good.auc, 1)
  assert.equal(good.errored, 2)
  assert.equal(good.ok, 2)

  // An inverted score is worse than useless, and must read as such — not as "0 failures".
  assert.equal(build([[0.1, true], [0.2, true], [0.8, false], [0.9, false]]).rank.auc, 0)

  // One empty group is not an AUC of 0.5 — it is no answer, and says so.
  const thin = build([[0.3, false]])
  assert.equal(thin.rank.auc, null)
  assert.match(render(thin), /样本不足/)
})
