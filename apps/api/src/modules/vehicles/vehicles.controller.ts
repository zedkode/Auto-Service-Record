import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import {
  changeVehicleStatusSchema,
  createOdometerEntrySchema,
  createVehicleSchema,
} from '@autoservices/validation'
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

  @Get('deleted')
  @RequirePermission('vehicle:read')
  async listDeleted(@CurrentWorkspace() ws: WorkspaceContext) {
    const data = await this.vehicles.listDeleted(ws.workspaceId)
    return { data, meta: { total: data.length } }
  }

  @Get()
  @RequirePermission('vehicle:read')
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const data = await this.vehicles.list(ws.workspaceId, {
      includeInactive: includeInactive === 'true',
    })
    return { data, meta: { total: data.length } }
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
  @Patch(':vehicleId/status')
  @RequirePermission('vehicle:update')
  async changeStatus(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(changeVehicleStatusSchema)) body: unknown,
  ) {
    return {
      data: await this.vehicles.changeStatus(ws.workspaceId, vehicleId, user.id, body as never),
    }
  }

  /** Soft delete. A vehicle is never removed outright by a user (DATABASE.md §5). */
  @Delete(':vehicleId')
  @HttpCode(204)
  @RequirePermission('vehicle:delete')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
  ) {
    await this.vehicles.softDelete(ws.workspaceId, vehicleId, user.id)
  }

  @Post(':vehicleId/restore')
  @RequirePermission('vehicle:delete')
  async restore(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
  ) {
    return { data: await this.vehicles.restore(ws.workspaceId, vehicleId, user.id) }
  }
}
