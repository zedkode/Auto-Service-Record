/**
 * TENANT ISOLATION — LAYER 2 (ARCHITECTURE.md §4, SECURITY.md §3)
 *
 * This is the most important file in the codebase.
 *
 * Every query against a tenant-owned model is forced to carry a `workspaceId` predicate,
 * and every create is forced to carry the caller's `workspaceId`. The set of tenant-owned
 * models is DERIVED FROM THE SCHEMA (any model with a `workspaceId` field) rather than
 * hand-maintained — a hand-maintained list is exactly what gets forgotten when someone
 * adds a table late on a Friday (DECISIONS.md D-009).
 *
 * Layer 1 is the WorkspaceGuard; layer 3 is the composite foreign keys in schema.prisma.
 * All three exist because a single missed `where` clause is the highest-severity bug
 * this product can ship.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

/** Models carrying a `workspaceId` scalar, read straight off the generated DMMF. */
function deriveTenantModels(): ReadonlySet<string> {
  const models = new Set<string>()
  for (const model of Prisma.dmmf.datamodel.models) {
    const hasWorkspaceId = model.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar')
    // AuditLog carries a NULLABLE workspaceId (system events have no tenant), so it is
    // handled by the admin/system path rather than scoped reads.
    if (hasWorkspaceId && model.name !== 'AuditLog') models.add(model.name)
  }
  return models
}

export const TENANT_MODELS = deriveTenantModels()

/**
 * Operations taking a FILTER `where`. AND-composition is used here so a caller's filter
 * is preserved and narrowed, never replaced.
 */
const FILTER_WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

/**
 * Operations taking a UNIQUE `where`. Prisma requires at least one unique field here and
 * rejects an `AND` wrapper outright, so the scope is merged in instead. Merging is still
 * safe because `workspaceId` is applied LAST: a caller-supplied value can only ever be
 * replaced by the bound scope, never widen it. Prisma's extended-where-unique support
 * permits the extra non-unique predicate alongside the unique one.
 */
const UNIQUE_WHERE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete'])
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn'])
const UPSERT_OPS = new Set(['upsert'])

export type TenantPrismaClient = ReturnType<typeof forWorkspace>

/**
 * Returns a Prisma client bound to one workspace. Queries it issues cannot see or touch
 * another workspace's rows.
 */
export function forWorkspace(prisma: PrismaClient, workspaceId: string) {
  if (!workspaceId) {
    // Fail closed. A missing workspace must never degrade into an unscoped client.
    throw new Error('forWorkspace() requires a workspaceId')
  }

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args)

          const a = args as Record<string, unknown>

          if (FILTER_WHERE_OPS.has(operation)) {
            // AND-composition, never a spread merge: a caller-supplied `workspaceId`
            // must not be able to widen or replace the bound scope.
            const existing = a.where as Record<string, unknown> | undefined
            a.where = existing ? { AND: [existing, { workspaceId }] } : { workspaceId }
          }

          if (UNIQUE_WHERE_OPS.has(operation)) {
            const existing = (a.where ?? {}) as Record<string, unknown>
            a.where = { ...existing, workspaceId }
          }

          if (CREATE_OPS.has(operation)) {
            const data = a.data
            if (Array.isArray(data)) {
              a.data = data.map((row: Record<string, unknown>) => ({ ...row, workspaceId }))
            } else if (data && typeof data === 'object') {
              a.data = { ...(data as Record<string, unknown>), workspaceId }
            }
          }

          if (UPSERT_OPS.has(operation)) {
            // upsert also takes a unique where.
            const existing = (a.where ?? {}) as Record<string, unknown>
            a.where = { ...existing, workspaceId }
            if (a.create && typeof a.create === 'object') {
              a.create = { ...(a.create as Record<string, unknown>), workspaceId }
            }
          }

          return query(a)
        },
      },
    },
  })
}

/**
 * Explicit, greppable, lint-restricted escape hatch for platform admin and system jobs
 * that legitimately cross workspaces. Restricted to apps/api admin modules and the
 * worker by the ESLint `no-restricted-syntax` rule.
 */
export function unscoped(prisma: PrismaClient): PrismaClient {
  return prisma
}
