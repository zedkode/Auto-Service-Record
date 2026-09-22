/**
 * Pure RBAC evaluation. No I/O, no database, no environment access — which is what makes
 * it exhaustively testable and safe to ship to the browser.
 *
 * The frontend uses this only to hide affordances. The server decides.
 * Matrix source of truth: ARCHITECTURE.md §5.1.
 */
import type { WorkspaceRole } from '@autoservices/types'

export const PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:billing',
  'member:invite',
  'member:update_role',
  'member:remove',
  'vehicle:read',
  'vehicle:create',
  'vehicle:update',
  'vehicle:delete',
  'service:read',
  'service:write',
  'odometer:write',
  'ownership:read',
  'ownership:write',
  'fuel:write',
  'expense:read',
  'expense:write',
  'document:read',
  'document:write',
  'document:delete',
  'reminder:manage',
  'report:read',
  /**
   * Bulk export is deliberately NOT part of `report:read`. A VIEWER can read anything on
   * screen; taking the whole workspace away as a file is a different act, and it is the
   * one a data-protection review asks about. Granted to OWNER, ADMIN and EDITOR — the
   * roles that already write the data — and withheld from VIEWER.
   */
  'export:create',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * DRIVER deliberately excludes financial visibility (expense:read, report:read) and
 * write access to vehicle records. Until granular per-vehicle access ships, a DRIVER
 * sees all workspace vehicles but no money. See ARCHITECTURE.md §5.1 note 2.
 */
const MATRIX: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set<Permission>([
    'workspace:read',
    'workspace:update',
    'member:invite',
    'member:update_role',
    'member:remove',
    'vehicle:read',
    'vehicle:create',
    'vehicle:update',
    'vehicle:delete',
    'service:read',
    'service:write',
    'odometer:write',
    'ownership:read',
    'ownership:write',
    'fuel:write',
    'expense:read',
    'expense:write',
    'document:read',
    'document:write',
    'document:delete',
    'reminder:manage',
    'report:read',
    'export:create',
  ]),
  EDITOR: new Set<Permission>([
    'workspace:read',
    'vehicle:read',
    'vehicle:create',
    'vehicle:update',
    'service:read',
    'service:write',
    'odometer:write',
    'ownership:read',
    'ownership:write',
    'fuel:write',
    'expense:read',
    'expense:write',
    'document:read',
    'document:write',
    'reminder:manage',
    'report:read',
    'export:create',
  ]),
  DRIVER: new Set<Permission>([
    'workspace:read',
    'vehicle:read',
    'service:read',
    'odometer:write',
    // A DRIVER can see that the MOT or insurance has expired — driving without either is
    // illegal, so withholding it would be a safety failure, not a privacy win. The money
    // on those records is filtered separately by expense:read (DECISIONS.md D-050).
    'ownership:read',
    'fuel:write',
    'document:read',
  ]),
  VIEWER: new Set<Permission>([
    'workspace:read',
    'vehicle:read',
    'service:read',
    'ownership:read',
    'expense:read',
    'document:read',
    'report:read',
  ]),
}

export interface PermissionContext {
  /** Role of the member being acted upon, for member-management operations. */
  targetRole?: WorkspaceRole
}

export function can(
  role: WorkspaceRole,
  permission: Permission,
  ctx: PermissionContext = {},
): boolean {
  if (!MATRIX[role]?.has(permission)) return false

  // An ADMIN may never modify or remove an OWNER. Only an OWNER outranks an OWNER.
  if (
    (permission === 'member:update_role' || permission === 'member:remove') &&
    ctx.targetRole === 'OWNER' &&
    role !== 'OWNER'
  ) {
    return false
  }
  return true
}

export function permissionsFor(role: WorkspaceRole): Permission[] {
  return [...(MATRIX[role] ?? [])]
}

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  EDITOR: 3,
  DRIVER: 2,
  VIEWER: 1,
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  DRIVER: 'Driver',
  VIEWER: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: 'Full control, including billing and deleting the workspace.',
  ADMIN: 'Manage the workspace, its vehicles and its members.',
  EDITOR: 'Add and edit vehicles, services and costs.',
  DRIVER: 'Log mileage and fuel. Cannot see costs or reports.',
  VIEWER: 'Read-only access.',
}

// Disjoint from the workspace matrix above, by design (SECURITY.md §6).
export * from './admin.js'
