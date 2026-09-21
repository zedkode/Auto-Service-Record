import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { createExpenseSchema, updateExpenseSchema } from '@autoservices/validation'
import { ExpensesService } from './expenses.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

/** Start of the current month, in UTC — the period the dashboard tile reports. */
function monthToDate(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
}

@Controller('workspaces/:workspaceId')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('expense-categories')
  @RequirePermission('expense:read')
  async categories(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.expenses.listCategories(ws.workspaceId) }
  }

  @Get('expenses')
  @RequirePermission('expense:read')
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('vehicleId') vehicleId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    const data = await this.expenses.list(ws.workspaceId, {
      vehicleId,
      categoryId,
      dateFrom,
      dateTo,
      sourceType,
    })
    return { data, meta: { total: data.length } }
  }

  @Get('expenses/summary')
  @RequirePermission('expense:read')
  async summary(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const period = monthToDate()
    return {
      data: await this.expenses.summary(ws.workspaceId, from ?? period.from, to ?? period.to),
    }
  }

  @Post('expenses')
  @RequirePermission('expense:write')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Body(zodBody(createExpenseSchema)) body: unknown,
  ) {
    return { data: await this.expenses.create(ws.workspaceId, user.id, body as never) }
  }

  @Patch('expenses/:expenseId')
  @RequirePermission('expense:write')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('expenseId') expenseId: string,
    @Body(zodBody(updateExpenseSchema)) body: unknown,
  ) {
    return {
      data: await this.expenses.update(ws.workspaceId, expenseId, user.id, body as never),
    }
  }

  @Delete('expenses/:expenseId')
  @HttpCode(204)
  @RequirePermission('expense:write')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('expenseId') expenseId: string,
  ) {
    await this.expenses.remove(ws.workspaceId, expenseId, user.id)
  }
}
