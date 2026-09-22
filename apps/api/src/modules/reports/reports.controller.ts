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

/**
 * Resolves and validates the reporting window. Shared by both endpoints deliberately: two
 * report routes that parse dates in two places are two routes that will eventually
 * disagree about what "no dates given" means.
 */
function period(from?: string, to?: string) {
  const fallback = defaultPeriod()
  const start = from ?? fallback.from
  const end = to ?? fallback.to

  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    throw new DomainError('VALIDATION_FAILED', 'Dates must be in the form YYYY-MM-DD.', 422)
  }
  if (start > end) {
    throw new DomainError('VALIDATION_FAILED', 'The start date is after the end date.', 422)
  }
  return { from: start, to: end }
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
    const { from: start, to: end } = period(from, to)

    return {
      data: await this.reports.costs(ws.workspaceId, { from: start, to: end, vehicleId }),
    }
  }

  @Get('fleet')
  @RequirePermission('report:read')
  async fleet(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { from: start, to: end } = period(from, to)
    return { data: await this.reports.fleet(ws.workspaceId, { from: start, to: end }) }
  }
}
