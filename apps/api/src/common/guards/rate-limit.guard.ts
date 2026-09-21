import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Redis } from 'ioredis'
import { createHash } from 'node:crypto'
import { DomainError } from '../errors.js'

export interface RateLimitRule {
  /** Requests permitted within the window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
  /**
   * Include a body field in the key (e.g. 'email'), so a limit applies per-account as
   * well as per-IP. Without this, one attacker trying one password against many
   * accounts is invisible; with only this, they can lock out a whole user base.
   */
  keyField?: string
  /**
   * Key on a route parameter instead of the caller's IP — `workspaceId`, so an upload
   * quota is per tenant as specified, rather than per network. A workspace behind one
   * office NAT would otherwise share a limit with everyone else there.
   */
  keyParam?: string
}

export const RATE_LIMIT = 'rateLimit'
export const RateLimit = (rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT, rules)

/**
 * Redis-backed fixed-window limiter (SECURITY.md §8).
 *
 * Evaluated before any database work, so a flood costs a Redis INCR rather than an
 * Argon2 hash. Fails OPEN if Redis is unavailable: losing rate limiting is bad, but
 * refusing all logins because a cache is down is worse.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit')

  constructor(
    private readonly redis: Redis,
    private readonly reflector: Reflector,
    private readonly enabled: boolean,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true

    const rules = this.reflector.getAllAndOverride<RateLimitRule[]>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!rules?.length) return true

    const req = context.switchToHttp().getRequest()
    const route: string = req.routeOptions?.url ?? req.url ?? 'unknown'
    const ip: string = req.ip ?? 'unknown'

    for (const rule of rules) {
      const scope = rule.keyField
        ? hash(String(req.body?.[rule.keyField] ?? '').toLowerCase())
        : rule.keyParam
          ? `p:${hash(String(req.params?.[rule.keyParam] ?? ''))}`
          : 'ip'
      // A param-scoped rule is deliberately NOT also keyed by IP: the quota belongs to
      // the workspace, so moving network must not reset it.
      const subject = rule.keyParam ? '' : hash(ip)
      const key = `rl:${route}:${scope}:${subject}:${Math.floor(Date.now() / (rule.windowSeconds * 1000))}`

      let count: number
      try {
        count = await this.redis.incr(key)
        if (count === 1) await this.redis.expire(key, rule.windowSeconds)
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'rate limiter unavailable — failing open',
        )
        return true
      }

      if (count > rule.limit) {
        const retryAfter = rule.windowSeconds
        context.switchToHttp().getResponse().header('retry-after', String(retryAfter))
        this.logger.warn(
          { route, scope: rule.keyField ?? rule.keyParam ?? 'ip' },
          'rate limit exceeded',
        )
        throw new DomainError(
          'RATE_LIMITED',
          'Too many attempts. Please wait a moment and try again.',
          429,
          { retryAfterSeconds: retryAfter },
        )
      }
    }

    return true
  }
}

const hash = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 16)
