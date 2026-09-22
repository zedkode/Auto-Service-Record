import { describe, it, expect } from 'vitest'
import { can, PERMISSIONS, permissionsFor, type Permission } from './index.js'
import type { WorkspaceRole } from '@autoservices/types'

const ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'DRIVER', 'VIEWER']

/**
 * The full role x permission matrix, asserted explicitly. This mirrors ARCHITECTURE.md §5.1.
 * Changing the matrix without changing this table fails the build — which is the point.
 */
const EXPECTED: Record<WorkspaceRole, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [
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
  ],
  EDITOR: [
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
  ],
  DRIVER: [
    'workspace:read',
    'vehicle:read',
    'service:read',
    'odometer:write',
    'ownership:read',
    'fuel:write',
    'document:read',
  ],
  VIEWER: [
    'workspace:read',
    'vehicle:read',
    'service:read',
    'ownership:read',
    'expense:read',
    'document:read',
    'report:read',
  ],
}

describe('workspace RBAC matrix', () => {
  for (const role of ROLES) {
    for (const permission of PERMISSIONS) {
      const expected = EXPECTED[role].includes(permission)
      it(`${role} ${expected ? 'CAN' : 'cannot'} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected)
      })
    }
  }
})

describe('OWNER protection', () => {
  it('ADMIN cannot change an OWNER role', () => {
    expect(can('ADMIN', 'member:update_role', { targetRole: 'OWNER' })).toBe(false)
  })
  it('ADMIN cannot remove an OWNER', () => {
    expect(can('ADMIN', 'member:remove', { targetRole: 'OWNER' })).toBe(false)
  })
  it('ADMIN can still manage non-owners', () => {
    expect(can('ADMIN', 'member:remove', { targetRole: 'EDITOR' })).toBe(true)
  })
  it('OWNER can act on an OWNER (ownership transfer)', () => {
    expect(can('OWNER', 'member:update_role', { targetRole: 'OWNER' })).toBe(true)
  })
})

describe('financial data is hidden from DRIVER', () => {
  it.each(['expense:read', 'report:read', 'ownership:write'] as Permission[])(
    'DRIVER cannot %s',
    (p) => {
      expect(can('DRIVER', p)).toBe(false)
    },
  )
})

describe('permissionsFor', () => {
  it('returns every permission for OWNER', () => {
    expect(permissionsFor('OWNER')).toHaveLength(PERMISSIONS.length)
  })
})
