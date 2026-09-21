import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import {
  createInspectionSchema,
  createInsuranceSchema,
  createRoadTaxSchema,
  resolveAdvisorySchema,
  updateInspectionSchema,
  updateInsuranceSchema,
  updateRoadTaxSchema,
} from '@autoservices/validation'
import { OwnershipService } from './ownership.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'

/**
 * OWN-001/002/003 — inspections (MOT), insurance and road tax.
 *
 * Three record types with one thing in common: an expiry date the owner must not miss.
 * They are read together because that is how the question is asked ("is this vehicle
 * legal to drive?"), and each is written separately.
 */
@Controller('workspaces/:workspaceId')
export class OwnershipController {
  constructor(private readonly ownership: OwnershipService) {}

  // --- inspections ---

  @Get('inspections')
  @RequirePermission('ownership:read')
  async listInspections(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const data = await this.ownership.listInspections(ws.workspaceId, ws.role, vehicleId)
    return { data, meta: { total: data.length } }
  }

  @Get('inspections/:inspectionId')
  @RequirePermission('ownership:read')
  async getInspection(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('inspectionId') inspectionId: string,
  ) {
    return { data: await this.ownership.getInspection(ws.workspaceId, ws.role, inspectionId) }
  }

  @Post('vehicles/:vehicleId/inspections')
  @RequirePermission('ownership:write')
  async createInspection(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createInspectionSchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.createInspection(
        ws.workspaceId,
        vehicleId,
        user.id,
        ws.role,
        body as never,
      ),
    }
  }

  @Patch('inspections/:inspectionId')
  @RequirePermission('ownership:write')
  async updateInspection(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('inspectionId') inspectionId: string,
    @Body(zodBody(updateInspectionSchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.updateInspection(
        ws.workspaceId,
        inspectionId,
        user.id,
        ws.role,
        body as never,
      ),
    }
  }

  @Delete('inspections/:inspectionId')
  @HttpCode(204)
  @RequirePermission('ownership:write')
  async removeInspection(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('inspectionId') inspectionId: string,
  ) {
    await this.ownership.removeInspection(ws.workspaceId, inspectionId, user.id)
  }

  @Patch('advisories/:advisoryId')
  @RequirePermission('ownership:write')
  async resolveAdvisory(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('advisoryId') advisoryId: string,
    @Body(zodBody(resolveAdvisorySchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.resolveAdvisory(
        ws.workspaceId,
        advisoryId,
        user.id,
        body as never,
      ),
    }
  }

  // --- insurance ---

  @Get('insurance-policies')
  @RequirePermission('ownership:read')
  async listInsurance(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const data = await this.ownership.listInsurance(ws.workspaceId, ws.role, vehicleId)
    return { data, meta: { total: data.length } }
  }

  @Post('vehicles/:vehicleId/insurance-policies')
  @RequirePermission('ownership:write')
  async createInsurance(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createInsuranceSchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.createInsurance(
        ws.workspaceId,
        vehicleId,
        user.id,
        ws.role,
        body as never,
      ),
    }
  }

  @Patch('insurance-policies/:policyId')
  @RequirePermission('ownership:write')
  async updateInsurance(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('policyId') policyId: string,
    @Body(zodBody(updateInsuranceSchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.updateInsurance(
        ws.workspaceId,
        policyId,
        user.id,
        ws.role,
        body as never,
      ),
    }
  }

  @Delete('insurance-policies/:policyId')
  @HttpCode(204)
  @RequirePermission('ownership:write')
  async removeInsurance(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('policyId') policyId: string,
  ) {
    await this.ownership.removeInsurance(ws.workspaceId, policyId, user.id)
  }

  // --- road tax ---

  @Get('road-tax')
  @RequirePermission('ownership:read')
  async listRoadTax(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const data = await this.ownership.listRoadTax(ws.workspaceId, ws.role, vehicleId)
    return { data, meta: { total: data.length } }
  }

  @Post('vehicles/:vehicleId/road-tax')
  @RequirePermission('ownership:write')
  async createRoadTax(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(createRoadTaxSchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.createRoadTax(
        ws.workspaceId,
        vehicleId,
        user.id,
        ws.role,
        body as never,
      ),
    }
  }

  @Patch('road-tax/:taxId')
  @RequirePermission('ownership:write')
  async updateRoadTax(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('taxId') taxId: string,
    @Body(zodBody(updateRoadTaxSchema)) body: unknown,
  ) {
    return {
      data: await this.ownership.updateRoadTax(
        ws.workspaceId,
        taxId,
        user.id,
        ws.role,
        body as never,
      ),
    }
  }

  @Delete('road-tax/:taxId')
  @HttpCode(204)
  @RequirePermission('ownership:write')
  async removeRoadTax(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('taxId') taxId: string,
  ) {
    await this.ownership.removeRoadTax(ws.workspaceId, taxId, user.id)
  }
}
