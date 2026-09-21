/**
 * Password hashing. Argon2id at OWASP's minimum configuration (SECURITY.md §4).
 *
 * Test runs use a deliberately reduced-cost profile: a full-cost hash takes ~50ms and
 * an integration suite performs hundreds. The production profile is never lowered.
 */
import argon2 from 'argon2'

export interface Argon2Params {
  memoryCost: number
  timeCost: number
  parallelism: number
}

export const PRODUCTION_PARAMS: Argon2Params = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
}

const TEST_PARAMS: Argon2Params = { memoryCost: 512, timeCost: 1, parallelism: 1 }

export function resolveParams(env = process.env): Argon2Params {
  if (env.NODE_ENV === 'test') return TEST_PARAMS
  return {
    memoryCost: Number(env.ARGON2_MEMORY_COST ?? PRODUCTION_PARAMS.memoryCost),
    timeCost: Number(env.ARGON2_TIME_COST ?? PRODUCTION_PARAMS.timeCost),
    parallelism: Number(env.ARGON2_PARALLELISM ?? PRODUCTION_PARAMS.parallelism),
  }
}

export async function hashPassword(plain: string, params = resolveParams()): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, ...params })
}

/**
 * A dummy hash verified when the user does not exist, so that login timing does not
 * reveal whether an account exists (SECURITY.md §4, threat T11).
 */
let dummyHashPromise: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalisation')
  return dummyHashPromise
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}

/** Always performs a verification, even for an unknown user. */
export async function verifyPasswordTimingSafe(
  hash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!hash) {
    await verifyPassword(await getDummyHash(), plain)
    return false
  }
  return verifyPassword(hash, plain)
}

/** True when a stored hash was produced with weaker parameters and should be upgraded. */
export function needsRehash(hash: string, params = resolveParams()): boolean {
  const m = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)/.exec(hash)
  if (!m) return true
  return (
    Number(m[1]) < params.memoryCost ||
    Number(m[2]) < params.timeCost ||
    Number(m[3]) !== params.parallelism
  )
}
