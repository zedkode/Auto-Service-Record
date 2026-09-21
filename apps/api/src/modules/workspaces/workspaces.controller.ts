import { Controller, Get } from '@nestjs/common'
import { WorkspacesService } from './workspaces.service.js'
import {
  CurrentWorkspace,
  RequirePermission,
  type WorkspaceContext,
} from '../../common/decorators/index.js'
import { Errors } from '../../common/errors.js'

@Controller('workspaces/:workspaceId')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @RequirePermission('workspace:read')
  async get(@CurrentWorkspace() ws: WorkspaceContext) {
    const data = await this.workspaces.get(ws.workspaceId)
    if (!data) throw Errors.workspaceNotFound()
    return { data: { ...data, role: ws.role } }
  }

  // GET members now lives in MembersController, next to the writes that change it.

  @Get('dashboard')
  @RequirePermission('workspace:read')
  async dashboard(@CurrentWorkspace() ws: WorkspaceContext) {
    return { data: await this.workspaces.dashboard(ws.workspaceId) }
  }
}
