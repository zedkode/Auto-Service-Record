import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { adminCan } from '@autoservices/permissions'
import { SupportAccessService, MAX_GRANT_HOURS } from './support-access.service.js'
import { WorkspaceInspectionService } from './workspace-inspection.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import { Public } from '../../common/decorators/index.js'
import { RequireAdmin } from '../../common/guards/admin-session.guard.js'
import { Errors } from '../../common/errors.js'
import type { AdminIdentity } from '../admin-auth/admin-auth.service.js'

const requestSchema = z.object({
  workspaceId: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
  scope: z.enum(['VEHICLE_CONTENT', 'DOCUMENTS', 'FULL']),
  hours: z.number().int().min(1).max(MAX_GRANT_HOURS).default(4),
})

const admin = (req: FastifyRequest): AdminIdentity =>
  (req as unknown as { admin: AdminIdentity }).admin

/**
 * SEC-018 / ADMIN-004 — support access, and the customer data it opens.
 *
 * The grant endpoints and the endpoints they protect live together deliberately: a grant
 * with nothing behind it proves nothing, and an inspection endpoint without a gate is the
 * thing this task exists to prevent.
 */
@Controller('admin')
export class SupportAccessController {
  constructor(
    private readonly grants: SupportAccessService,
    private readonly inspection: WorkspaceInspectionService,
  ) {}

  @Public()
  @Post('support-access')
  @RequireAdmin('admin:support_access:request')
  async request(@Req() req: FastifyRequest, @Body(zodBody(requestSchema)) body: unknown) {
    const input = body as z.infer<typeof requestSchema>
    return {
      data: await this.grants.request({
        adminUserId: admin(req).id,
        workspaceId: input.workspaceId,
        reason: input.reason,
        scope: input.scope,
        hours: input.hours,
      }),
    }
  }

  @Public()
  @Get('support-access')
  @RequireAdmin('admin:support_access:read')
  async list(@Query('includeExpired') includeExpired?: string) {
    const data = await this.grants.list({ includeExpired: includeExpired === 'true' })
    return { data, meta: { total: data.length } }
  }

  /**
   * Revoking your own grant needs no special right — giving access back early is always
   * allowed. Revoking somebody else's is a SUPER_ADMIN act.
   */
  @Public()
  @Delete('support-access/:grantId')
  @RequireAdmin('admin:support_access:read')
  async revoke(@Req() req: FastifyRequest, @Param('grantId') grantId: string) {
    const me = admin(req)
    const all = await this.grants.list({ includeExpired: true })
    const target = all.find((g) => g.id === grantId)
    if (!target) throw Errors.notFound('Grant')
    if (target.adminUserId !== me.id && !adminCan(me.role, 'admin:support_access:revoke')) {
      throw Errors.permissionDenied('revoke another admin’s access')
    }
    return { data: await this.grants.revoke(grantId, me.id) }
  }

  // --- what a grant opens (ADMIN-004) ---

  /**
   * Workspace metadata: counts and plan-shaped facts, no customer content. Readable with
   * `admin:workspaces:read` alone, because answering "does this account exist and how big
   * is it?" is most of support without touching anything private.
   */
  @Public()
  @Get('workspaces/:workspaceId')
  @RequireAdmin('admin:workspaces:read')
  async workspace(@Param('workspaceId') workspaceId: string) {
    return { data: await this.inspection.summary(workspaceId) }
  }

  @Public()
  @Get('workspaces/:workspaceId/vehicles')
  @RequireAdmin('admin:workspaces:read')
  async vehicles(@Req() req: FastifyRequest, @Param('workspaceId') workspaceId: string) {
    await this.grants.assertAccess({
      adminUserId: admin(req).id,
      workspaceId,
      scope: 'VEHICLE_CONTENT',
      action: 'support_access.used.vehicles',
      resourceType: 'workspace',
      resourceId: workspaceId,
    })
    return { data: await this.inspection.vehicles(workspaceId) }
  }

  @Public()
  @Get('workspaces/:workspaceId/documents')
  @RequireAdmin('admin:workspaces:read')
  async documents(@Req() req: FastifyRequest, @Param('workspaceId') workspaceId: string) {
    await this.grants.assertAccess({
      adminUserId: admin(req).id,
      workspaceId,
      scope: 'DOCUMENTS',
      action: 'support_access.used.documents',
      resourceType: 'workspace',
      resourceId: workspaceId,
    })
    return { data: await this.inspection.documents(workspaceId) }
  }
}
