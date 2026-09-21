import { Module } from '@nestjs/common'
import { OwnershipController } from './ownership.controller.js'
import { OwnershipService } from './ownership.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { ExpensesModule } from '../expenses/expenses.module.js'

/**
 * OWN-001/002/003 — inspections, insurance and road tax. Grouped because they are the
 * same shape of problem (a dated obligation with an expiry) and are surfaced together.
 */
@Module({
  imports: [ExpensesModule],
  controllers: [OwnershipController],
  providers: [OwnershipService, AuditService],
  exports: [OwnershipService],
})
export class OwnershipModule {}
