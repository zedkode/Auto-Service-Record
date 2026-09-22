import { Module } from '@nestjs/common'
import { RemindersController } from './reminders.controller.js'
import { ReminderScanController } from './scan.controller.js'
import { RemindersService } from './reminders.service.js'
import { MaintenanceReminderSource } from './sources/maintenance.source.js'
import { OdometerStaleReminderSource } from './sources/odometer-stale.source.js'
import {
  InspectionReminderSource,
  InsuranceReminderSource,
  RoadTaxReminderSource,
} from './sources/expiry.sources.js'
import { WarrantyReminderSource } from './sources/warranty.source.js'
import { TyreReminderSource } from './sources/tyre.source.js'
import {
  NotificationsController,
  NotificationPreferencesController,
} from '../notifications/notifications.controller.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { AuditService } from '../../common/audit/audit.service.js'

@Module({
  controllers: [
    RemindersController,
    ReminderScanController,
    NotificationsController,
    NotificationPreferencesController,
  ],
  providers: [
    RemindersService,
    NotificationsService,
    MaintenanceReminderSource,
    OdometerStaleReminderSource,
    InspectionReminderSource,
    InsuranceReminderSource,
    RoadTaxReminderSource,
    WarrantyReminderSource,
    TyreReminderSource,
    AuditService,
  ],
  exports: [RemindersService, NotificationsService],
})
export class RemindersModule {}
