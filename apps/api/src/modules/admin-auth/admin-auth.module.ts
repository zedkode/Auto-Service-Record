import { Module } from '@nestjs/common'
import { AdminAuthController } from './admin-auth.controller.js'
import { AdminAuthService } from './admin-auth.service.js'
import { AuditService } from '../../common/audit/audit.service.js'

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AuditService],
  exports: [AdminAuthService],
})
export class AdminAuthModule {}
