import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import {
  createMaintenanceRuleSchema,
  updateMaintenanceRuleSchema,
  completeMaintenanceSchema,
} from '@autoservices/validation'
import { MaintenanceService } from './maintenance.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

@Controller('workspaces/:workspaceId')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** Workspace-wide due/overdue list — what the dashboard's attention panel uses. */
  @Get('maintenance/due')
  @RequirePermission('vehicle:read')
  async due(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.maintenance.dueForWorkspace(ws.workspaceId) }
  }

  @Get('vehicles/:vehicleId/maintenance')
  @RequirePermission('vehicle:read')
  async listForVehicle(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('vehicleId') vehicleId: string,
  ) {
    return { data: await this.maintenance.listForVehicle(ws.workspaceId, vehicleId) }
  }

  @Post('vehicles/:vehicleId/maintenance')
  @RequirePermission('reminder:manage')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createMaintenanceRuleSchema)) body: unknown,
  ) {
    return {
      data: await this.maintenance.create(ws.workspaceId, vehicleId, user.id, body as never),
    }
  }

  /** Seeds a starter schedule from the built-in category defaults. */
  @Post('vehicles/:vehicleId/maintenance/apply-template')
  @RequirePermission('reminder:manage')
  async applyTemplate(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
  ) {
    return { data: await this.maintenance.applyTemplate(ws.workspaceId, vehicleId, user.id) }
  }

  @Patch('maintenance/:ruleId')
  @RequirePermission('reminder:manage')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('ruleId') ruleId: string,
    @Body(zodBody(updateMaintenanceRuleSchema)) body: unknown,
  ) {
    return { data: await this.maintenance.update(ws.workspaceId, ruleId, user.id, body as never) }
  }

  @Delete('maintenance/:ruleId')
  @HttpCode(204)
  @RequirePermission('reminder:manage')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('ruleId') ruleId: string,
  ) {
    await this.maintenance.remove(ws.workspaceId, ruleId, user.id)
  }

  @Post('maintenance/:ruleId/complete')
  @RequirePermission('reminder:manage')
  async complete(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('ruleId') ruleId: string,
    @Body(zodBody(completeMaintenanceSchema)) body: unknown,
  ) {
    return { data: await this.maintenance.complete(ws.workspaceId, ruleId, user.id, body as never) }
  }

  @Get('maintenance/:ruleId/completions')
  @RequirePermission('vehicle:read')
  async completions(@CurrentWorkspace() ws: WorkspaceContext, @Param('ruleId') ruleId: string) {
    return { data: await this.maintenance.completions(ws.workspaceId, ruleId) }
  }
}
