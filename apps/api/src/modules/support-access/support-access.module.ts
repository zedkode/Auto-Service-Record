import { Module } from '@nestjs/common'
import { SupportAccessController } from './support-access.controller.js'
import { SupportAccessService } from './support-access.service.js'
import { WorkspaceInspectionService } from './workspace-inspection.service.js'
import { AuditService } from '../../common/audit/audit.service.js'

@Module({
  controllers: [SupportAccessController],
  providers: [SupportAccessService, WorkspaceInspectionService, AuditService],
  exports: [SupportAccessService],
})
export class SupportAccessModule {}
