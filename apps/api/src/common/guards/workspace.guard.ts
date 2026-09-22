import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { can, type Permission } from '@autoservices/permissions'
import { PrismaService } from '../prisma.service.js'
import { Errors } from '../errors.js'
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../decorators/index.js'
import { requestContext } from '../context/request-context.js'

/**
 * TENANT ISOLATION — LAYER 1b (ARCHITECTURE.md §4, SECURITY.md §3).
 *
 * Resolves :workspaceId from the route and requires an ACTIVE membership.
 *
 * A non-member gets 404, NOT 403. A 403 would confirm that the workspace exists,
 * which is an enumeration oracle (DECISIONS.md D-012).
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context.switchToHttp().getRequest()
    const workspaceId: string | undefined = req.params?.workspaceId
    if (!workspaceId) return true // Route is not workspace-scoped.

    const user = req.authUser
    if (!user) throw Errors.unauthenticated()

    // Joined for the same reason as the session lookup: this is the second fixed cost on
    // every workspace-scoped request, and two round trips here is one too many.
    const membership = await this.prisma.raw.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id, status: 'ACTIVE' },
      include: { workspace: true },
      relationLoadStrategy: 'join',
    })

    // Not a member, or the workspace is soft-deleted: indistinguishable from not existing.
    if (!membership || membership.workspace.deletedAt) throw Errors.workspaceNotFound()

    req.workspaceContext = {
      workspaceId,
      role: membership.role,
      name: membership.workspace.name,
    }

    // Permission check — only meaningful once membership is established.
    const required = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ])
    if (required && !can(membership.role, required)) {
      throw Errors.permissionDenied(required.replace(':', ' '))
    }

    const store = requestContext.getStore()
    if (store) {
      store.workspaceId = workspaceId
      store.role = membership.role
    }

    return true
  }
}
