import { Module } from '@nestjs/common'
import { ExpensesController } from './expenses.controller.js'
import { ExpensesService } from './expenses.service.js'
import { ExpenseProjectionService } from './expense-projection.service.js'
import { AuditService } from '../../common/audit/audit.service.js'

/**
 * OWN-007/008. The projection service is exported because the modules that own the
 * source records (services, ownership) push into the ledger when they change.
 */
@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseProjectionService, AuditService],
  exports: [ExpensesService, ExpenseProjectionService],
})
export class ExpensesModule {}
