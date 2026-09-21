import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import type { WorkspaceRole } from '@autoservices/types'
import type { Permission } from '@autoservices/permissions'

/** Marks a route as intentionally unauthenticated. Routes need this or @RequirePermission. */
export const IS_PUBLIC = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC, true)

export const REQUIRED_PERMISSION = 'requiredPermission'
export const RequirePermission = (p: Permission) => SetMetadata(REQUIRED_PERMISSION, p)

export interface AuthedUser {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  timezone: string
  preferredDistanceUnit: 'MILES' | 'KILOMETERS'
  preferredCurrency: string
}

export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): AuthedUser => {
    return ctx.switchToHttp().getRequest().authUser
  },
)

export interface WorkspaceContext {
  workspaceId: string
  role: WorkspaceRole
  name: string
}

export const CurrentWorkspace = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): WorkspaceContext => {
    return ctx.switchToHttp().getRequest().workspaceContext
  },
)
