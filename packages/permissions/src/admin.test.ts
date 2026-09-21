import { describe, expect, it } from 'vitest'
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  adminCan,
  adminPermissionsFor,
  type AdminPermission,
  type AdminRole,
} from './admin.js'
import { PERMISSIONS, can } from './index.js'

/** The complete expected matrix, written out rather than derived from the source. */
const EXPECTED: Record<AdminRole, AdminPermission[]> = {
  SUPER_ADMIN: [...ADMIN_PERMISSIONS],
  OPERATIONS: [
    'admin:metrics:read',
    'admin:support_access:read',
    'admin:queues:read',
    'admin:queues:manage',
    'admin:email:read',
    'admin:email:manage',
    'admin:audit:read',
    'admin:flags:read',
  ],
  SUPPORT: [
    'admin:metrics:read',
    'admin:email:read',
    'admin:audit:read',
    'admin:users:read',
    'admin:users:suspend',
    'admin:workspaces:read',
    'admin:support_access:request',
    'admin:support_access:read',
  ],
  BILLING: [
    'admin:metrics:read',
    'admin:users:read',
    'admin:workspaces:read',
    'admin:billing:read',
    'admin:billing:manage',
  ],
  READ_ONLY: [
    'admin:metrics:read',
    'admin:queues:read',
    'admin:email:read',
    'admin:audit:read',
    'admin:support_access:read',
  ],
}

describe('admin RBAC matrix', () => {
  for (const role of ADMIN_ROLES) {
    for (const permission of ADMIN_PERMISSIONS) {
      const expected = EXPECTED[role].includes(permission)
      it(`${role} ${expected ? 'can' : 'cannot'} ${permission}`, () => {
        expect(adminCan(role, permission)).toBe(expected)
      })
    }
  }
})

describe('least privilege', () => {
  it('only SUPER_ADMIN manages other admins', () => {
    for (const role of ADMIN_ROLES) {
      expect(adminCan(role, 'admin:admins:manage')).toBe(role === 'SUPER_ADMIN')
    }
  })

  it('READ_ONLY can mutate nothing', () => {
    const mutations = ADMIN_PERMISSIONS.filter(
      (p) =>
        p.endsWith(':manage') ||
        p.endsWith(':suspend') ||
        p.endsWith(':request') ||
        p.endsWith(':revoke'),
    )
    for (const p of mutations) expect(adminCan('READ_ONLY', p)).toBe(false)
  })

  it('only SUPER_ADMIN revokes another admin’s support grant', () => {
    for (const role of ADMIN_ROLES) {
      expect(adminCan(role, 'admin:support_access:revoke')).toBe(role === 'SUPER_ADMIN')
    }
  })

  it('BILLING cannot request support access', () => {
    expect(adminCan('BILLING', 'admin:support_access:request')).toBe(false)
  })

  it('BILLING cannot reach operational controls or the audit log', () => {
    for (const p of [
      'admin:queues:manage',
      'admin:email:manage',
      'admin:audit:read',
      'admin:flags:manage',
    ] as AdminPermission[]) {
      expect(adminCan('BILLING', p)).toBe(false)
    }
  })

  it('SUPPORT cannot touch billing', () => {
    expect(adminCan('SUPPORT', 'admin:billing:read')).toBe(false)
    expect(adminCan('SUPPORT', 'admin:billing:manage')).toBe(false)
  })

  it('OPERATIONS can read flags but not change them', () => {
    expect(adminCan('OPERATIONS', 'admin:flags:read')).toBe(true)
    expect(adminCan('OPERATIONS', 'admin:flags:manage')).toBe(false)
  })

  it('no role can read customer content outright — a grant is the only route', () => {
    // There is intentionally no 'admin:documents:read' permission to hold.
    expect(ADMIN_PERMISSIONS.some((p) => p.includes('document'))).toBe(false)
    expect(ADMIN_PERMISSIONS.some((p) => p.includes('vehicle'))).toBe(false)
  })

  it('every role can at least see the metrics it is called in to look at', () => {
    for (const role of ADMIN_ROLES) expect(adminCan(role, 'admin:metrics:read')).toBe(true)
  })
})

describe('the two RBAC systems are disjoint', () => {
  it('shares no permission name with the workspace matrix', () => {
    const workspace = new Set<string>(PERMISSIONS)
    for (const p of ADMIN_PERMISSIONS) expect(workspace.has(p)).toBe(false)
  })

  it('shares no role name with the workspace matrix', () => {
    // OWNER/ADMIN/EDITOR/DRIVER/VIEWER vs SUPER_ADMIN/OPERATIONS/…: a workspace "ADMIN"
    // is a customer, and must never be confused with a member of staff.
    const workspaceRoles = ['OWNER', 'ADMIN', 'EDITOR', 'DRIVER', 'VIEWER']
    for (const r of ADMIN_ROLES) expect(workspaceRoles).not.toContain(r)
  })

  it('an admin role is not accepted by the workspace evaluator', () => {
    // @ts-expect-error — deliberately passing an admin role where a workspace role is
    // required, to prove the two cannot be swapped even by mistake.
    expect(can('SUPER_ADMIN', 'vehicle:read')).toBe(false)
  })

  it('adminPermissionsFor returns exactly the matrix row', () => {
    for (const role of ADMIN_ROLES) {
      expect(adminPermissionsFor(role).sort()).toEqual([...EXPECTED[role]].sort())
    }
  })
})
