import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'
import { adminCan, type AdminPermission } from '@autoservices/permissions'
import {
  AdminAuthService,
  type AdminIdentity,
} from '../../modules/admin-auth/admin-auth.service.js'
import { Errors } from '../errors.js'

export const ADMIN_COOKIE_NAME = 'as_admin_session'
export const REQUIRED_ADMIN_PERMISSION = 'requiredAdminPermission'
export const ADMIN_PUBLIC = 'adminPublic'

/** Marks an admin route as reachable without a session (the login endpoint itself). */
export const AdminPublic = () => SetMetadata(ADMIN_PUBLIC, true)
export const RequireAdmin = (permission: AdminPermission) =>
  SetMetadata(REQUIRED_ADMIN_PERMISSION, permission)

/**
 * ADMIN-001/002 — the staff realm.
 *
 * A separate cookie, a separate table and a separate guard from the customer session.
 * A customer's cookie is never consulted here and cannot authenticate an admin route,
 * which is the whole point of keeping the two realms disjoint (SECURITY.md §6).
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & Record<string, unknown>>()

    // Registered globally, but only the staff surface is its business. Customer routes
    // are governed by the customer session guard and must not be affected by this one.
    const url: string = (req as { url?: string }).url ?? ''
    if (!url.startsWith('/api/v1/admin')) return true

    if (
      this.reflector.getAllAndOverride<boolean>(ADMIN_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true
    }

    const token = (req as { cookies?: Record<string, string> }).cookies?.[ADMIN_COOKIE_NAME]
    // 404, not 401: the admin surface does not confirm its own existence to an
    // unauthenticated prober.
    if (!token) throw Errors.notFound('Route')

    const admin = await this.adminAuth.resolveSession(token)
    if (!admin) throw Errors.notFound('Route')

    const required = this.reflector.getAllAndOverride<AdminPermission>(REQUIRED_ADMIN_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ])
    // A route with no declared permission is a mistake, not a public route: refuse it
    // rather than defaulting open.
    if (!required) throw Errors.notFound('Route')
    if (!adminCan(admin.role, required)) throw Errors.permissionDenied('do that')
    ;(req as { admin?: AdminIdentity }).admin = admin
    return true
  }
}
