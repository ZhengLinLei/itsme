import { httpError } from '../types/http.js';

type Bucket = { tokens: number; updatedAt: number };

// Token bucket: `capacity` requests per `windowMs`, refilled continuously.
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly name: string,
    private readonly capacity: number,
    private readonly windowMs: number,
  ) {
    setInterval(() => this.prune(), Math.min(windowMs, 300_000)).unref();
  }

  // Returns 0 when allowed, otherwise the seconds to wait.
  take(key: string): number {
    if (this.capacity <= 0) return 0;
    const now = Date.now();
    const refillPerMs = this.capacity / this.windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
  }

  // Throws a 429 error when the key is over its limit.
  consume(key: string): void {
    const retryAfter = this.take(key);
    if (retryAfter) {
      throw httpError(429, 'rate_limited', `Too many requests (${this.name})`, retryAfter);
    }
  }

  private prune(): void {
    const limit = Date.now() - this.windowMs;
    for (const [key, bucket] of this.buckets)
      if (bucket.updatedAt < limit) this.buckets.delete(key);
  }
}
