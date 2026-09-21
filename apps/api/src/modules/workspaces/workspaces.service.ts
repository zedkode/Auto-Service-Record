import { Injectable } from '@nestjs/common'
import type { Prisma, Vehicle } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service.js'

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(workspaceId: string) {
    const ws = await this.prisma.raw.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      include: { _count: { select: { members: true, vehicles: true } } },
    })
    if (!ws) return null
    return {
      id: ws.id,
      name: ws.name,
      type: ws.type,
      defaultCurrency: ws.defaultCurrency,
      defaultDistanceUnit: ws.defaultDistanceUnit,
      timezone: ws.timezone,
      memberCount: ws._count.members,
      vehicleCount: ws._count.vehicles,
      createdAt: ws.createdAt.toISOString(),
    }
  }

  async members(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const members = await db.workspaceMember.findMany({
      where: { status: 'ACTIVE' },
      include: { user: { include: { profile: true } } },
      orderBy: { createdAt: 'asc' },
    })
    type MemberWithUser = Prisma.WorkspaceMemberGetPayload<{
      include: { user: { include: { profile: true } } }
    }>

    return members.map((m: MemberWithUser) => ({
      id: m.id,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt?.toISOString() ?? null,
      user: {
        id: m.user.id,
        email: m.user.email,
        displayName: m.user.profile?.displayName ?? m.user.email,
      },
    }))
  }

  /**
   * Dashboard payload. Deliberately NOT a pile of statistics — every number here is one
   * the user can act on (UI_UX.md §5.1, PRODUCT.md §8).
   */
  async dashboard(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)

    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    const activeVehicles = vehicles.filter((v: Vehicle) => v.status === 'ACTIVE')

    const staleThreshold = new Date()
    staleThreshold.setUTCDate(staleThreshold.getUTCDate() - 45)

    // Attention is assembled from every subsystem that can genuinely demand action.
    // It used to report stale mileage alone, with a comment saying maintenance and
    // expiry tracking "arrive in Phases 4 and 6" — both now exist, so a vehicle with an
    // expired MOT was showing nothing at all on the first screen the user sees.
    const attention: Array<{
      vehicleId: string
      vehicleName: string
      registrationNumber: string | null
      severity: 'OVERDUE' | 'DUE_SOON'
      title: string
      detail: string
      action: { label: string; href: string }
    }> = []

    const nameOf = (v: { manufacturer: string; model: string }) => `${v.manufacturer} ${v.model}`
    const vehicleSelect = {
      id: true,
      manufacturer: true,
      model: true,
      registrationNumber: true,
    } as const

    // --- maintenance that is due or overdue ---
    const dueRules = await db.maintenanceRule.findMany({
      where: {
        isActive: true,
        status: { in: ['DUE_SOON', 'DUE', 'OVERDUE'] },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: { vehicle: { select: vehicleSelect } },
      orderBy: { status: 'desc' },
    })
    for (const rule of dueRules) {
      attention.push({
        vehicleId: rule.vehicleId,
        vehicleName: nameOf(rule.vehicle),
        registrationNumber: rule.vehicle.registrationNumber,
        severity: rule.status === 'OVERDUE' ? 'OVERDUE' : 'DUE_SOON',
        title: rule.name,
        detail: rule.status === 'OVERDUE' ? 'Overdue for service' : 'Due for service soon',
        action: { label: 'View', href: `/vehicles/${rule.vehicleId}?tab=maintenance` },
      })
    }

    // --- expiring or expired obligations (OWN-001/002/003) ---
    const today = new Date(new Date().toISOString().slice(0, 10))
    const horizon = new Date(today)
    horizon.setUTCDate(horizon.getUTCDate() + 90)
    const expiringWhere = {
      deletedAt: null,
      expiresOn: { not: null, lte: horizon },
      vehicle: { deletedAt: null, status: 'ACTIVE' as const },
    }

    const [inspections, policies, taxes] = await Promise.all([
      db.vehicleInspection.findMany({
        where: expiringWhere,
        include: { vehicle: { select: vehicleSelect } },
        orderBy: { expiresOn: 'desc' },
      }),
      db.insurancePolicy.findMany({
        where: expiringWhere,
        include: { vehicle: { select: vehicleSelect } },
        orderBy: { expiresOn: 'desc' },
      }),
      db.roadTaxRecord.findMany({
        where: expiringWhere,
        include: { vehicle: { select: vehicleSelect } },
        orderBy: { expiresOn: 'desc' },
      }),
    ])

    /**
     * Only the record protecting each vehicle counts. Years of past MOTs would otherwise
     * each raise their own "expired" item — the same rule the reminder sources apply
     * (DECISIONS.md D-051), kept consistent so the dashboard and the reminders agree.
     */
    const currentPerVehicle = <T extends { vehicleId: string; expiresOn: Date | null }>(
      rows: T[],
    ) => {
      const best = new Map<string, T>()
      for (const row of rows) {
        if (!row.expiresOn) continue
        const held = best.get(row.vehicleId)
        if (!held || !held.expiresOn || row.expiresOn > held.expiresOn) best.set(row.vehicleId, row)
      }
      return [...best.values()]
    }

    const daysUntil = (d: Date) => Math.round((d.getTime() - today.getTime()) / 86_400_000)
    const expiryItem = (
      row: {
        vehicleId: string
        expiresOn: Date | null
        vehicle: { manufacturer: string; model: string; registrationNumber: string | null }
      },
      label: string,
    ) => {
      const remaining = daysUntil(row.expiresOn!)
      const overdue = remaining < 0
      return {
        vehicleId: row.vehicleId,
        vehicleName: nameOf(row.vehicle),
        registrationNumber: row.vehicle.registrationNumber,
        severity: (overdue ? 'OVERDUE' : 'DUE_SOON') as 'OVERDUE' | 'DUE_SOON',
        title: `${label} ${overdue ? 'has expired' : 'expires soon'}`,
        detail: overdue
          ? `Expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? '' : 's'} ago.`
          : `${remaining} day${remaining === 1 ? '' : 's'} left.`,
        action: { label: 'View', href: `/vehicles/${row.vehicleId}?tab=ownership` },
      }
    }

    for (const row of currentPerVehicle(inspections)) {
      attention.push(
        expiryItem(row, row.inspectionType === 'OTHER' ? 'Inspection' : row.inspectionType),
      )
    }
    for (const row of currentPerVehicle(policies)) attention.push(expiryItem(row, 'Insurance'))
    for (const row of currentPerVehicle(taxes)) attention.push(expiryItem(row, 'Road tax'))

    // --- stale mileage, which makes every distance-based projection unreliable ---
    for (const v of activeVehicles) {
      if (v.currentOdometerAt && v.currentOdometerAt >= staleThreshold) continue
      attention.push({
        vehicleId: v.id,
        vehicleName: nameOf(v),
        registrationNumber: v.registrationNumber,
        severity: 'DUE_SOON',
        title: v.currentOdometerAt ? 'Mileage is out of date' : 'No mileage recorded yet',
        detail: v.currentOdometerAt
          ? `Last updated ${Math.floor((Date.now() - v.currentOdometerAt.getTime()) / 86_400_000)} days ago. Update it to keep reminders accurate.`
          : 'Add a reading so maintenance reminders can be calculated.',
        action: { label: 'Update mileage', href: `/vehicles/${v.id}?tab=mileage` },
      })
    }

    // Overdue first: the panel is read top-down and the worst thing should be at the top.
    attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'OVERDUE' ? -1 : 1))

    // --- recent activity across every source that writes history ---
    const [recentOdometer, recentServices, recentInspections] = await Promise.all([
      db.odometerEntry.findMany({
        orderBy: [{ recordedOn: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        include: { vehicle: { select: { id: true, manufacturer: true, model: true } } },
      }),
      db.serviceRecord.findMany({
        where: { deletedAt: null },
        orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        include: { vehicle: { select: { id: true, manufacturer: true, model: true } } },
      }),
      db.vehicleInspection.findMany({
        where: { deletedAt: null },
        orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        include: { vehicle: { select: { id: true, manufacturer: true, model: true } } },
      }),
    ])

    const recentActivity = [
      ...recentOdometer.map((e) => ({
        id: e.id,
        type: 'ODOMETER' as const,
        occurredOn: e.recordedOn.toISOString().slice(0, 10),
        title: `Mileage updated to ${e.value.toLocaleString()} ${e.unit === 'MILES' ? 'mi' : 'km'}`,
        vehicleId: e.vehicle.id,
        vehicleName: nameOf(e.vehicle),
      })),
      ...recentServices.map((r) => ({
        id: r.id,
        type: 'SERVICE' as const,
        occurredOn: r.performedOn.toISOString().slice(0, 10),
        title: r.title,
        vehicleId: r.vehicle.id,
        vehicleName: nameOf(r.vehicle),
      })),
      ...recentInspections.map((r) => ({
        id: r.id,
        type: 'INSPECTION' as const,
        occurredOn: r.performedOn.toISOString().slice(0, 10),
        title: `${r.inspectionType === 'OTHER' ? 'Inspection' : r.inspectionType} — ${r.result.replace(/_/g, ' ').toLowerCase()}`,
        vehicleId: r.vehicle.id,
        vehicleName: nameOf(r.vehicle),
      })),
    ]
      // Ordered by when the event HAPPENED, not when the row was inserted. Back-dated
      // entries would otherwise appear in insertion order, which reads as random.
      .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0))
      .slice(0, 8)

    // --- month-to-date spend, read from the single cost surface ---
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const spend = await db.expense.findMany({
      where: { deletedAt: null, incurredOn: { gte: monthStart, lte: today } },
      select: { amount: true, currency: true },
    })
    const currencies = new Set(spend.map((e) => e.currency))
    const monthTotal = spend.reduce((sum, e) => sum + Number(e.amount), 0)

    return {
      counts: {
        vehicles: activeVehicles.length,
        totalVehicles: vehicles.length,
        attention: attention.length,
        servicesDue: dueRules.length,
        overdue: attention.filter((a) => a.severity === 'OVERDUE').length,
      },
      attention,
      recentActivity,
      costs: {
        // Null still means "nothing recorded", never zero spend — but now it is null
        // because there genuinely are no expenses, not because the feature was missing.
        // Mixed currencies are not summed: there is no rate to do it honestly.
        thisMonth: spend.length === 0 || currencies.size > 1 ? null : monthTotal.toFixed(2),
        currency: currencies.size === 1 ? [...currencies][0]! : null,
        mixedCurrencies: currencies.size > 1,
        entries: spend.length,
      },
    }
  }
}
