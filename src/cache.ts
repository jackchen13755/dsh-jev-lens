/**
 * A tiny memo, so the second identical question is free.
 *
 * Jev answers the same input the same way, which makes caching safe by
 * construction — the cost of a stale entry is that a page changed while its
 * score did not, and the TTL is the knob for that. Two properties matter more
 * than hit rate here:
 *
 *   · the key is a hash of (question, model, state), never the state itself, so
 *     the map cannot become a second copy of the user's command history;
 *   · the cache is bounded in entries and never persisted, so a long session
 *     cannot turn it into a memory leak or a file on disk.
 *
 * Both properties exist because this plugin's ledger promises "no bodies".
 *
 * @module dsh-jev-lens/cache
 */
import { createHash } from 'node:crypto'

export interface CacheStats {
  hits: number
  misses: number
  size: number
  evictions: number
}

export interface Cache<T> {
  get (key: string): T | undefined
  set (key: string, value: T): void
  /** Fill rate, for the report; also the cache's own evidence that it works. */
  readonly stats: CacheStats
  clear (): void
}

/** Stable key for one judgment. The state is hashed, never stored in the key. */
export function keyOf (parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
}

/**
 * Least-recently-used map with a TTL. `now` is injectable so a test can expire
 * entries without sleeping.
 */
export function createCache<T> (max: number, ttlMs: number, now: () => number = Date.now): Cache<T> {
  /** Insertion order is recency order: `Map` re-inserts on update. */
  const entries = new Map<string, { value: T; at: number }>()
  const stats: CacheStats = { hits: 0, misses: 0, size: 0, evictions: 0 }

  return {
    get (key: string): T | undefined {
      const hit = entries.get(key)
      if (!hit) { stats.misses++; stats.size = entries.size; return undefined }
      if (now() - hit.at > ttlMs) {
        entries.delete(key)
        stats.misses++
        stats.size = entries.size
        return undefined
      }
      // Refresh recency: delete + set moves the key to the back of the map.
      entries.delete(key)
      entries.set(key, hit)
      stats.hits++
      return hit.value
    },
    set (key: string, value: T): void {
      entries.delete(key)
      entries.set(key, { value, at: now() })
      while (entries.size > max) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
        stats.evictions++
      }
      stats.size = entries.size
    },
    stats,
    clear (): void { entries.clear(); stats.size = 0 },
  }
}
