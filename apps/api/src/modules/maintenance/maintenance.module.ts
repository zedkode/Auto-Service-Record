import { Module } from '@nestjs/common'
import { MaintenanceController } from './maintenance.controller.js'
import { MaintenanceService } from './maintenance.service.js'
import { ServicesController } from '../services/services.controller.js'
import { ServicesService } from '../services/services.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { ExpensesModule } from '../expenses/expenses.module.js'

/**
 * Service history and maintenance ship together: creating a service advances the
 * matching maintenance rule, so they share a transaction boundary and a module.
 */
@Module({
  imports: [ExpensesModule],
  controllers: [MaintenanceController, ServicesController],
  providers: [MaintenanceService, ServicesService, AuditService],
  exports: [MaintenanceService, ServicesService],
})
export class MaintenanceModule {}
