/**
 * Offline smoke test for the browser half, plus the settings store.
 *
 * A client bundle cannot be checked by importing it: it is not a module, it
 * registers itself with `window.__ModuleLoader__` and it needs a React. So this
 * test *is* the browser: it supplies the two globals the bundle touches, runs
 * `apply` against a stub slots service, and then calls the card component with
 * stub hooks and asserts the thing the whole feature exists for — a password
 * input, a save button, and a mode selector are actually in the tree.
 *
 * No network, no browser, no key.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadStored, saveStored, loadSecret, saveSecret, mergeSettings, validateSettings, LENS_DEFAULTS } from '../lib/settings.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, '..', 'lib', 'client.js')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jev-lens-client-'))

/* ── settings store ──────────────────────────────────────────────────── */

test('settings persist to the plugin directory and corrupt files are ignored', () => {
  const dir = tmp()
  assert.equal(loadStored(dir), undefined)          // absent
  assert.equal(saveStored(dir, LENS_DEFAULTS), true)
  const back = loadStored(dir)
  assert.equal(back.screenTimeoutMs, LENS_DEFAULTS.screenTimeoutMs)
  fs.writeFileSync(path.join(dir, 'config.json'), '{not json')
  assert.equal(loadStored(dir), undefined)          // unreadable is "no opinion", not a crash
})

test('the fallback key store round-trips and is owner-only', () => {
  const dir = tmp()
  assert.equal(loadSecret(dir), '')
  assert.equal(saveSecret(dir, 'sk-test-value'), true)
  assert.equal(loadSecret(dir), 'sk-test-value')
  const mode = fs.statSync(path.join(dir, 'secret.json')).mode & 0o777
  assert.equal(mode, 0o600)
})

test('a patch can only move settings, never break them', () => {
  const merged = mergeSettings(LENS_DEFAULTS, { mode: 'gate', requestTimeoutMs: 3000, nonsense: true, lowThreshold: 'high' })
  assert.equal(merged.mode, 'gate')
  assert.equal(merged.requestTimeoutMs, 3000)
  assert.equal(merged.lowThreshold, LENS_DEFAULTS.lowThreshold) // wrong type ignored
  assert.equal(merged.nonsense, undefined)
  assert.equal(mergeSettings(LENS_DEFAULTS, { mode: 'obliterate' }).mode, LENS_DEFAULTS.mode)
})

test('validation names the field and the range', () => {
  assert.equal(validateSettings(LENS_DEFAULTS), undefined)
  assert.match(String(validateSettings({ ...LENS_DEFAULTS, requestTimeoutMs: 999_999 })), /requestTimeoutMs 必须在 300–60000/)
  assert.match(String(validateSettings({ ...LENS_DEFAULTS, lowThreshold: 0.9, highThreshold: 0.2 })), /不能大于/)
  assert.match(String(validateSettings({ ...LENS_DEFAULTS, apiKeyRef: 'not a ref' })), /apiKeyRef/)
})

/* ── the browser bundle ──────────────────────────────────────────────── */

/** The browser globals the bundle needs, and a React that returns plain trees. */
function bootBundle () {
  const source = fs.readFileSync(bundlePath, 'utf8')
  let loaded
  const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat().filter((c) => c !== null && c !== undefined) })
  const React = {
    createElement: element,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const window = { __ModuleLoader__: { load: (module) => { loaded = module } } }
  // eslint-disable-next-line no-new-func
  new Function('window', 'fetch', source)(window, async () => ({ json: async () => ({}) }))
  assert.ok(loaded !== undefined, 'the bundle must register itself with __ModuleLoader__')
  return { module: loaded, React, window }
}

/** Walk an element tree, collecting every node that matches. */
function find (tree, predicate) {
  const out = []
  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (predicate(node)) out.push(node)
    ;(node.children ?? []).forEach(visit)
    if (node.props !== undefined && node.props.children !== undefined) visit(node.props.children)
  }
  visit(tree)
  return out
}

