/**
 * Admin RBAC (ADMIN-002, ARCHITECTURE.md §5.2).
 *
 * Deliberately disjoint from the workspace matrix: different roles, different
 * permissions, different function, different types. `SECURITY.md` §6 requires that the
 * two systems "share no table, no token, no guard and no code path", so nothing here is
 * generic over the customer side — a refactor that unified them would be a security
 * regression, not a cleanup.
 */

export const ADMIN_ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'BILLING', 'READ_ONLY'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export const ADMIN_PERMISSIONS = [
  /** Operational surfaces: queues, email delivery, system health, metrics. */
  'admin:metrics:read',
  'admin:queues:read',
  'admin:queues:manage',
  'admin:email:read',
  'admin:email:manage',
  'admin:audit:read',
  /** Customer records — metadata only; content requires a support access grant. */
  'admin:users:read',
  'admin:users:suspend',
  'admin:workspaces:read',
  /** Commercial. */
  'admin:billing:read',
  'admin:billing:manage',
  /** Platform administration. */
  'admin:flags:read',
  'admin:flags:manage',
  'admin:admins:manage',
  'admin:support_access:request',
  'admin:support_access:read',
  'admin:support_access:revoke',
] as const
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

const ADMIN_MATRIX: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  SUPER_ADMIN: new Set(ADMIN_PERMISSIONS),

  OPERATIONS: new Set<AdminPermission>([
    'admin:metrics:read',
    'admin:support_access:read',
    'admin:queues:read',
    'admin:queues:manage',
    'admin:email:read',
    'admin:email:manage',
    'admin:audit:read',
    // Read-only on flags: turning a feature on for everyone is a product decision.
    'admin:flags:read',
  ]),

  SUPPORT: new Set<AdminPermission>([
    'admin:metrics:read',
    'admin:email:read',
    'admin:audit:read',
    'admin:users:read',
    'admin:users:suspend',
    'admin:workspaces:read',
    'admin:support_access:request',
    // SUPPORT sees the grants, including other people's: a register nobody reads is not
    // oversight. Revoking someone else's is a SUPER_ADMIN act.
    'admin:support_access:read',
  ]),

  BILLING: new Set<AdminPermission>([
    'admin:metrics:read',
    'admin:users:read',
    'admin:workspaces:read',
    'admin:billing:read',
    'admin:billing:manage',
  ]),

  READ_ONLY: new Set<AdminPermission>([
    'admin:metrics:read',
    'admin:support_access:read',
    'admin:queues:read',
    'admin:email:read',
    'admin:audit:read',
  ]),
}

export function adminCan(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_MATRIX[role]?.has(permission) ?? false
}

export function adminPermissionsFor(role: AdminRole): AdminPermission[] {
  return [...(ADMIN_MATRIX[role] ?? [])]
}

/**
 * No admin role reads customer documents or vehicle content without an audited,
 * time-boxed support access grant (ARCHITECTURE.md §5.2). There is deliberately no
 * permission that grants it outright — the grant is the mechanism, and `SUPPORT` can
 * only *request* one.
 */
export const ADMIN_CONTENT_ACCESS_REQUIRES_GRANT = true
