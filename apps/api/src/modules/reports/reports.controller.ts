import { Controller, Get, Query } from '@nestjs/common'
import { ReportsService } from './reports.service.js'
import {
  CurrentWorkspace,
  RequirePermission,
  type WorkspaceContext,
} from '../../common/decorators/index.js'
import { DomainError } from '../../common/errors.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Year to date, the period most people mean by "this year". */
function defaultPeriod(): { from: string; to: string } {
  const now = new Date()
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

@Controller('workspaces/:workspaceId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('costs')
  @RequirePermission('report:read')
  async costs(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const period = defaultPeriod()
    const start = from ?? period.from
    const end = to ?? period.to

    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
      throw new DomainError('VALIDATION_FAILED', 'Dates must be in the form YYYY-MM-DD.', 422)
    }
    if (start > end) {
      throw new DomainError('VALIDATION_FAILED', 'The start date is after the end date.', 422)
    }

    return {
      data: await this.reports.costs(ws.workspaceId, { from: start, to: end, vehicleId }),
    }
  }
}
