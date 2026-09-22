import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'
import { ExportsService, type CreateExportInput } from './exports.service.js'

@Controller('workspaces/:workspaceId/exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  @RequirePermission('report:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.exports.list(ws.workspaceId) }
  }

  @Post()
  // Not `report:read`: taking the workspace away as a file is a different act from
  // reading it on screen, so a VIEWER cannot do it (packages/permissions).
  @RequirePermission('export:create')
  @HttpCode(202)
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Body() body: CreateExportInput,
  ) {
    return { data: await this.exports.create(ws.workspaceId, user.id, body) }
  }

  @Get(':exportId')
  @RequirePermission('report:read')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('exportId') exportId: string) {
    return { data: await this.exports.get(ws.workspaceId, exportId) }
  }

  /**
   * POST rather than GET: it mints a credential and writes an audit entry, so it must not
   * be prefetched by a browser or replayed from history.
   */
  @Post(':exportId/download')
  @RequirePermission('report:read')
  @HttpCode(200)
  async download(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('exportId') exportId: string,
  ) {
    return { data: await this.exports.downloadUrl(ws.workspaceId, exportId, user.id) }
  }
}
