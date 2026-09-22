/**
 * dsh-jev-lens browser half: the plugin's own configuration card.
 *
 * Hand-written lazy-CJS bundle (`window.__ModuleLoader__.load`), no build step and
 * no imports beyond React — deliberately, because the npm-published
 * `@deepseek-ai/dsh-*` packages lag the running harness, and requiring one would
 * couple this card to a stale signature.
 *
 * It renders into `plugins.bundle.config` (the plugin's own page) and into its
 * own `settings.section`, because a person handed an API key goes looking for the
 * box in Settings.
 *
 * The card exists because of one failure it removes: before it, a wrong or
 * revoked key could only be fixed by editing a patch file and restarting the
 * harness, and until then every judgment paid a timeout. It talks to four routes
 * the host half owns:
 *
 *   GET  /dsh-jev-lens/api/status   what the plugin is doing right now
 *   POST /dsh-jev-lens/api/config   mode / toggles / hard timeouts
 *   POST /dsh-jev-lens/api/key      the one secret, written host-side
 *   POST /dsh-jev-lens/api/test     one real, bounded round trip
 *
 * The key is never returned by any of them: status carries a fingerprint and a
 * source, and the input starts blank on every load.
 *
 * @module dsh-jev-lens/client
 */

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-jev-lens',
  factory: (require) => {
    /** Host API prefix owned by the host half. */
    const API = '/dsh-jev-lens/api'
    /** Where a user creates a TypeSafe API key. */
    const KEYS_URL = 'https://console.typesafe.ai/keys'
    /** Every mode the host accepts, in menu order. */
    const MODES = ['off', 'shadow', 'warn', 'gate']

    const S = {
      zh: {
        heading: 'Jev 质量实验台（危险命令判定 / 注入筛查 / 金丝雀 A-B）',
        status: '状态',
        reading: '读取中…',
        configured: (source) => `已配置（来源：${source}）`,
        unconfigured: '未配置——所有判定与筛查都会跳过，不会卡住任何一轮',
        intro: '还没有 API key。到 TypeSafe 控制台创建一个，然后粘贴到下面。',
        getKey: '获取 API key →',
        keyPlaceholder: '粘贴 API key（保存后下一次判定即生效）',
        keyPlaceholderSet: '已配置；粘贴新值可覆盖',
        saveKey: '保存 key',
        clearKey: '清除',
        saved: '已保存，下一次判定即生效。',
        saveFailed: (error) => `保存失败：${error}`,
        fetchFailed: (error) => `无法连接插件接口：${error}`,
        mode: '模式',
        modeHelp: 'shadow=只记账不干预；warn=抓取内容加注入提醒；gate=危险命令升级/拦截；off=完全停用。',
        judge: '判定 shell 命令（pre-execute）',
        batched: '追加第二问「可恢复性」（同一次请求，几乎不加延迟）',
        timeouts: '超时（毫秒，硬上限）',
        requestTimeout: '单次请求',
        screenTimeout: '抓取筛查',
        saveConfig: '保存设置',
        savedConfig: '设置已保存。',
        test: '测试连接',
        testing: '测试中…',
        testOk: (ms, band, q) => `✓ ${ms}ms · 探针判定 band=${band} (q=${q}) — 链路正常`,
        testFail: (error) => `✗ ${error}`,
        authBanner: (status, secs) => `⛔ key 被拒（HTTP ${status}）：${secs}s 内所有判定直接跳过（fail-open，不阻塞任何一轮）。换 key 或点「测试连接」重试。`,
        breakerOpen: '熔断器已打开：连续失败后暂停调用，冷却后自动试探一次。',
        reasons: '最近的跳过/降级原因',
        ledger: '账本',
        days: (n) => `${n} 天`,
        refresh: '刷新',
        copy: '复制 Markdown',
        copied: '已复制报告。',
        noLedger: '还没有账本记录：今天没有 bash 调用被判定，或插件刚装好。',
        rowJudge: (n, allow, revise, block, p) => `判定 ${n} · allow ${allow} / revise ${revise} / block ${block} · mean p=${p}`,
        rowHurt: (bad, rate, paired) => `误伤 ${bad} = ${rate}（有结果对照 ${paired}）`,
        rowRank: (auc, pe, ne, po, no) => `排序能力 AUC=${auc}（0.5=瞎猜，>0.7 才算能排序）· 报错组 p=${pe}(n=${ne}) vs 成功组 ${po}(n=${no})`,
        rowRankThin: (ne, no) => `排序能力：样本不足（报错 ${ne} / 成功 ${no}，两组各 ≥10 才算得出来）`,
        rowScreen: (n, hit, rate, p50, p95) => `页面筛查 ${n} 次 · 命中 ${hit} (${rate}) · 等待 p50 ${p50}ms / p95 ${p95}ms（预算 1200ms）`,
        rowCanary: (bare, bn, warn, wn) => `金丝雀  bare ${bare}/${bn} 被劫持 · warn ${warn}/${wn}`,
        rowBatch: (arms) => `批量对照 ${arms}`,
        rowCost: (usd, cached, ruled, skipped, degraded, errors) => `成本 $${usd} · 免费路径 缓存${cached}/规则${ruled}/跳过${skipped} · 降级 ${degraded} · 失败 ${errors}`,
        lblJudge: '判定',
        lblHurt: '误伤',
        lblRank: '排序能力',
        lblScreen: '页面筛查',
        lblCanary: '金丝雀',
        lblBatch: '批量对照',
        lblCost: '成本/健康',
        verdictOk: '结论：判定有排序能力、误伤可接受 —— 可继续 shadow，再考虑 gate',
        verdictWarn: '结论：能用，但有黄色项要留意（先别开 gate）',
        verdictBad: '结论：不建议开 gate（误伤或排序能力不达标）',
        verdictThin: '结论：样本不足 —— 先让它跑一天（有结果对照 ≥10 才谈得上结论）',
        verdictNoData: '结论：还没有判定数据',
        verdictBlind: '结论：仪器当前不可用 —— 有失败记录且没有一条成功判定（查 key / 网络）',
        verdictNoKey: '结论：key 被拒，所有判定已跳过（fail-open，不影响 agent 干活）',
        privacy: '隐私：开启后，被判定的命令文本与抓取到的网页内容会发送到 api.typesafe.ai；发送前做脱敏'
          + '（家目录、邮箱、token、内网域名），密钥保存在本机且不会回显。台账只记元数据（概率、耗时、token 数、'
          + '跳过原因），不含命令或网页正文。',
        summary: (keyState, mode) => `Jev 实验台 · ${keyState} · ${mode}`,
      },
      en: {
        heading: 'Jev quality bench (dangerous-command judging / injection screening / canary A-B)',
        status: 'Status',
        reading: 'reading…',
        configured: (source) => `configured (source: ${source})`,
        unconfigured: 'not configured — every judgment and screen is skipped, nothing stalls',
        intro: 'No API key yet. Create one in the TypeSafe console, then paste it below.',
        getKey: 'Get an API key →',
        keyPlaceholder: 'paste the API key (effective on the next judgment)',
        keyPlaceholderSet: 'configured — paste a new value to replace it',
        saveKey: 'Save key',
        clearKey: 'Clear',
        saved: 'Saved; effective on the next judgment.',
        saveFailed: (error) => `Save failed: ${error}`,
        fetchFailed: (error) => `Cannot reach the plugin API: ${error}`,
        mode: 'Mode',
        modeHelp: 'shadow = record only; warn = attach an injection notice; gate = escalate/block dangerous commands; off = disabled.',
        judge: 'Judge shell commands (pre-execute)',
        batched: 'Ask the second (recoverability) question in the same request',
        timeouts: 'Timeouts (ms, hard ceilings)',
        requestTimeout: 'Per request',
        screenTimeout: 'Per screen',
        saveConfig: 'Save settings',
        savedConfig: 'Settings saved.',
        test: 'Test connection',
        testing: 'testing…',
        testOk: (ms, band, q) => `✓ ${ms}ms · probe band=${band} (q=${q}) — link is healthy`,
        testFail: (error) => `✗ ${error}`,
        authBanner: (status, secs) => `⛔ key rejected (HTTP ${status}): every judgment is skipped for ${secs}s (fail-open, nothing blocks). Paste a new key or press Test.`,
        breakerOpen: 'Breaker open: calls are paused after consecutive failures and one probe is allowed after the cooldown.',
        reasons: 'Recent skip / degrade reasons',
        ledger: 'Ledger',
        days: (n) => `${n}d`,
        refresh: 'Refresh',
        copy: 'Copy Markdown',
        copied: 'Report copied.',
        noLedger: 'No ledger rows yet: nothing has been judged today, or the plugin was just installed.',
        rowJudge: (n, allow, revise, block, p) => `judged ${n} · allow ${allow} / revise ${revise} / block ${block} · mean p=${p}`,
        rowHurt: (bad, rate, paired) => `false positives ${bad} = ${rate} (paired with an outcome: ${paired})`,
        rowRank: (auc, pe, ne, po, no) => `rank separation AUC=${auc} (0.5 = noise, >0.7 = usable) · failed p=${pe}(n=${ne}) vs worked ${po}(n=${no})`,
        rowRankThin: (ne, no) => `rank separation: not enough data (failed ${ne} / worked ${no}; ≥10 in each group)`,
        rowScreen: (n, hit, rate, p50, p95) => `screened ${n} · flagged ${hit} (${rate}) · wait p50 ${p50}ms / p95 ${p95}ms (budget 1200ms)`,
        rowCanary: (bare, bn, warn, wn) => `canary  bare ${bare}/${bn} hijacked · warn ${warn}/${wn}`,
        rowBatch: (arms) => `batch probe ${arms}`,
        rowCost: (usd, cached, ruled, skipped, degraded, errors) => `cost $${usd} · free paths cache ${cached}/rules ${ruled}/skips ${skipped} · degraded ${degraded} · failures ${errors}`,
        lblJudge: 'judged',
        lblHurt: 'false positives',
        lblRank: 'rank separation',
        lblScreen: 'screening',
        lblCanary: 'canary',
        lblBatch: 'batch probe',
        lblCost: 'cost / health',
        verdictOk: 'Verdict: the score orders outcomes and false positives are acceptable — stay in shadow, then consider gate',
        verdictWarn: 'Verdict: usable, but the amber rows need attention (do not enable gate yet)',
        verdictBad: 'Verdict: do not enable gate — false positives or ordering are not good enough',
        verdictThin: 'Verdict: not enough data — let it run a day (≥10 paired outcomes before any conclusion)',
        verdictNoData: 'Verdict: no judgments yet',
        verdictBlind: 'Verdict: the instrument is currently blind — failures with zero successful judgments (check key / network)',
        verdictNoKey: 'Verdict: the key is rejected, every judgment is skipped (fail-open; the agent keeps working)',
        privacy: 'Privacy: once enabled, judged command text and fetched page content go to api.typesafe.ai; '
          + 'home paths, emails, tokens and intranet hosts are redacted first, and the key stays on this machine '
          + 'without ever being echoed back. The ledger records metadata only (probabilities, latency, token counts, '
          + 'skip reasons) — never command or page bodies.',
        summary: (keyState, mode) => `Jev bench · ${keyState} · ${mode}`,
      },
    }

    /** The active language, from the client locale service. */
    function langOf (ctx) {
      try {
        const locale = ctx.locale
        if (locale === undefined || typeof locale.getLocale !== 'function') return 'en'
        const snapshot = locale.getLocale()
        const active = snapshot !== null && snapshot !== undefined ? snapshot.active : undefined
        return typeof active === 'string' && active.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    /** One JSON round trip against the host half. Throws with the host's message. */
    async function api (route, init) {
      const response = await fetch(API + route, Object.assign({ headers: { 'content-type': 'application/json' } }, init))
      const body = await response.json().catch(() => ({}))
      if (body !== null && body !== undefined && body.ok === false && body.error !== undefined) throw new Error(String(body.error))
      return body
    }

    /** A password field that browsers and password managers leave alone. */
    function maskedProps () {
      return {
        type: 'password',
        autoComplete: 'off',
        autoCorrect: 'off',
        autoCapitalize: 'off',
        spellCheck: false,
        'data-1p-ignore': 'true',
        'data-lpignore': 'true',
      }
    }

    const field = { fontSize: '12px', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit' }
    const muted = { fontSize: '11px', opacity: 0.7, lineHeight: '16px' }
    const label = { fontSize: '12px', opacity: 0.85 }
    const divider = { display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px', borderTop: '1px solid rgba(128,128,128,0.25)' }
    const stack = { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' }
    const inlineRow = { display: 'flex', gap: '8px', alignItems: 'center' }
    const labelled = { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' }
    const wrapRow = { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }

    /**
     * Four verdict colours, chosen to stay legible on a light and a dark theme.
     * `unknown` is deliberately *not* a colour of its own: an unmeasured thing
     * must not look like a measured one, so it inherits the surrounding text and
     * is dimmed instead.
     */
    const TONE = { ok: '#3fb950', warn: '#d29922', bad: '#f85149', unknown: 'inherit' }
    const toneStyle = (level) => (level === 'unknown'
      ? { color: 'inherit', opacity: 0.65 }
      : { color: TONE[level] ?? 'inherit' })

    /**
     * Turn a report into coloured verdicts.
     *
     * The thresholds are the whole point of the card, so they are written down
     * once, here, and unit-tested: a metric is only judged when it has the
     * sample to be judged on, and "not enough data" is its own answer rather
     * than a green light.
     *
     * @param {object} report - the aggregate from `GET /api/report`.
     * @param {object} t - the active language's strings.
     * @param {{rejected: boolean}} key - whether the credential is currently refused.
     * @returns {{overall: {level: string, text: string}, rows: Array<{level: string, label: string, text: string}>}}
     */
    function classifyReport (report, t, key) {
      const c = report.commands
      const r = report.rank
      const rows = []

      // Judging anything at all.
      rows.push({ level: c.n === 0 ? 'unknown' : 'ok', label: t.lblJudge, text: t.rowJudge(c.n, c.allow, c.revise, c.block, c.meanP) })

      // False positives: only meaningful with enough paired outcomes. Thresholds
      // are a policy, not a measurement — 5% is where a gate stops being worth
      // the interruptions, 15% is where it becomes the problem instead.
      const hurtLevel = c.withOutcome < 10 ? 'unknown' : c.interruptionRate < 0.05 ? 'ok' : c.interruptionRate < 0.15 ? 'warn' : 'bad'
      rows.push({ level: hurtLevel, label: t.lblHurt, text: t.rowHurt(c.interruptions, (c.interruptionRate * 100).toFixed(1) + '%', c.withOutcome) })

      // Ordering: 0.5 is noise, and anything below it means the score points the
      // wrong way — which is worse than no score at all.
      const rankLevel = r.auc === null ? 'unknown' : r.auc >= 0.7 ? 'ok' : r.auc >= 0.6 ? 'warn' : 'bad'
      rows.push({
        level: rankLevel,
        label: t.lblRank,
        text: r.auc === null ? t.rowRankThin(r.errored, r.ok) : t.rowRank(r.auc, r.meanPErrored, r.errored, r.meanPOk, r.ok),
      })

      // Screening is informational — a flagged rate is not good or bad on its
      // own. Only the wait is a judgement: past its budget the channel is
      // costing turns rather than saving them.
      rows.push({
        level: report.screens.n === 0 ? 'unknown' : report.screens.latency.p95 > 1200 ? 'warn' : 'ok',
        label: t.lblScreen,
        text: t.rowScreen(report.screens.n, report.screens.flagged, (report.screens.flaggedRate * 100).toFixed(1) + '%', report.screens.latency.p50, report.screens.latency.p95),
      })

      // The only causal channel: it needs both arms, sized, before it says anything.
      const bare = report.drills.bare
      const warnArm = report.drills.warn
      const canaryLevel = bare.n < 10 || warnArm.n < 10
        ? 'unknown'
        : warnArm.rate < bare.rate ? 'ok' : warnArm.rate === bare.rate ? 'warn' : 'bad'
      rows.push({ level: canaryLevel, label: t.lblCanary, text: t.rowCanary(bare.hijacked, bare.n, warnArm.hijacked, warnArm.n) })

      // The batch probe's marginal effect: warn must beat harness, or the
      // warning is decoration and the harness prompt was doing the work.
      const trials = Object.entries(report.trials)
      if (trials.length) {
        const arms = trials.map(([name, v]) => `${name} ${(v.rate * 100).toFixed(0)}%`).join(' · ')
        const sized = trials.every(([, v]) => v.n >= 10)
        const harness = report.trials.harness
        const warnTrial = report.trials.warn
        const batchLevel = !sized || harness === undefined || warnTrial === undefined
          ? 'unknown'
          : warnTrial.rate < harness.rate ? 'ok' : warnTrial.rate === harness.rate ? 'warn' : 'bad'
        rows.push({ level: batchLevel, label: t.lblBatch, text: t.rowBatch(arms) })
      }

      // Health: a failure that still fails open is a warning, not an outage —
      // but failures with *zero* successful judgments means nothing is being
      // measured, which is the one thing this instrument must never hide.
      const blind = c.judged === 0 && report.health.errors > 0
      rows.push({
        level: blind ? 'bad' : report.health.degraded + report.health.errors === 0 ? 'ok' : 'warn',
        label: t.lblCost,
        text: t.rowCost(report.cost.usd, c.cached, c.ruled, c.skipped, report.health.degraded, report.health.errors),
      })

      let overall
      if (key !== null && key.rejected === true) overall = { level: 'bad', text: t.verdictNoKey }
      else if (blind) overall = { level: 'bad', text: t.verdictBlind }
      else if (c.n === 0) overall = { level: 'unknown', text: t.verdictNoData }
      else if (c.withOutcome < 10) overall = { level: 'unknown', text: t.verdictThin }
      else {
        const levels = [hurtLevel, rankLevel]
        const worst = levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : 'ok'
        overall = { level: worst, text: worst === 'bad' ? t.verdictBad : worst === 'warn' ? t.verdictWarn : t.verdictOk }
      }
      return { overall, rows }
    }

    /**
     * Build the card component bound to one client context.
     *
     * @param {object} React - the browser module table's React.
     * @param {object} ctx - the client plugin context.
     * @returns {Function} the card component.
     */
    function makeCard (React, ctx) {
      const h = React.createElement

      /** One label/value row. */
      const row = (name, value) => h('div', { style: inlineRow }, h('span', { style: { opacity: 0.7, minWidth: '56px' } }, name), h('span', null, value))

      /** A checkbox row. */
      const toggle = (text, on, disabled, onToggle) => h('label', { style: Object.assign({ opacity: disabled === true ? 0.5 : 1 }, labelled) },
        h('input', { type: 'checkbox', checked: on === true, disabled: disabled === true, onChange: (event) => { onToggle(event.target.checked) } }),
        h('span', null, text))

      /** A labelled number input. */
      const numberField = (text, value, min, max, disabled, onChange) => h('label', { style: labelled }, text,
        h('input', {
          type: 'number', min, max, step: 100,
          value: value === undefined || value === null || Number.isNaN(value) ? '' : String(value),
          disabled,
          onChange,
          style: Object.assign({ width: '90px' }, field),
        }))

      /** A plain button. */
      const button = (text, disabled, onClick) => h('button', {
        type: 'button',
        disabled,
        onClick,
        style: Object.assign({ cursor: disabled === true ? 'default' : 'pointer' }, field),
      }, text)

      return function JevLensCard (props) {
        const view = props !== null && props !== undefined ? props.view : undefined
        const [lang, setLang] = React.useState(() => langOf(ctx))
        const [status, setStatus] = React.useState(null)
        const [draftKey, setDraftKey] = React.useState('')
        const [draft, setDraft] = React.useState(null)
        const [note, setNote] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [testing, setTesting] = React.useState(false)
        const [report, setReport] = React.useState(null)
        const [days, setDays] = React.useState(7)
        const t = S[lang]

        // Follow the DSH language: re-render whenever the locale changes.
        React.useEffect(() => {
          const locale = ctx.locale
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(() => { setLang(langOf(ctx)) })
        }, [])

        /** Pull the host's view. A failure becomes a visible note, never a blank card. */
        const refresh = React.useCallback(async () => {
          try {
            const next = await api('/status')
            setStatus(next)
            setDraft(next.settings)
            setNote('')
          } catch (error) {
            setNote(S[langOf(ctx)].fetchFailed(String(error)))
          }
        }, [])

        React.useEffect(() => {
          void refresh()
          // This card is the only place the cooldown and the breaker are visible,
          // so it polls — cheaply, on this machine, never in the plugin's path.
          const timer = setInterval(() => { void refresh() }, 5000)
          return () => { clearInterval(timer) }
        }, [refresh])

        /** Run one write and fold the returned status back in. */
        const write = React.useCallback(async (route, payload, okNote) => {
          setBusy(true)
          const strings = S[langOf(ctx)]
          try {
            const result = await api(route, { method: 'POST', body: JSON.stringify(payload) })
            if (result.status !== undefined) { setStatus(result.status); setDraft(result.status.settings) }
            setNote(okNote)
          } catch (error) {
            setNote(strings.saveFailed(String(error)))
          } finally {
            setBusy(false)
          }
        }, [])

        const runTest = React.useCallback(async () => {
          setTesting(true)
          const strings = S[langOf(ctx)]
          try {
            const result = await api('/test', { method: 'POST', body: '{}' })
            if (result.status !== undefined) { setStatus(result.status); setDraft(result.status.settings) }
            setNote(result.ok === true
              ? strings.testOk(result.ms, result.band, typeof result.q === 'number' ? result.q.toFixed(2) : '—')
              : strings.testFail(String(result.error)))
          } catch (error) {
            setNote(strings.testFail(String(error)))
          } finally {
            setTesting(false)
          }
        }, [])

        // The ledger view. Days are switchable because the two questions this
        // answers have different horizons: "is it working right now" is today,
        // "is it worth keeping" is a month.
        const loadReport = React.useCallback(async (want) => {
          try {
            const result = await api('/report?days=' + String(want))
            setReport(result.report ?? null)
            setDays(want)
          } catch (error) {
            setNote(S[langOf(ctx)].fetchFailed(String(error)))
          }
        }, [])

        React.useEffect(() => { void loadReport(7) }, [loadReport])

        const copyReport = React.useCallback(async () => {
          try {
            const result = await api('/report?days=' + String(days))
            await navigator.clipboard.writeText(String(result.markdown ?? ''))
            setNote(S[langOf(ctx)].copied)
          } catch (error) {
            setNote(S[langOf(ctx)].saveFailed(String(error)))
          }
        }, [days])

        const configured = status !== null && status.key !== undefined && status.key.configured === true
        const mode = status !== null && status.settings !== undefined ? status.settings.mode : 'shadow'
        const keyState = status === null ? t.reading : configured ? t.configured(status.key.source) : t.unconfigured

        if (view === 'summary') {
          return h('div', { style: muted }, t.summary(keyState, mode))
        }

        const settings = status !== null && status.settings !== undefined ? status.settings : null
        const auth = status !== null && status.auth !== undefined ? status.auth : null
        const health = status !== null && status.health !== undefined ? status.health : null
        const disabled = busy || status === null
        const secondsLeft = auth === null || auth.rejected !== true ? 0 : Math.max(0, Math.round((auth.cooldownMs - (Date.now() - auth.at)) / 1000))
        const reasons = status !== null && Array.isArray(status.reasons) ? status.reasons : []

        const header = h('div', { style: { fontSize: '13px', fontWeight: 600 } }, t.heading)
        const authBanner = auth !== null && auth.rejected === true
          ? h('div', { style: { fontSize: '12px', color: '#d33' } }, t.authBanner(auth.status, secondsLeft))
          : null
        const breakerBanner = health !== null && health.breakerOpen === true
          ? h('div', { style: { fontSize: '12px', opacity: 0.8 } }, t.breakerOpen)
          : null
        const intro = configured ? null : h('div', { style: muted }, t.intro)
        const keyLink = h('div', { style: { fontSize: '12px' } }, h('a', { href: KEYS_URL, target: '_blank', rel: 'noreferrer' }, t.getKey))

        // The input box itself: blank on every load, never echoed back.
        const keyInput = h('input', Object.assign({
          value: draftKey,
          placeholder: configured ? t.keyPlaceholderSet : t.keyPlaceholder,
          disabled: busy,
          onChange: (event) => { setDraftKey(event.target.value) },
          style: Object.assign({ flex: 1, minWidth: 0 }, field),
        }, maskedProps()))
        const saveKey = button(t.saveKey, busy || draftKey === '', () => {
          void write('/key', { value: draftKey }, t.saved).then(() => { setDraftKey('') })
        })
        const clearKey = button(t.clearKey, busy || !configured, () => { void write('/key/clear', {}, t.saved) })
        const keyRow = h('div', { style: inlineRow }, keyInput, saveKey, clearKey)

        const modeSelect = h('select', {
          value: mode,
          disabled,
          onChange: (event) => { void write('/config', { mode: event.target.value }, t.savedConfig) },
          style: Object.assign({ width: '160px' }, field),
        }, MODES.map((name) => h('option', { key: name, value: name }, name)))
        const modeGroup = h('div', { style: divider },
          h('div', { style: label }, t.mode),
          modeSelect,
          h('div', { style: muted }, t.modeHelp),
          toggle(t.judge, settings !== null && settings.judgeCommands === true, disabled, (next) => { void write('/config', { judgeCommands: next }, t.savedConfig) }),
          toggle(t.batched, settings !== null && settings.batchedQuestions === true, disabled, (next) => { void write('/config', { batchedQuestions: next }, t.savedConfig) }))

        // The knobs that answer "don't hang on a dead key".
        const onDraft = (field_, raw) => {
          const next = Object.assign({}, draft)
          next[field_] = Number(raw)
          setDraft(next)
        }
        const saveTimeouts = button(t.saveConfig, disabled, () => {
          void write('/config', {
            requestTimeoutMs: Number(draft.requestTimeoutMs),
            screenTimeoutMs: Number(draft.screenTimeoutMs),
          }, t.savedConfig)
        })
        const testButton = button(testing ? t.testing : t.test, testing || busy, () => { void runTest() })
        const timeoutGroup = h('div', { style: divider },
          h('div', { style: label }, t.timeouts),
          h('div', { style: wrapRow },
            numberField(t.requestTimeout, draft === null ? undefined : draft.requestTimeoutMs, 300, 60000, disabled, (event) => { onDraft('requestTimeoutMs', event.target.value) }),
            numberField(t.screenTimeout, draft === null ? undefined : draft.screenTimeoutMs, 200, 30000, disabled, (event) => { onDraft('screenTimeoutMs', event.target.value) }),
            saveTimeouts,
            testButton))

        const reasonLine = reasons.length > 0
          ? h('div', { style: muted }, t.reasons + '：' + reasons.map((entry) => entry[0] + '×' + entry[1]).join(' · '))
          : null
        const privacy = h('div', { style: muted }, t.privacy)
        const noteLine = note === '' ? null : h('div', { style: muted }, note)

        // ── the ledger, read without leaving the page ──────────────────────
        const dayButton = (n) => h('button', {
          key: n,
          type: 'button',
          disabled: busy,
          onClick: () => { void loadReport(n) },
          style: Object.assign({ opacity: days === n ? 1 : 0.6, cursor: 'pointer' }, field),
        }, t.days(n))
        const verdict = report === null ? null : classifyReport(report, t, auth)
        const reportRows = report === null
          ? [h('div', { style: muted }, t.noLedger)]
          : [
            // The one-line answer first, in colour: everything below it is the
            // evidence for this sentence.
            h('div', { style: Object.assign({ fontSize: '12px', fontWeight: 600 }, toneStyle(verdict.overall.level)) }, '● ' + verdict.overall.text),
            ...verdict.rows.map((entry, index) => h('div', { key: index, style: Object.assign({ fontSize: '11px', lineHeight: '16px' }, toneStyle(entry.level)) },
              h('span', { style: { fontWeight: 600 } }, entry.label + ' '),
              h('span', null, entry.text))),
          ]
        const reportGroup = h('div', { style: divider },
          h('div', { style: inlineRow },
            h('span', { style: label }, t.ledger),
            [1, 7, 30].map(dayButton),
            button(t.refresh, busy, () => { void loadReport(days) }),
            button(t.copy, false, () => { void copyReport() })),
          ...reportRows)

        return h('div', { style: stack },
          header,
          row(t.status, keyState),
          authBanner,
          breakerBanner,
          intro,
          keyLink,
          keyRow,
          modeGroup,
          timeoutGroup,
          reportGroup,
          reasonLine,
          privacy,
          noteLine)
      }
    }

    return {
      // `remote` is not needed: the card talks to the plugin's own routes, which
      // keeps its dependency surface to React plus `fetch`.
      inject: ['slots', 'locale'],
      /**
       * Exposed for the offline smoke test: the colour rules are the part of this
       * card that can be wrong without looking wrong, so they are a pure
       * function that a test can call directly.
       */
      __internals: { classifyReport, TONE, strings: S },
      /**
       * Mount the card in the two seats that make sense for it.
       *
       * @param {object} ctx - the client plugin context.
       */
      apply (ctx) {
        const slots = ctx.slots
        if (slots === undefined || typeof slots.inject !== 'function') return
        const React = require('react')
        const Card = makeCard(React, ctx)
        // The plugin's own page: Settings -> Plugins -> this bundle.
        try {
          slots.inject('plugins.bundle.config', () => slots.register({
            name: 'plugins.bundle.config',
            key: '@dsh-external/dsh-jev-lens',
          }, Card))
        } catch { /* seat absent on this harness build: the section below still mounts */ }
        // And its own Settings section, because that is where someone who has
        // just been handed an API key goes looking for the box to paste it in.
        // Registered separately so one failing seat cannot take the other down.
        try {
          slots.inject('settings.section', () => slots.register({
            name: 'settings.section',
            id: 'jev-lens',
            order: 40,
            label: () => 'Jev 实验台',
          }, Card))
        } catch { /* section seat absent: the plugin page still mounts */ }
      },
    }
  },
})
