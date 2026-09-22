import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Reflector } from '@nestjs/core'
import { Redis } from 'ioredis'
import { PrismaService } from './common/prisma.service.js'
import { AuditService } from './common/audit/audit.service.js'
import { QueueService } from './common/queue/queue.service.js'
import { RateLimitGuard } from './common/guards/rate-limit.guard.js'
import { SessionGuard } from './common/guards/session.guard.js'
import { AdminSessionGuard } from './common/guards/admin-session.guard.js'
import { WorkspaceGuard } from './common/guards/workspace.guard.js'
import { HealthModule } from './modules/health/health.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js'
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js'
import { OwnershipModule } from './modules/ownership/ownership.module.js'
import { ExpensesModule } from './modules/expenses/expenses.module.js'
import { DocumentsModule } from './modules/documents/documents.module.js'
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module.js'
import { SupportAccessModule } from './modules/support-access/support-access.module.js'
import { FuelModule } from './modules/fuel/fuel.module.js'
import { ReportsModule } from './modules/reports/reports.module.js'
import { ExportsModule } from './modules/exports/exports.module.js'
import { RemindersModule } from './modules/reminders/reminders.module.js'
import { WebhooksModule } from './modules/webhooks/webhooks.module.js'
import { AdminModule } from './modules/admin/admin.module.js'

export const REDIS = Symbol('REDIS')

@Global()
@Module({
  providers: [
    PrismaService,
    AuditService,
    QueueService,
    {
      provide: REDIS,
      useFactory: () => {
        const url = process.env.REDIS_URL
        if (!url) throw new Error('REDIS_URL is not set')
        return new Redis(url, { maxRetriesPerRequest: null })
      },
    },
  ],
  exports: [PrismaService, AuditService, QueueService, REDIS],
})
class CoreModule {}

@Module({
  imports: [
    CoreModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    MaintenanceModule,
    OwnershipModule,
    ExpensesModule,
    DocumentsModule,
    RemindersModule,
    WebhooksModule,
    AdminModule,
    AdminAuthModule,
    SupportAccessModule,
    FuelModule,
    ReportsModule,
    ExportsModule,
  ],
  providers: [
    // Order matters twice over. Rate limiting runs FIRST, so a flood costs a Redis INCR
    // rather than a session lookup and an Argon2 verification (SECURITY.md §8); then the
    // session must resolve before workspace membership can be checked.
    {
      provide: APP_GUARD,
      inject: [REDIS, Reflector],
      useFactory: (redis: Redis, reflector: Reflector) =>
        new RateLimitGuard(redis, reflector, process.env.RATE_LIMIT_ENABLED !== 'false'),
    },
    {
      provide: APP_GUARD,
      inject: [PrismaService, Reflector],
      useFactory: (prisma: PrismaService, reflector: Reflector) =>
        new SessionGuard(prisma, reflector, process.env.SESSION_COOKIE_NAME ?? 'as_session'),
    },
    {
      provide: APP_GUARD,
      inject: [PrismaService, Reflector],
      useFactory: (prisma: PrismaService, reflector: Reflector) =>
        new WorkspaceGuard(prisma, reflector),
    },
    // The staff realm. Ignores every route outside /api/v1/admin, so the two session
    // systems never see each other's requests (SECURITY.md §6).
    { provide: APP_GUARD, useClass: AdminSessionGuard },
  ],
})
export class AppModule {}
