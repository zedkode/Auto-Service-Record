import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { createWarrantySchema, updateWarrantySchema } from '@autoservices/validation'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import { WarrantiesService } from './warranties.service.js'

@Controller('workspaces/:workspaceId')
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Get('warranties')
  @RequirePermission('ownership:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext, @Query('vehicleId') vehicleId?: string) {
    return { data: await this.warranties.list(ws.workspaceId, vehicleId) }
  }

  @Get('warranties/:warrantyId')
  @RequirePermission('ownership:read')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('warrantyId') id: string) {
    return { data: await this.warranties.get(ws.workspaceId, id) }
  }

  @Get('vehicles/:vehicleId/warranties')
  @RequirePermission('ownership:read')
  async listForVehicle(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('vehicleId') vehicleId: string,
  ) {
    return { data: await this.warranties.list(ws.workspaceId, vehicleId) }
  }

  @Post('vehicles/:vehicleId/warranties')
  @RequirePermission('ownership:write')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createWarrantySchema)) body: unknown,
  ) {
    return {
      data: await this.warranties.create(ws.workspaceId, vehicleId, user.id, body as never),
    }
  }

  @Patch('warranties/:warrantyId')
  @RequirePermission('ownership:write')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('warrantyId') id: string,
    @Body(zodBody(updateWarrantySchema)) body: unknown,
  ) {
    return { data: await this.warranties.update(ws.workspaceId, id, user.id, body as never) }
  }

  @Delete('warranties/:warrantyId')
  @HttpCode(204)
  @RequirePermission('ownership:write')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('warrantyId') id: string,
  ) {
    await this.warranties.remove(ws.workspaceId, id, user.id)
  }
}
