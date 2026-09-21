/**
 * Idempotency reservation (EMAILS.md §4).
 *
 * The rule: the same reminder, for the same user, in the same window, sends exactly
 * once — no matter how many times a worker retries or how many replicas are running.
 *
 * `reserve()` must be ATOMIC. A check-then-act pair is not good enough: two concurrent
 * jobs both pass the check before either records the key, and the user gets two emails.
 */
export interface IdempotencyStore {
  /** Returns true if the caller now owns the key (i.e. it should send). */
  reserve(key: string, ttlSeconds: number): Promise<boolean>
  /** Releases a reservation so a failed send can be retried. */
  release(key: string): Promise<void>
}

/**
 * Single-process store. Correct within one worker because JavaScript's single-threaded
 * execution makes the has/add pair atomic — provided no await sits between them.
 * Not durable across restarts or replicas; use the Redis store in production.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Map<string, number>()

  async reserve(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now()
    const existing = this.keys.get(key)
    if (existing !== undefined && existing > now) return false
    // No await between the check above and the write below — this is the atomic section.
    this.keys.set(key, now + ttlSeconds * 1000)
    return true
  }

  async release(key: string): Promise<void> {
    this.keys.delete(key)
  }

  clear(): void {
    this.keys.clear()
  }
}

/**
 * Minimal Redis surface, so this package does not depend on ioredis.
 * `set(key, value, 'EX', ttl, 'NX')` is a single atomic command.
 */
export interface RedisLike {
  set(key: string, value: string, mode: 'EX', ttl: number, condition: 'NX'): Promise<string | null>
  del(key: string): Promise<number>
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = 'email:idem:',
  ) {}

  async reserve(key: string, ttlSeconds: number): Promise<boolean> {
    // SET NX is atomic across processes and replicas — exactly what a check-then-act
    // pair cannot give us.
    const result = await this.redis.set(`${this.prefix}${key}`, '1', 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  }

  async release(key: string): Promise<void> {
    await this.redis.del(`${this.prefix}${key}`)
  }
}
