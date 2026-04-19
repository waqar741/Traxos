/**
 * Simple in-memory cache for Supabase query results.
 * Prevents redundant API calls when navigating between pages
 * that fetch the same data (e.g., accounts, transactions).
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

const cache = new Map<string, CacheEntry<any>>()

// Default TTL: 2 minutes (120,000ms)
const DEFAULT_TTL = 2 * 60 * 1000

/**
 * Get cached data for a given key.
 * Returns null if the cache entry is missing or expired.
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null

  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }

  return entry.data as T
}

/**
 * Set cached data for a given key with an optional TTL.
 */
export function setCached<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + ttl,
  })
}

/**
 * Invalidate (remove) a specific cache entry.
 */
export function invalidateCache(key: string): void {
  cache.delete(key)
}

/**
 * Invalidate all cache entries that match a prefix.
 * Example: invalidateCacheByPrefix('accounts') removes
 * 'accounts:user123', 'accounts:list', etc.
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key)
    }
  }
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * Helper to wrap a fetch function with caching.
 * If the data is cached and fresh, returns cached data.
 * Otherwise calls the fetcher, caches the result, and returns it.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  const cached = getCached<T>(key)
  if (cached !== null) {
    return cached
  }

  const data = await fetcher()
  setCached(key, data, ttl)
  return data
}
