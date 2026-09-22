export interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    evictions: number;
}
export interface Cache<T> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    /** Fill rate, for the report; also the cache's own evidence that it works. */
    readonly stats: CacheStats;
    clear(): void;
}
/** Stable key for one judgment. The state is hashed, never stored in the key. */
export declare function keyOf(parts: unknown[]): string;
/**
 * Least-recently-used map with a TTL. `now` is injectable so a test can expire
 * entries without sleeping.
 */
export declare function createCache<T>(max: number, ttlMs: number, now?: () => number): Cache<T>;
