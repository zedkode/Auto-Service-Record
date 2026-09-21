import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { forWorkspace, type TenantPrismaClient } from '@autoservices/db'

/**
 * Database access.
 *
 * `raw` is the UNSCOPED client. Reaching for it directly on tenant-owned models is a
 * tenant-isolation bug — use forWorkspace() and let the extension inject the predicate.
 * Legitimate unscoped access (auth by email, admin, system jobs) is explicit and rare.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient

  constructor() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    this.raw = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  }

  async onModuleInit(): Promise<void> {
    await this.raw.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect()
  }

  /** The only sanctioned way to read or write tenant-owned data. */
  forWorkspace(workspaceId: string): TenantPrismaClient {
    return forWorkspace(this.raw, workspaceId)
  }

  async healthy(): Promise<boolean> {
    try {
      await this.raw.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
