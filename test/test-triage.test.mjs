/**
 * The detector decides whether anything happens at all, so it is the part worth
 * testing hardest: an observer that fires on ordinary failures becomes noise, and one
 * that misses the real runner becomes decoration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectTestFailure, renderTriage } from '../lib/test-triage.js'

const vitestFail = [
  ' FAIL  src/components/__tests__/EmailSection.test.tsx > EmailSection > shows the validation hint',
  'AssertionError: expected "请输入邮箱" to contain "电子邮箱"',
  '',
  ' Test Files  1 failed | 12 passed (13)',
  '      Tests  2 failed | 47 passed (49)',
].join('\n')

test('a failing test run is detected, with the runner named', () => {
  const signal = detectTestFailure({ name: 'bash', command: 'pnpm vitest run', text: vitestFail, isError: true })
  assert.ok(signal, 'a FAIL block with a failed count must be detected')
  assert.equal(signal.runner, 'vitest')
  assert.match(signal.excerpt, /AssertionError/)
  assert.match(signal.signature, /^[0-9a-f]{12}$/)
})

test('pytest and go output are recognised too', () => {
  const pytest = detectTestFailure({ name: 'bash', command: 'python -m pytest -q', text: 'FAILED tests/test_api.py::test_login - assert 401 == 200\n1 failed, 8 passed', isError: true })
  assert.equal(pytest?.runner, 'pytest')
  const go = detectTestFailure({ name: 'bash', command: 'go test ./...', text: '--- FAIL: TestParse (0.00s)\n    parse_test.go:31: got 2 want 3\nFAIL\ntest result: FAILED', isError: true })
  assert.equal(go?.runner, 'go test')
})

test('ordinary failures are left alone: this observer must be quiet most of the time', () => {
  // A missing command, a network error, a read of a file that happens to contain "FAIL".
  assert.equal(detectTestFailure({ name: 'bash', command: 'cat app.log', text: 'command not found: ripppple\nsome other long noisy output here', isError: true }), null)
  assert.equal(detectTestFailure({ name: 'bash', command: 'git push origin main', text: 'error: failed to push some refs to origin (rejected, non-fast-forward) and more text', isError: true }), null)
  // A non-exec tool is never triaged, even if its content looks like a log.
  assert.equal(detectTestFailure({ name: 'read', command: '', text: vitestFail, isError: false }), null)
  // Too short to judge.
  assert.equal(detectTestFailure({ name: 'bash', command: 'pnpm test', text: 'FAIL x', isError: true }), null)
})

test('a shell grep for FAIL does not qualify without a failure summary', () => {
  const text = 'src/a.ts:12: FAIL something in a comment\nsrc/b.ts:40: FAIL another mention\n(2 matches, long enough to pass the length gate)'
  assert.equal(detectTestFailure({ name: 'bash', command: 'grep -rn FAIL src/', text, isError: false }), null)
})

test('the excerpt keeps the failure block and the summary, not the middle of the log', () => {
  const noise = Array.from({ length: 500 }, (_, index) => `  · passing test ${index}`).join('\n')
  const text = `${noise}\n${vitestFail}\n${noise}`
  const signal = detectTestFailure({ name: 'bash', command: 'npx vitest run', text, isError: true })
  assert.ok(signal)
  assert.ok(signal.excerpt.length <= 4000, 'bounded')
  assert.match(signal.excerpt, /AssertionError/, 'the failure block survives')
  assert.match(signal.excerpt, /Tests {2}2 failed/, 'and so does the summary')
})

test('the rendered line says which way it leans', () => {
  const signal = { command: 'pnpm vitest run', excerpt: 'x', signature: 'abc', runner: 'vitest' }
  const flaky = renderTriage(signal, { findings: [{ level: 'warn', headline: '可能是 flaky', values: { flaky: 0.81, reproducible: 0.22 } }] })
  assert.match(flaky ?? '', /更像 flaky（flaky 0\.81 \/ 可复现 0\.22）/)
  const real = renderTriage(signal, { findings: [{ level: 'flag', headline: '可能是真回归', values: { flaky: 0.13, reproducible: 0.77 } }] })
  assert.match(real ?? '', /更像真回归/)
  assert.equal(renderTriage(signal, { findings: [] }), null, 'no finding, no line')
})