test('the bundle registers into seats the harness knows, and survives a missing one', () => {
  const { module, React } = bootBundle()
  assert.equal(module.id, '@dsh-external/dsh-jev-lens')
  const plugin = module.factory((name) => (name === 'react' ? React : undefined))
  assert.deepEqual(plugin.inject, ['slots', 'locale'])

  const registered = []
  const ctx = {
    locale: { getLocale: () => ({ active: 'zh-CN' }) },
    slots: {
      inject: (seat, cb) => { cb() },
      register: (options, component) => { registered.push({ seat: options.name, options, component }) },
    },
  }
  plugin.apply(ctx)
  const seats = registered.map((r) => r.seat)
  assert.ok(seats.includes('plugins.bundle.config'), 'the plugin page seat')
  assert.ok(seats.includes('settings.section'), 'the settings seat, where a key box is looked for')
  assert.equal(registered.find((r) => r.seat === 'settings.section').options.id, 'jev-lens')

  // A seat that throws must not take the other one down with it.
  const survived = []
  plugin.apply({
    locale: ctx.locale,
    slots: {
      inject: (seat, cb) => { if (seat === 'plugins.bundle.config') throw new Error('no such seat'); cb() },
      register: (options) => { survived.push(options.name) },
    },
  })
  assert.deepEqual(survived, ['settings.section'])
})

test('the card actually renders the API-key box, the mode selector and the timeouts', () => {
  const { module, React } = bootBundle()
  const plugin = module.factory((name) => (name === 'react' ? React : undefined))
  let card
  plugin.apply({
    locale: { getLocale: () => ({ active: 'zh-CN' }) },
    slots: { inject: (seat, cb) => { cb() }, register: (options, component) => { if (options.name === 'settings.section') card = component } },
  })
  assert.equal(typeof card, 'function')

  // The full view: what a user sees when they open the settings section.
  const tree = card({ view: 'page' })
  const inputs = find(tree, (node) => node.type === 'input')
  const password = inputs.filter((node) => node.props.type === 'password')
  assert.equal(password.length, 1, 'exactly one secret input')
  assert.equal(password[0].props.value, '', 'the input starts blank — a stored key is never echoed')
  assert.equal(password[0].props.autoComplete, 'off')
  assert.equal(inputs.filter((node) => node.props.type === 'number').length, 2, 'two hard-timeout number inputs')

  const selects = find(tree, (node) => node.type === 'select')
  assert.equal(selects.length, 1)
  assert.deepEqual(selects[0].children.map((option) => option.props.value), ['off', 'shadow', 'warn', 'gate'])

  const buttons = find(tree, (node) => node.type === 'button')
  assert.ok(buttons.length >= 3, 'save key, save settings, test')

  // The compact view is a one-liner, not a second card.
  const summary = card({ view: 'summary' })
  assert.equal(typeof summary.type, 'string')
  assert.equal(find(summary, (node) => node.type === 'input').length, 0)
})

test('the card talks to the plugin routes and never to remote services', () => {
  const source = fs.readFileSync(bundlePath, 'utf8')
  assert.ok(source.includes('/dsh-jev-lens/api'), 'the card uses the plugin API')
  assert.ok(source.includes('/report?days='), 'the ledger view reads the report route')
  assert.ok(!/remote\.settings/.test(source), 'no settings-provider dependency')
  assert.ok(!/credentialsApi/.test(source), 'the key is written host-side, not through a client seam')
})

test('the ledger is readable in the page: day range, refresh and a truthful empty state', () => {
  const { module, React } = bootBundle()
  const plugin = module.factory((name) => (name === 'react' ? React : undefined))
  let card
  plugin.apply({
    locale: { getLocale: () => ({ active: 'zh-CN' }) },
    slots: { inject: (seat, cb) => { cb() }, register: (options, component) => { if (options.name === 'settings.section') card = component } },
  })
  const tree = card({ view: 'page' })
  const buttons = find(tree, (node) => node.type === 'button')
  const labels = buttons.map((node) => node.children.join(''))
  for (const range of ['1 天', '7 天', '30 天']) assert.ok(labels.includes(range), `a ${range} range button`)
  assert.ok(labels.includes('刷新'), 'a refresh button')
  assert.ok(labels.includes('复制 Markdown'), 'a copy-report button')

  // With no report yet, the section says so instead of showing zeros that look
  // like measurements.
  const text = JSON.stringify(tree)
  assert.ok(text.includes('还没有账本记录'), 'the empty state is explicit')
  assert.ok(!text.includes('AUC=0'), 'no fabricated AUC before there is data')
})

/* ── the colour rules ────────────────────────────────────────────────── */

