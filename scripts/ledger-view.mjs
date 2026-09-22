#!/usr/bin/env node
/**
 * Read the Jev lens ledger from a terminal.
 *
 * Read-only, offline, no dependencies. It exists because the aggregate numbers a
 * report shows and the raw rows behind them are two different questions: the
 * report answers "is this worth keeping", and this answers "what actually
 * happened on that one command".
 *
 * Usage:
 *   node scripts/ledger-view.mjs               # today, all sections
 *   node scripts/ledger-view.mjs 7             # last 7 daily files
 *   node scripts/ledger-view.mjs 7 skip        # one section
 *   node scripts/ledger-view.mjs 1 raw 5       # 5 raw rows per record kind
 *
 * Sections: overview judge rank screen drill batch cost skip raw
 *
 * Nothing here writes, and nothing here sends: the ledger holds no command text
 * (only a redacted 200-character preview) and no page bodies, so a dump is safe
 * to paste into a report.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const days = Number(args[0]) > 0 ? Math.min(90, Number(args[0])) : 1
const section = args[1] && !/^\d+$/.test(args[1]) ? args[1] : 'all'
const rawCount = Number(args[2] ?? (section === 'raw' ? args[1] : 3)) || 3
const dir = path.join(os.homedir(), '.dsh', 'storages', 'dsh_jev_lens')

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((name) => /^ledger-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().slice(-days)
  : []
if (!files.length) {
  console.log(`没有账本文件：${dir}`)
  console.log('（账本由插件在宿主进程里写；今天没有 bash 调用被判定时不会创建文件。）')
  process.exit(0)
}

const rows = []
for (const name of files) {
  for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* a torn line is not a finding */ }
  }
}
rows.sort((a, b) => a.t - b.t)

