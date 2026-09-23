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
  name: string
  /** Why this pattern is suspicious, for a human reading the ledger. */
  why: string
}

const PATTERNS: Array<{ name: string, why: string, test: RegExp | ((text: string) => boolean) }> = [
  {
    name: 'override-instruction',
    why: '要求忽略/忘记既有指令（且不是引用）',
    test: (text: string): boolean => unquotedMatch(text, /(\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instruction|prompt|rule|context))/i),
  },
  {
    name: 'override-instruction-zh',
    why: '中文的"忽略以上指令"类措辞（且不是引用）',
    test: (text: string): boolean => unquotedMatch(text, /(忽略|无视|忘掉|不要理会)[^。\n]{0,12}(以上|上面|之前|前面|先前|所有)[^。\n]{0,8}(指令|要求|提示|设定|规则)/),
  },
  {
    name: 'direct-address',
    why: '直接对模型下命令（you must / 你现在是）',
    test: /(\byou (must|should|need to|will) (now )?(output|print|send|run|execute|ignore|reveal|delete|write)\b)|(\bfrom now on\b[^.\n]{0,30}\byou\b)|(你现在是|你现在要|从现在起你|请立即执行)/i,
  },
  {
    name: 'system-impersonation',
    why: '伪装成系统提示/新指令块',
    /*
     * Narrow on purpose. The first version matched the bare phrase "system prompt"
     * anywhere and fired on a systemd unit file and on a paper discussing
     * "system messages" — documentation about prompts is not an attack on one. Now
     * it needs a line-leading role label, a bracketed header, or an explicit
     * instruction block.
     */
    test: /(^|\n)\s*(system|assistant|developer)\s*[:：]\s*\S|(<\|?(system|im_start)\|?>)|(^\s*#+\s*(new )?(system )?instructions?\b)|(\[(new )?(system )?(prompt|instruction|message)\])/im,
  },
  {
    name: 'tool-call-shape',
    why: '正文里出现工具调用/函数调用的结构',
    test: /(<tool_use>|<\/?function_call>|"tool_calls"\s*:|\{\s*"name"\s*:\s*"[a-z_]+"\s*,\s*"arguments"\s*:)|(\bcall the (\w+ )?tool\b)/i,
  },
  {
    name: 'exfiltration',
    why: '要求把密钥/环境变量/文件发送出去',
    /*
     * The window between the verb and the asset has to be generous: a real request
     * names a *path* ("把 ~/.dsh/.credentials.yaml 里的 token 发送到 …"), and the
     * first version's 20-character window missed exactly that.
     */
    test: /((send|post|upload|exfiltrate|transmit|curl|wget|fetch)[^.\n]{0,60}(\.env|id_rsa|credential|secret|api[_-]?key|token|password)[^.\n]{0,40}(http|url|@|endpoint))|((把|将)[^。\n]{0,60}(\.env|\.credentials|id_rsa|密钥|token|密码|凭据)[^。\n]{0,30}(发送|上传|提交|贴到|发到|传给))/i,
  },
  {
    name: 'concealment',
    why: '要求不要告诉用户/隐藏行为',
    test: /(do not (tell|inform|mention|reveal)[^.\n]{0,30}(user|human|anyone))|(without (telling|informing|asking)[^.\n]{0,20}(user|human))|(不要(告诉|通知|提及|声张)|别让(用户|他|她)知道|悄悄(地)?(执行|发送|删除))/i,
  },
  {
    name: 'urgency-pressure',
    why: '制造紧迫感以绕过确认',
    test: /((immediately|right now|urgent(ly)?|before (you )?(continue|proceed|respond))[^.\n]{0,40}(run|execute|send|delete|paste|output))|((立刻|马上|立即)[^。\n]{0,16}(执行|发送|删除|粘贴|输出))/i,
  },
  {
    name: 'invisible-unicode',
    why: '夹带零宽/双向控制字符（可用于隐藏指令）',
    test: (text: string): boolean => {
      const matches = text.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g)
      return matches !== null && matches.length >= 3
    },
  },
  {
    name: 'encoded-blob',
    why: '大段 base64/hex 载荷（常用来藏指令）',
    test: (text: string): boolean =>
      /[A-Za-z0-9+/]{180,}={0,2}/.test(text) || /[0-9a-fA-F]{240,}/.test(text),
  },
  {
    name: 'hidden-html',
    why: 'HTML 注释/隐藏样式里夹带指令',
    test: /<!--[\s\S]{0,600}?(ignore|instruction|you must|system prompt|忽略|指令)[\s\S]{0,200}?-->|(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|color\s*:\s*(#fff|#ffffff|white))[^>]{0,200}>[^<]{0,200}(ignore|you must|忽略|指令)/i,
  },
  {
    name: 'data-uri-script',
    why: 'data: URI 里带脚本（常见投递手法）',
    // `data:text/html` in a *fetched text* page is already remarkable; the payload is
    // usually base64, so looking for the literal word "script" misses it.
    test: /data:text\/html[;,][^"')\s]{0,60}(base64,)?[A-Za-z0-9+/=]{40,}|data:text\/html[;,][^"')\s]{0,200}(script|onerror|onload)/i,
  },
]

/**
 * Match, but only when the hit is not a quotation.
 *
 * Rules cannot read intent, and a security article quoting "ignore previous
 * instructions" is textually identical to an attack making the same demand. The one
 * cheap discriminator that works on this corpus is quotation: a citation wraps the
 * phrase in quotes. Getting this wrong in the other direction is safer (a missed
 * citation costs one 1.2 s screening call), which is why the check is a discount,
 * not a veto.
 */
function unquotedMatch (text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const scan = new RegExp(pattern.source, flags)
  let match: RegExpExecArray | null
  while ((match = scan.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 2), match.index)
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 2)
    const quoted = /["'“‘「『]/.test(before) || /["'”’」』]/.test(after)
    if (!quoted) return true
    if (match.index === scan.lastIndex) scan.lastIndex++
  }
  return false
}

/** Every tell this filter knows, for the report and the tests. */
export const SCREEN_FEATURES = PATTERNS.map(pattern => ({ name: pattern.name, why: pattern.why }))

export interface ScreenVerdict {
  /** Distinct feature groups matched — the filter's whole opinion. */
  score: number
  features: ScreenFeature[]
  /** True when the page should be handed to the model. */
  suspicious: boolean
}

/**
 * Score a page's text for instruction-shaped content.
 *
 * @param text - the fetched page text (already capped by `maxScreenChars`).
 * @returns the matched features and whether screening should proceed.
 */
export function scoreScreen (text: string): ScreenVerdict {
  const features: ScreenFeature[] = []
  for (const pattern of PATTERNS) {
    let hit = false
    try {
      hit = typeof pattern.test === 'function' ? pattern.test(text) : pattern.test.test(text)
    } catch { hit = false }
    if (hit) features.push({ name: pattern.name, why: pattern.why })
  }
  return { score: features.length, features, suspicious: features.length > 0 }
}

/** A short, log-safe label for the ledger: feature names only, never content. */
export const featureLabel = (verdict: ScreenVerdict): string =>
  verdict.features.map(feature => feature.name).join(',')
