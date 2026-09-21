import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { createOdometerEntrySchema, createVehicleSchema } from '@autoservices/validation'
import { VehiclesService } from './vehicles.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

@Controller('workspaces/:workspaceId/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermission('vehicle:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.vehicles.list(ws.workspaceId) }
  }

  @Post()
  @RequirePermission('vehicle:create')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Body(zodBody(createVehicleSchema)) body: unknown,
  ) {
    const data = await this.vehicles.create(ws.workspaceId, user.id, body as never)
    return { data }
  }

  @Get(':vehicleId')
  @RequirePermission('vehicle:read')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    return { data: await this.vehicles.get(ws.workspaceId, vehicleId) }
  }

  @Get(':vehicleId/timeline')
  @RequirePermission('vehicle:read')
  async timeline(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    return { data: await this.vehicles.timeline(ws.workspaceId, vehicleId) }
  }

  @Get(':vehicleId/odometer')
  @RequirePermission('vehicle:read')
  async odometer(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    return { data: await this.vehicles.listOdometer(ws.workspaceId, vehicleId) }
  }

  @Get(':vehicleId/odometer/current')
  @RequirePermission('vehicle:read')
  async currentOdometer(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('vehicleId') vehicleId: string,
  ) {
    return { data: await this.vehicles.currentOdometer(ws.workspaceId, vehicleId) }
  }

  @Post(':vehicleId/odometer')
  @RequirePermission('odometer:write')
  async addOdometer(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createOdometerEntrySchema)) body: unknown,
  ) {
    const data = await this.vehicles.addOdometerEntry(
      ws.workspaceId,
      vehicleId,
      user.id,
      body as never,
    )
    return { data }
  }
}
