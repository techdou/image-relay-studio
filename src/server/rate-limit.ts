/**
 * Simple in-memory rate limiter using a sliding window algorithm.
 *
 * For production, consider replacing with a Redis-backed implementation
 * (e.g. @upstash/ratelimit) to share state across multiple instances.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 60_000).unref();

export interface RateLimitConfig {
  /** Unique key for this rate limit (e.g. `user:${userId}` or `ip:${ip}`) */
  key: string;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in the current window */
  remaining: number;
  /** Unix timestamp (ms) when the window resets */
  resetAt: number;
}

/**
 * Check if a request should be rate limited.
 *
 * @example
 * ```ts
 * const result = checkRateLimit({
 *   key: `user:${userId}`,
 *   maxRequests: 100,
 *   windowMs: 60_000,
 * });
 * if (!result.allowed) {
 *   throw new AppError(ErrorCodes.RATE_LIMITED, 'Too many requests');
 * }
 * ```
 */
export function checkRateLimit(config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = store.get(config.key);

  if (!entry || entry.resetAt <= now) {
    // No entry or window expired — start a new window
    const resetAt = now + config.windowMs;
    store.set(config.key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Reset rate limit for a given key (e.g. after a successful operation).
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
