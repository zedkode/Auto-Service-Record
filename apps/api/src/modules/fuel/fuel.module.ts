import { Module } from '@nestjs/common'
import { FuelController } from './fuel.controller.js'
import { FuelService } from './fuel.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { ExpensesModule } from '../expenses/expenses.module.js'

@Module({
  imports: [ExpensesModule],
  controllers: [FuelController],
  providers: [FuelService, AuditService],
  exports: [FuelService],
})
export class FuelModule {}