const want = (name) => section === 'all' || section === name
const kinds = {}
for (const row of rows) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1
const pct = (num, den) => (den ? `${((num / den) * 100).toFixed(1)}%` : '—')
const quantile = (xs, q) => {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const line = (title) => console.log(`\n=== ${title} ===`)

/** Outcomes by `session:callId` — the join key the report uses too. */
const outcomes = new Map()
for (const row of rows) if (row.kind === 'command-outcome') outcomes.set(`${row.session}:${row.callId}`, row.isError)
const judged = rows.filter((r) => r.kind === 'command')
const paired = judged.filter((r) => outcomes.has(`${r.session}:${r.callId}`))

line(`概览 · ${files.join(', ')} · ${rows.length} 条记录`)
console.log('按类型:', JSON.stringify(kinds))
const via = {}
for (const row of rows) if (row.via) via[row.via] = (via[row.via] ?? 0) + 1
if (Object.keys(via).length) console.log('判定来源:', JSON.stringify(via), '（jev=花了请求，cache=命中缓存）')
const sessions = new Set(rows.map((r) => r.session).filter((s) => s && s !== 'planted'))
console.log(`会话数: ${sessions.size}（账本是全局的，不是单会话的）`)

if (want('judge')) {
  line('A. 危险命令判定（shadow 口径，不含被 gate 拦下的记录）')
  const bands = { allow: 0, revise: 0, block: 0 }
  for (const row of judged) bands[row.band]++
  console.log(`判定 ${judged.length} 条 · allow=${bands.allow} revise=${bands.revise} block=${bands.block} · mean p=${mean(judged.map((r) => r.p)).toFixed(3)}`)
  const shadow = paired.filter((r) => r.decision === undefined)
  const bad = shadow.filter((r) => r.band !== 'allow' && outcomes.get(`${r.session}:${r.callId}`) === false)
  const errored = shadow.filter((r) => outcomes.get(`${r.session}:${r.callId}`) === true)
  console.log(`有结果对照 ${paired.length} 条（其中 shadow ${shadow.length}）· 实际报错 ${errored.length} = ${pct(errored.length, shadow.length)}`)
  console.log(`⚠️ 误伤: 判 revise/block 但实际成功 ${bad.length} = ${pct(bad.length, shadow.length)}`)
  for (const row of bad.slice(0, 5)) console.log(`   p=${row.p.toFixed(2)} ${row.band.padEnd(6)} ${row.preview ?? ''}`)
  const ms = judged.map((r) => r.ms).filter((x) => typeof x === 'number' && x > 0)
  if (ms.length) console.log(`判定耗时(不挡本轮): p50 ${quantile(ms, 0.5)}ms · p95 ${quantile(ms, 0.95)}ms · max ${Math.max(...ms)}ms`)
  const free = { cached: judged.filter((r) => r.via === 'cache').length, ruled: kinds['command-rule'] ?? 0, skipped: kinds['command-skip'] ?? 0 }
  console.log(`免费路径: 缓存 ${free.cached} · 本地规则直判 ${free.ruled} · 本地规则跳过 ${free.skipped}`)
}

if (want('rank')) {
  line('排序能力：p 到底能不能区分「会出错」和「不会出错」')
  const errored = paired.filter((r) => outcomes.get(`${r.session}:${r.callId}`) === true)
  const fine = paired.filter((r) => outcomes.get(`${r.session}:${r.callId}`) === false)
  console.log(`报错组 n=${errored.length} mean p=${mean(errored.map((r) => r.p)).toFixed(3)} · 成功组 n=${fine.length} mean p=${mean(fine.map((r) => r.p)).toFixed(3)}`)
  if (errored.length && fine.length) {
    // Rank-based separation (AUC): P(a random errored command scores above a random successful one).
    let wins = 0
    for (const a of errored) for (const b of fine) wins += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0
    const auc = wins / (errored.length * fine.length)
    console.log(`AUC=${auc.toFixed(3)} — 0.5=瞎猜，>0.7 才有排序价值，<0.5 说明方向相反`)
    console.log('（n<30 时这个数不稳定；它衡量的是排序，不是概率标定。）')
  } else {
    console.log('两组里至少一组为空，暂时算不出 AUC。')
  }
  const warn = '注意：报错率本身受任务难度影响 —— 越危险的命令越容易出错，这会让 AUC 偏乐观。'
  console.log(warn)
}

if (want('screen')) {
  line('B. 注入筛查（唯一会让一轮等待的通道）')
  const screens = rows.filter((r) => r.kind === 'screen')
  const flagged = screens.filter((r) => r.flagged)
  console.log(`筛查 ${screens.length} 次 · 命中阈值 ${flagged.length} = ${pct(flagged.length, screens.length)} · mean p=${mean(screens.map((r) => r.p)).toFixed(3)}`)
  const ms = screens.map((r) => r.ms).filter((x) => typeof x === 'number' && x > 0)
  if (ms.length) console.log(`等待耗时: p50 ${quantile(ms, 0.5)}ms · p95 ${quantile(ms, 0.95)}ms（预算是 1200ms，超时会记 degraded:screen-timeout）`)
  for (const row of flagged.slice(-5)) console.log(`   p=${row.p.toFixed(2)} ${String(row.tool).padEnd(12)} ${row.chars} 字符`)
}

if (want('drill')) {
  line('C. 金丝雀 A/B（唯一有真值的通道）')
  const starts = rows.filter((r) => r.kind === 'drill-start')
  const ends = new Map(rows.filter((r) => r.kind === 'drill-end').map((r) => [r.drillId, r]))
  for (const arm of ['bare', 'warn']) {
    const own = starts.filter((r) => r.arm === arm)
    const settled = own.filter((r) => ends.has(r.drillId))
    const hijacked = settled.filter((r) => ends.get(r.drillId).hijacked === true)
    console.log(`${arm.padEnd(5)} 投放 ${own.length} · 结算 ${settled.length} · 被劫持 ${hijacked.length} = ${pct(hijacked.length, settled.length)}${own.length - settled.length ? ` · 未结算 ${own.length - settled.length}` : ''}`)
  }
  const b = starts.filter((r) => r.arm === 'bare')
  const w = starts.filter((r) => r.arm === 'warn')
  if (b.length && w.length) console.log('每组 <20 次时，任何差值都只是噪声，不是结论。')
}

if (want('batch')) {
  line('D. 批量对照（最新一批）')
  const trials = rows.filter((r) => r.kind === 'trial')
  const latest = trials.length ? trials[trials.length - 1].batch : ''
  const own = trials.filter((r) => r.batch === latest)
  if (!own.length) console.log('还没有跑过 jev_lens_run / /jev-lens run。')
  for (const arm of ['bare', 'harness', 'warn']) {
    const group = own.filter((r) => r.arm === arm)
    if (!group.length) continue
    console.log(`${arm.padEnd(8)} n=${group.length} 执行率 ${pct(group.filter((r) => r.acted).length, group.length)} 识别率 ${pct(group.filter((r) => r.flagged).length, group.length)}`)
  }
  if (own.length) console.log('warn 与 harness 的差 = Jev 的边际贡献；两者接近就等于「警告是装饰」。')
}

if (want('cost')) {
  line('成本 / 免费路径 / 降级')
  const tokens = rows.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0)
  const cached = rows.filter((r) => r.via === 'cache').length
  console.log(`input tokens ${tokens} ≈ $${((tokens * 0.042) / 1e6).toFixed(6)} · 命中缓存 ${cached} 次`)
  const degraded = rows.filter((r) => r.kind === 'degraded')
  console.log(`降级 ${degraded.length} 次` + (degraded.length ? `（原因：${[...new Set(degraded.map((r) => r.reason))].join(', ')}）` : ''))
  const errors = rows.filter((r) => r.kind === 'error')
  console.log(`判定失败 ${errors.length} 条 —— 失败永远不记成 p=0，所以比例不会虚高，但样本会变少`)
}

if (want('skip')) {
  line('为什么没判定（读比例之前先看这里）')
  const skips = rows.filter((r) => r.kind === 'command-skip')
  const rules = rows.filter((r) => r.kind === 'command-rule')
  const byReason = {}
  for (const row of skips) byReason[row.reason] = (byReason[row.reason] ?? 0) + 1
  for (const row of rules) byReason[`rule:${row.decision}:${row.reason}`] = (byReason[`rule:${row.decision}:${row.reason}`] ?? 0) + 1
  const degraded = rows.filter((r) => r.kind === 'degraded')
  for (const row of degraded) byReason[row.reason] = (byReason[row.reason] ?? 0) + 1
  const entries = Object.entries(byReason).sort((a, b) => b[1] - a[1])
  if (!entries.length) console.log('无 —— 所有调用都走到了真实判定。')
  for (const [reason, n] of entries.slice(0, 15)) console.log(`${String(n).padStart(5)} × ${reason}`)
  console.log('（auth:rejected-* = key 失效静默；degraded:breaker-open = 熔断；budget:* = 到上限）')
}

if (want('raw')) {
  line(`原始记录样本（每类 ${rawCount} 条）`)
  for (const kind of Object.keys(kinds).sort()) {
    console.log(`\n--- ${kind} (${kinds[kind]}) ---`)
    for (const row of rows.filter((r) => r.kind === kind).slice(0, rawCount)) {
      console.log(JSON.stringify(row).slice(0, 220))
    }
  }
  console.log('\n字段说明见 dsh-jev-lens/README.md；正文不在账本里，preview 是脱敏后的前 200 字符。')
}
