import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { createServiceSchema, updateServiceSchema } from '@autoservices/validation'
import { ServicesService } from './services.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

@Controller('workspaces/:workspaceId')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('service-categories')
  @RequirePermission('service:read')
  async categories(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.services.listCategories(ws.workspaceId) }
  }

  /** Workspace-wide service history with filters (task brief §17). */
  @Get('services')
  @RequirePermission('service:read')
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('vehicleId') vehicleId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('q') q?: string,
  ) {
    const data = await this.services.list(ws.workspaceId, {
      vehicleId,
      categoryId,
      dateFrom,
      dateTo,
      q,
    })
    return { data, meta: { total: data.length } }
  }

  @Get('services/:serviceId')
  @RequirePermission('service:read')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('serviceId') serviceId: string) {
    return { data: await this.services.get(ws.workspaceId, serviceId) }
  }

  @Patch('services/:serviceId')
  @RequirePermission('service:write')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('serviceId') serviceId: string,
    @Body(zodBody(updateServiceSchema)) body: unknown,
  ) {
    return { data: await this.services.update(ws.workspaceId, serviceId, user.id, body as never) }
  }

  @Delete('services/:serviceId')
  @HttpCode(204)
  @RequirePermission('service:write')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('serviceId') serviceId: string,
  ) {
    await this.services.remove(ws.workspaceId, serviceId, user.id)
  }

  @Get('vehicles/:vehicleId/services')
  @RequirePermission('service:read')
  async listForVehicle(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('vehicleId') vehicleId: string,
    @Query('categoryId') categoryId?: string,
    @Query('q') q?: string,
  ) {
    const data = await this.services.list(ws.workspaceId, { vehicleId, categoryId, q })
    return { data, meta: { total: data.length } }
  }

  @Post('vehicles/:vehicleId/services')
  @RequirePermission('service:write')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createServiceSchema)) body: unknown,
  ) {
    return { data: await this.services.create(ws.workspaceId, vehicleId, user.id, body as never) }
  }

  @Get('vehicles/:vehicleId/services/cost-summary')
  @RequirePermission('service:read')
  async costs(@CurrentWorkspace() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    return { data: await this.services.costSummary(ws.workspaceId, vehicleId) }
  }
}
