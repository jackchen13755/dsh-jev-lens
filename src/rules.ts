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
  safe: true
  reason: string
}

/** A command whose shape is unmistakable, decided without a request. */
export interface RuleFlag {
  decision: 'block' | 'revise'
  reason: string
}

/**
 * Shell metacharacters that make a whitelisted verb stop being a guarantee:
 * everything after `;` or `&&` is a different command, and `>` writes.
 */
const CONTROL = /[;&|<>`$()\n\r]/

/** Read-only verbs. Each entry is matched against the first token only. */
const SAFE_VERBS = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'stat', 'file', 'du', 'df',
  'tree', 'jq', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink',
  'whoami', 'id', 'uname', 'hostname', 'date', 'uptime', 'diff', 'cmp', 'which', 'type',
  'shasum', 'sha256sum', 'md5sum', 'md5', 'git', 'node', 'npm', 'npx', 'python3', 'echo', 'env', 'printenv',
])

/**
 * `find` is read-only *unless* it deletes or executes, and `sed` *unless* it
 * edits in place. Both are allowed through the verb list and rejected here.
 */
const SAFE_VERB_EXCEPTIONS: Array<{ verb: string; danger: RegExp; reason: string }> = [
  { verb: 'find', danger: /-(delete|exec|execdir|ok|okdir|fls|fprint)\b/, reason: 'find with a writing or executing flag' },
  { verb: 'sed', danger: /(^|\s)-i(\s|$|[a-zA-Z])/, reason: 'sed -i edits the file in place' },
  { verb: 'git', danger: /(^|\s)(clean|reset|checkout|restore|stash\s+(drop|clear)|branch\s+-D|push|rm|gc|prune|filter-branch|rebase|am|apply|merge|cherry-pick)\b/, reason: 'git subcommand can modify the working tree or the remote' },
  { verb: 'node', danger: /\s(-e|--eval|-p|--print)\b/, reason: 'node -e evaluates code' },
  { verb: 'npm', danger: /\b(install|i|ci|uninstall|update|publish|link|run|exec|init)\b/, reason: 'npm subcommand writes or executes' },
  { verb: 'npx', danger: /./, reason: 'npx downloads and executes' },
  { verb: 'python3', danger: /\s(-c|-m)\b/, reason: 'python3 -c/-m executes code' },
  { verb: 'awk', danger: /system\s*\(/, reason: 'awk system() executes' },
  { verb: 'echo', danger: /\s-[a-zA-Z]*e/, reason: 'echo -e interprets escapes' },
]

/** Verbs that are never safe, whatever they are attached to. */
const DESTRUCTIVE_TOKEN = /\b(rm|rmdir|mv|cp|tee|truncate|shred|dd|mkfs\w*|chmod|chown|ln|touch|install|curl|wget|ssh|scp|rsync|kill|pkill|launchctl|sudo|su|eval|exec|source)\b/

/**
 * Decide whether a command can skip the model entirely.
 *
 * Returns `null` for everything that is not provably harmless: a piped command,
 * a multi-line script, an unknown verb, a command that mentions a writing verb.
 */
export function locallySafe (raw: string): SafeSkip | null {
  const command = raw.trim()
  if (!command || command.length > 400) return null
  if (CONTROL.test(command)) return null
  if (DESTRUCTIVE_TOKEN.test(command)) return null
  const [verb] = command.split(/\s+/)
  if (!verb || !SAFE_VERBS.has(verb)) return null
  for (const exception of SAFE_VERB_EXCEPTIONS) {
    if (exception.verb === verb && exception.danger.test(command)) return null
  }
  if (verb === 'git') {
    // `git status`, `git log` … but a bare `git` can do anything.
    const sub = command.split(/\s+/)[1] ?? ''
    if (!['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'describe', 'blame', 'ls-files', 'config', 'rev-list', 'shortlog', 'tag', 'show-ref', 'for-each-ref'].includes(sub)) return null
  }
  if (verb === 'echo' && command.length > 200) return null
  return { safe: true, reason: `read-only ${verb}` }
}

/** Unmistakable destruction — flagged without a request. Precision over recall. */
const DESTRUCTIVE_RULES: Array<{ re: RegExp; decision: 'block' | 'revise'; reason: string }> = [
  { re: /\brm\s+(?:-[a-zA-Z-]+\s+)*\/(?:\s|$|\*)/, decision: 'block', reason: 'rm on the filesystem root' },
  { re: /\brm\s+(?:-[a-zA-Z-]+\s+)*(?:~|\$HOME|\$\{HOME\})\/?(?:\s|$)/, decision: 'block', reason: 'rm on the whole home directory' },
  { re: /\bmkfs(?:\.[a-z0-9]+)?\b/, decision: 'block', reason: 'mkfs formats a filesystem' },
  { re: /\bdd\b[^\n]*\bof=\/dev\//, decision: 'block', reason: 'dd writing to a block device' },
  { re: />\s*\/dev\/(?:sd|disk|nvme|rdisk)/, decision: 'block', reason: 'redirect into a block device' },
  { re: /\b(?:shred|wipefs|blkdiscard)\b/, decision: 'block', reason: 'unrecoverable erase tool' },
  { re: /\bdrop\s+(?:table|database|schema)\b/i, decision: 'block', reason: 'DROP on a database object' },
  { re: /\btruncate\s+table\b/i, decision: 'block', reason: 'TRUNCATE TABLE' },
  { re: /\bgit\s+push\b[^\n]*(?:\s-f\b|--force(?!-with-lease))/, decision: 'revise', reason: 'force push rewrites remote history' },
  { re: /\bgit\s+reset\s+--hard\b/, decision: 'revise', reason: 'reset --hard discards working-tree changes' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*[fdx]/, decision: 'revise', reason: 'git clean -fdx deletes untracked files' },
  { re: /\bgit\s+stash\s+(?:drop|clear)\b/, decision: 'revise', reason: 'stash drop discards stashed work' },
  { re: /\bfind\b[^\n]*\s-delete\b/, decision: 'revise', reason: 'find -delete removes matched files' },
  /*
   * Deliberately absent: a generic `rm -rf <path>` rule. It fires on
   * `rm -rf node_modules` and `rm -rf dist`, which is exactly the routine work a
   * guard must not interrupt — and Jev answers those correctly and cheaply. A
   * local rule may only fire where a human would certainly want to be asked;
   * everything else pays for a request.
   */
]

/** Flag an unmistakable destructive command. Ambiguity returns `null` on purpose. */
export function matchDestructive (raw: string): RuleFlag | null {
  const command = raw.trim()
  if (!command) return null
  for (const rule of DESTRUCTIVE_RULES) {
    if (rule.re.test(command)) return { decision: rule.decision, reason: rule.reason }
  }
  return null
}

/**
 * What the prefilter decided about one command.
 *
 * `judge` means "spend a request": the default, and the only outcome for
 * anything the rules do not recognise.
 */
export type Prefilter =
  | { kind: 'skip'; reason: string }
  | { kind: 'flag'; decision: 'block' | 'revise'; reason: string }
  | { kind: 'judge' }

/** Rules first, model second. Exported so the ordering is testable on its own. */
export function prefilter (raw: string): Prefilter {
  const flagged = matchDestructive(raw)
  if (flagged) return { kind: 'flag', ...flagged }
  const safe = locallySafe(raw)
  if (safe) return { kind: 'skip', reason: safe.reason }
  return { kind: 'judge' }
}
