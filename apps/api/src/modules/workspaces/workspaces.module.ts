import { Module } from '@nestjs/common'
import { WorkspacesController } from './workspaces.controller.js'
import { WorkspacesService } from './workspaces.service.js'
import { VehiclesController } from '../vehicles/vehicles.controller.js'
import { VehiclesService } from '../vehicles/vehicles.service.js'
import { TimelineService } from '../vehicles/timeline/timeline.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { MembersController } from './members/members.controller.js'
import { InvitationsController } from './members/invitations.controller.js'
import { MembersService } from './members/members.service.js'
import { InvitationsService } from './members/invitations.service.js'

@Module({
  controllers: [WorkspacesController, VehiclesController, MembersController, InvitationsController],
  providers: [
    WorkspacesService,
    VehiclesService,
    TimelineService,
    MembersService,
    InvitationsService,
    AuditService,
  ],
})
export class WorkspacesModule {}
