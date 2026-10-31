export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  take(bucket: 'search' | 'refresh'): RateLimitDecision;
}

export function createRateLimiter(options: {
  searchPerMinute: number;
  refreshPerMinute: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = {
    search: { start: -1, count: 0, limit: options.searchPerMinute },
    refresh: { start: -1, count: 0, limit: options.refreshPerMinute },
  };
  return {
    take(bucket) {
      const window = windows[bucket];
      const current = now();
      if (window.start < 0 || current - window.start >= 60_000) {
        window.start = current;
        window.count = 0;
      }
      if (window.count >= window.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.start + 60_000 - current) / 1000)),
        };
      }
      window.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
