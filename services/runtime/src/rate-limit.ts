/** 进程内固定窗口限流。公开部署为单 Runtime 实例时用于保护免费 Demo。 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  take(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    if (this.limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.buckets.size > 10000) this.prune(now);
      return { allowed: true, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= this.limit) return { allowed: false, retryAfterSeconds };
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds };
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
