import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import { createFuelEntrySchema, updateFuelEntrySchema } from '@autoservices/validation'
import { FuelService } from './fuel.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

/** OWN-006 — fuel and charging. `fuel:write` is held by DRIVER, who does the filling. */
@Controller('workspaces/:workspaceId')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  @Get('vehicles/:vehicleId/fuel')
  @RequirePermission('vehicle:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    const data = await this.fuel.list(ws.workspaceId, vehicleId)
    return { data, meta: { total: data.length } }
  }

  @Get('vehicles/:vehicleId/fuel/economy')
  @RequirePermission('vehicle:read')
  async economy(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    return { data: await this.fuel.economy(ws.workspaceId, vehicleId) }
  }

  @Get('vehicles/:vehicleId/fuel/trend')
  @RequirePermission('vehicle:read')
  async trend(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    return { data: await this.fuel.trend(ws.workspaceId, vehicleId) }
  }

  @Post('vehicles/:vehicleId/fuel')
  @RequirePermission('fuel:write')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createFuelEntrySchema)) body: unknown,
  ) {
    return {
      data: await this.fuel.create(ws.workspaceId, vehicleId, user.id, body as never),
    }
  }

  @Patch('fuel/:entryId')
  @RequirePermission('fuel:write')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('entryId') entryId: string,
    @Body(zodBody(updateFuelEntrySchema)) body: unknown,
  ) {
    return { data: await this.fuel.update(ws.workspaceId, entryId, user.id, body as never) }
  }

  @Delete('fuel/:entryId')
  @HttpCode(204)
  @RequirePermission('fuel:write')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('entryId') entryId: string,
  ) {
    await this.fuel.remove(ws.workspaceId, entryId, user.id)
  }
}
