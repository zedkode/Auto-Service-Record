import { PrismaClient } from '@prisma/client'

declare global {
  var __autoservicesPrisma: PrismaClient | undefined
}

export function createPrismaClient(opts: { logQueries?: boolean } = {}): PrismaClient {
  return new PrismaClient({
    log: opts.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })
}

/**
 * Single client per process. Reused across hot reloads in development so a watch restart
 * does not leak connections until Postgres refuses new ones.
 */
export function getPrismaClient(): PrismaClient {
  if (!globalThis.__autoservicesPrisma) {
    globalThis.__autoservicesPrisma = createPrismaClient({
      logQueries: process.env.LOG_LEVEL === 'trace',
    })
  }
  return globalThis.__autoservicesPrisma
}