/** A report fixture; only the fields the classifier reads are meaningful. */
function fixture (over = {}) {
  const commands = Object.assign({
    n: 60, allow: 55, revise: 5, block: 0, meanP: 0.12,
    withOutcome: 50, errorRate: 0.02, interruptions: 1, interruptionRate: 0.02,
    judged: 60, cached: 0, ruled: 0, skipped: 0,
    latency: { p50: 400, p95: 900, max: 1200, mean: 450 },
    restorable: { known: 60, decisive: 2, conflicts: 0 }, enforced: 0,
  }, over.commands ?? {})
  return Object.assign({
    window: { days: 1, records: 100 },
    commands,
    rank: Object.assign({ errored: 12, ok: 38, meanPErrored: 0.71, meanPOk: 0.08, auc: 0.86 }, over.rank ?? {}),
    screens: Object.assign({ n: 5, flagged: 1, flaggedRate: 0.2, meanP: 0.3, chars: 9000, cached: 0, latency: { p50: 300, p95: 800, max: 900, mean: 320 } }, over.screens ?? {}),
    gates: { allow: 0, ask: 0, deny: 0 },
    health: Object.assign({ degraded: 0, errors: 0 }, over.health ?? {}),
    drills: Object.assign({
      bare: { n: 20, hijacked: 8, rate: 0.4, unfinished: 0 },
      warn: { n: 20, hijacked: 2, rate: 0.1, unfinished: 0 },
    }, over.drills ?? {}),
    trials: over.trials ?? {},
    trialBatch: { id: '', batches: 0 },
    cost: { inputTokens: 40000, usd: 0.0017, savedCalls: 3, savedUsd: 0.0001 },
    errors: 0,
  }, {})
}

test('the colour rules say what is good, what is not, and what is unmeasured', () => {
  const { module, React } = bootBundle()
  const plugin = module.factory((name) => (name === 'react' ? React : undefined))
  const { classifyReport, strings, TONE } = plugin.__internals
  const zh = strings.zh
  const levelOf = (verdict, label) => (verdict.rows.find((row) => row.label === label) ?? {}).level

  // Healthy: orders outcomes, few false positives.
  const good = classifyReport(fixture(), zh, { rejected: false })
  assert.equal(good.overall.level, 'ok')
  assert.equal(levelOf(good, zh.lblHurt), 'ok')
  assert.equal(levelOf(good, zh.lblRank), 'ok')
  assert.equal(levelOf(good, zh.lblCanary), 'ok')

  // False positives past the point where a gate is worth it.
  const costly = classifyReport(fixture({ commands: { interruptionRate: 0.3, interruptions: 15 } }), zh, { rejected: false })
  assert.equal(costly.overall.level, 'bad')
  assert.equal(levelOf(costly, zh.lblHurt), 'bad')

  // A score that points the wrong way is worse than no score.
  const inverted = classifyReport(fixture({ rank: { auc: 0.31 } }), zh, { rejected: false })
  assert.equal(levelOf(inverted, zh.lblRank), 'bad')

  // Not enough paired outcomes is its own answer — never a green light.
  const thin = classifyReport(fixture({ commands: { withOutcome: 3 } }), zh, { rejected: false })
  assert.equal(thin.overall.level, 'unknown')
  assert.equal(levelOf(thin, zh.lblHurt), 'unknown')
  assert.match(thin.overall.text, /样本不足/)
  assert.equal(TONE.unknown, 'inherit')

  // Failures with zero successful judgments: the one thing it must never hide.
  const blind = classifyReport(fixture({ commands: { judged: 0, n: 0, withOutcome: 0 }, health: { errors: 210, degraded: 2 } }), zh, { rejected: false })
  assert.equal(blind.overall.level, 'bad')
  assert.match(blind.overall.text, /不可用/)

  // A refused credential outranks every other reading.
  const noKey = classifyReport(fixture({ commands: { judged: 0 } }), zh, { rejected: true })
  assert.equal(noKey.overall.level, 'bad')
  assert.match(noKey.overall.text, /key 被拒/)

  // And an unsized canary arm is not evidence of anything.
  const unsized = classifyReport(fixture({ drills: { bare: { n: 4, hijacked: 4, rate: 1, unfinished: 0 }, warn: { n: 4, hijacked: 0, rate: 0, unfinished: 0 } } }), zh, { rejected: false })
  assert.equal(levelOf(unsized, zh.lblCanary), 'unknown')

  // Every row carries a level the renderer knows how to colour.
  for (const level of [...good.rows, ...thin.rows].map((row) => row.level)) {
    assert.ok(Object.prototype.hasOwnProperty.call(TONE, level), `unknown tone ${level}`)
  }
})
