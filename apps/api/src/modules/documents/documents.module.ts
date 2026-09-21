import { Module } from '@nestjs/common'
import { DocumentsController } from './documents.controller.js'
import { DocumentsService } from './documents.service.js'
import { AuditService } from '../../common/audit/audit.service.js'

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, AuditService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
