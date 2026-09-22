import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import {
  createTyreSetSchema,
  fitTyreSetSchema,
  measureTreadSchema,
  removeTyreSetSchema,
  updateTyreSetSchema,
} from '@autoservices/validation'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import { TyresService } from './tyres.service.js'

@Controller('workspaces/:workspaceId')
export class TyresController {
  constructor(private readonly tyres: TyresService) {}

  @Get('tyre-sets')
  @RequirePermission('ownership:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext, @Query('vehicleId') vehicleId?: string) {
    return { data: await this.tyres.list(ws.workspaceId, vehicleId) }
  }

  @Get('tyre-sets/:setId')
  @RequirePermission('ownership:read')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('setId') setId: string) {
    return { data: await this.tyres.get(ws.workspaceId, setId) }
  }

  @Get('vehicles/:vehicleId/tyre-sets')
  @RequirePermission('ownership:read')
  async listForVehicle(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('vehicleId') vehicleId: string,
  ) {
    return { data: await this.tyres.list(ws.workspaceId, vehicleId) }
  }

  @Post('vehicles/:vehicleId/tyre-sets')
  @RequirePermission('ownership:write')
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createTyreSetSchema)) body: unknown,
  ) {
    return {
      data: await this.tyres.create(ws.workspaceId, vehicleId, user.id, body as never),
    }
  }

  @Patch('tyre-sets/:setId')
  @RequirePermission('ownership:write')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('setId') setId: string,
    @Body(zodBody(updateTyreSetSchema)) body: unknown,
  ) {
    return { data: await this.tyres.update(ws.workspaceId, setId, user.id, body as never) }
  }

  /** Fitting a set takes off whatever was on: a car wears one set at a time. */
  @Post('tyre-sets/:setId/fit')
  @RequirePermission('ownership:write')
  async fit(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('setId') setId: string,
    @Body(zodBody(fitTyreSetSchema)) body: unknown,
  ) {
    return { data: await this.tyres.fit(ws.workspaceId, setId, user.id, body as never) }
  }

  @Post('tyre-sets/:setId/remove')
  @RequirePermission('ownership:write')
  async removeFromVehicle(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('setId') setId: string,
    @Body(zodBody(removeTyreSetSchema)) body: unknown,
  ) {
    return { data: await this.tyres.remove(ws.workspaceId, setId, user.id, body as never) }
  }

  @Post('tyre-sets/:setId/tread')
  @RequirePermission('ownership:write')
  async measureTread(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('setId') setId: string,
    @Body(zodBody(measureTreadSchema)) body: unknown,
  ) {
    return { data: await this.tyres.measureTread(ws.workspaceId, setId, user.id, body as never) }
  }

  @Delete('tyre-sets/:setId')
  @HttpCode(204)
  @RequirePermission('ownership:write')
  async destroy(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('setId') setId: string,
  ) {
    await this.tyres.softDelete(ws.workspaceId, setId, user.id)
  }
}
