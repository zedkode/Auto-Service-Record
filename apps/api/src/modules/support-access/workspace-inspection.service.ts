import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service.js'
import { Errors } from '../../common/errors.js'

/**
 * ADMIN-004 — what staff may look at, split by how private it is.
 *
 * `summary` is metadata: counts, dates, plan-shaped facts. It answers most support
 * questions and needs no grant. Everything else here is customer content and is only
 * reachable through a support access grant (SEC-018).
 *
 * Reads go through the RAW client with an explicit workspace predicate, because there is
 * no tenant context on an admin request — the tenant IS the thing being inspected. Each
 * query is therefore written with its `workspaceId` filter in plain sight.
 */
@Injectable()
export class WorkspaceInspectionService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(workspaceId: string) {
    const ws = await this.prisma.raw.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      include: {
        _count: { select: { members: true, vehicles: true } },
        owner: { select: { email: true, status: true, createdAt: true } },
      },
    })
    if (!ws) throw Errors.workspaceNotFound()

    const [documents, services, lastActivity] = await Promise.all([
      this.prisma.raw.document.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.raw.serviceRecord.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.raw.auditLog.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, action: true },
      }),
    ])

    return {
      id: ws.id,
      name: ws.name,
      type: ws.type,
      createdAt: ws.createdAt.toISOString(),
      ownerEmail: ws.owner?.email ?? null,
      ownerStatus: ws.owner?.status ?? null,
      counts: {
        members: ws._count.members,
        vehicles: ws._count.vehicles,
        documents,
        services,
      },
      lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
      lastAction: lastActivity?.action ?? null,
    }
  }

  /** Customer content. Reachable only behind a VEHICLE_CONTENT or FULL grant. */
  async vehicles(workspaceId: string) {
    const rows = await this.prisma.raw.vehicle.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        manufacturer: true,
        model: true,
        registrationNumber: true,
        modelYear: true,
        status: true,
        currentOdometer: true,
        currentOdometerUnit: true,
        createdAt: true,
      },
    })
    return rows.map((v) => ({
      id: v.id,
      name: `${v.manufacturer} ${v.model}`,
      registrationNumber: v.registrationNumber,
      modelYear: v.modelYear,
      status: v.status,
      currentOdometer: v.currentOdometer,
      currentOdometerUnit: v.currentOdometerUnit,
      createdAt: v.createdAt.toISOString(),
    }))
  }

  /**
   * Document METADATA only. There is deliberately no download endpoint here: a grant
   * lets staff see that a file exists and help a customer find it, not read its contents
   * from the console (SECURITY.md §13).
   */
  async documents(workspaceId: string) {
    const rows = await this.prisma.raw.document.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        originalFilename: true,
        contentType: true,
        byteSize: true,
        documentType: true,
        status: true,
        scanStatus: true,
        vehicleId: true,
        createdAt: true,
      },
    })
    return rows.map((d) => ({
      id: d.id,
      filename: d.originalFilename,
      contentType: d.contentType,
      byteSize: d.byteSize,
      documentType: d.documentType,
      status: d.status,
      scanStatus: d.scanStatus,
      vehicleId: d.vehicleId,
      createdAt: d.createdAt.toISOString(),
      // No storage key and no download URL: seeing that a file exists is support;
      // reading it is not.
    }))
  }
}
