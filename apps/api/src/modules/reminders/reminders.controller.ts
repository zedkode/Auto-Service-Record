import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { RemindersService } from './reminders.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

const snoozeSchema = z
  .object({
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    days: z.number().int().min(1).max(365).optional(),
  })
  .refine((v) => v.until !== undefined || v.days !== undefined, {
    message: 'Provide either a date or a number of days.',
  })

@Controller('workspaces/:workspaceId/reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @RequirePermission('vehicle:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext, @Query('filter') filter?: string) {
    const data = await this.reminders.list(ws.workspaceId, filter === 'all' ? 'all' : 'active')
    return { data, meta: { total: data.length } }
  }

  @Get('summary')
  @RequirePermission('vehicle:read')
  async summary(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.reminders.summary(ws.workspaceId) }
  }

  @HttpCode(200)
  @Post(':reminderId/snooze')
  @RequirePermission('reminder:manage')
  async snooze(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('reminderId') reminderId: string,
    @Body(zodBody(snoozeSchema)) body: unknown,
  ) {
    const input = body as { until?: string; days?: number }
    const until =
      input.until ??
      (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() + (input.days ?? 7))
        return d.toISOString().slice(0, 10)
      })()
    return { data: await this.reminders.snooze(ws.workspaceId, reminderId, user.id, until) }
  }

  @HttpCode(204)
  @Post(':reminderId/dismiss')
  @RequirePermission('reminder:manage')
  async dismiss(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('reminderId') reminderId: string,
  ) {
    await this.reminders.dismiss(ws.workspaceId, reminderId, user.id)
  }

  @HttpCode(204)
  @Post(':reminderId/complete')
  @RequirePermission('reminder:manage')
  async complete(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('reminderId') reminderId: string,
  ) {
    await this.reminders.complete(ws.workspaceId, reminderId, user.id)
  }
}
