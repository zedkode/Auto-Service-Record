import { Module } from '@nestjs/common'
import { AuthController, COOKIE_OPTIONS, DEV_AUTH_ENABLED } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { QueueService } from '../../common/queue/queue.service.js'

@Module({
  controllers: [AuthController],
  providers: [
    AuditService,
    {
      provide: AuthService,
      inject: [PrismaService, AuditService, QueueService],
      useFactory: (prisma: PrismaService, audit: AuditService, queue: QueueService) =>
        new AuthService(
          prisma,
          audit,
          queue,
          process.env.IP_HASH_SALT ?? 'dev-salt',
          process.env.APP_URL ?? 'http://localhost:3101',
        ),
    },
    {
      provide: COOKIE_OPTIONS,
      useFactory: () => ({
        name: process.env.SESSION_COOKIE_NAME ?? 'as_session',
        domain: process.env.SESSION_COOKIE_DOMAIN ?? 'localhost',
        secure: process.env.NODE_ENV === 'production',
      }),
    },
    {
      provide: DEV_AUTH_ENABLED,
      useFactory: () => process.env.DEV_AUTH_ENABLED === 'true',
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
