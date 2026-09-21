import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { calendarDate, type CalendarDate, type DistanceUnit } from '@autoservices/types'
import type {
  CreateMaintenanceRuleInput,
  UpdateMaintenanceRuleInput,
} from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'
import {
  applyCompletion,
  evaluateRule,
  type MaintenanceRuleInput,
  type MaintenanceState,
  type OdometerReading,
} from './engine/maintenance.engine.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined): CalendarDate | null =>
  d ? (d.toISOString().slice(0, 10) as CalendarDate) : null
const today = (): CalendarDate => calendarDate(new Date().toISOString().slice(0, 10))

type RuleRow = Prisma.MaintenanceRuleGetPayload<{ include: { category: true } }>

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toEngineInput(rule: RuleRow): MaintenanceRuleInput {
    return {
      intervalType: rule.intervalType,
      intervalDistance: rule.intervalDistance,
      intervalDistanceUnit: rule.intervalDistanceUnit,
      intervalMonths: rule.intervalMonths,
      thresholdDistance: rule.thresholdDistance,
      thresholdDays: rule.thresholdDays,
      lastCompletedOn: dateStr(rule.lastCompletedOn),
      lastCompletedOdometer: rule.lastCompletedOdometer,
      lastCompletedUnit: rule.lastCompletedUnit,
    }
  }

  private async currentReading(
    workspaceId: string,
    vehicleId: string,
  ): Promise<OdometerReading | null> {
    const db = this.prisma.forWorkspace(workspaceId)
    const latest = await db.odometerEntry.findFirst({
      where: { vehicleId },
      orderBy: [{ recordedOn: 'desc' }, { value: 'desc' }],
    })
    if (!latest) return null
    return {
      value: latest.value,
      unit: latest.unit,
      recordedOn: dateStr(latest.recordedOn)!,
    }
  }

  /** Rules for a vehicle, each with freshly computed state. */
  async listForVehicle(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const [rules, reading] = await Promise.all([
      db.maintenanceRule.findMany({
        where: { vehicleId },
        include: { category: true },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      this.currentReading(workspaceId, vehicleId),
    ])

    const now = today()
    return rules.map((rule: RuleRow) =>
      this.present(rule, evaluateRule(this.toEngineInput(rule), reading, now)),
    )
  }

  /** Workspace-wide due list, worst first — what the dashboard surfaces. */
  async dueForWorkspace(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rules = await db.maintenanceRule.findMany({
      where: { isActive: true, vehicle: { deletedAt: null, status: 'ACTIVE' } },
      include: {
        category: true,
        vehicle: {
          select: {
            id: true,
            manufacturer: true,
            model: true,
            registrationNumber: true,
            distanceUnit: true,
          },
        },
      },
    })

    const readings = new Map<string, OdometerReading | null>()
    const now = today()
    const out: Array<ReturnType<MaintenanceService['present']> & { vehicle: unknown }> = []

    for (const rule of rules) {
      if (!readings.has(rule.vehicleId)) {
        readings.set(rule.vehicleId, await this.currentReading(workspaceId, rule.vehicleId))
      }
      const state = evaluateRule(
        this.toEngineInput(rule as RuleRow),
        readings.get(rule.vehicleId)!,
        now,
      )
      if (state.status === 'OK') continue
      out.push({ ...this.present(rule as RuleRow, state), vehicle: rule.vehicle })
    }

    const order = { OVERDUE: 0, DUE: 1, DUE_SOON: 2, OK: 3 } as const
    out.sort((a, b) => order[a.status] - order[b.status])
    return out
  }

  async create(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    input: CreateMaintenanceRuleInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const rule = await db.maintenanceRule.create({
      data: {
        workspaceId,
        vehicleId,
        categoryId: input.categoryId ?? null,
        name: input.name,
        intervalType: input.intervalType,
        intervalDistance: input.intervalDistance ?? null,
        intervalDistanceUnit: input.intervalDistance
          ? (input.intervalDistanceUnit ?? vehicle.distanceUnit)
          : null,
        intervalMonths: input.intervalMonths ?? null,
        thresholdDistance: input.thresholdDistance ?? null,
        thresholdDays: input.thresholdDays ?? null,
        lastCompletedOn: input.lastCompletedOn ? toDateOnly(input.lastCompletedOn) : null,
        lastCompletedOdometer: input.lastCompletedOdometer ?? null,
        lastCompletedUnit: input.lastCompletedOdometer ? vehicle.distanceUnit : null,
        notes: input.notes ?? null,
      },
      include: { category: true },
    })

    await this.recomputeAndPersist(workspaceId, rule.id)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'maintenance.rule_created',
      resourceType: 'maintenance_rule',
      resourceId: rule.id,
      metadata: { vehicleId, name: input.name },
    })
    return this.getOne(workspaceId, rule.id)
  }

  async update(
    workspaceId: string,
    ruleId: string,
    userId: string,
    input: UpdateMaintenanceRuleInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.maintenanceRule.findFirst({ where: { id: ruleId } })
    if (!existing) throw Errors.notFound('Maintenance rule')

    await db.maintenanceRule.update({
      where: { id: ruleId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.intervalType !== undefined ? { intervalType: input.intervalType } : {}),
        ...(input.intervalDistance !== undefined
          ? { intervalDistance: input.intervalDistance }
          : {}),
        ...(input.intervalMonths !== undefined ? { intervalMonths: input.intervalMonths } : {}),
        ...(input.thresholdDistance !== undefined
          ? { thresholdDistance: input.thresholdDistance }
          : {}),
        ...(input.thresholdDays !== undefined ? { thresholdDays: input.thresholdDays } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        // Any user edit marks the rule as overridden, so template refreshes leave it alone.
        isUserOverridden: true,
      },
    })

    await this.recomputeAndPersist(workspaceId, ruleId)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'maintenance.rule_updated',
      resourceType: 'maintenance_rule',
      resourceId: ruleId,
    })
    return this.getOne(workspaceId, ruleId)
  }

  async remove(workspaceId: string, ruleId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.maintenanceRule.findFirst({ where: { id: ruleId } })
    if (!existing) throw Errors.notFound('Maintenance rule')
    await db.maintenanceRule.delete({ where: { id: ruleId } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'maintenance.rule_deleted',
      resourceType: 'maintenance_rule',
      resourceId: ruleId,
      metadata: { name: existing.name },
    })
  }

  /**
   * MNT: completing maintenance APPENDS a completion and advances the rule. The previous
   * completion is never overwritten (task brief §25).
   */
  async complete(
    workspaceId: string,
    ruleId: string,
    userId: string,
    input: {
      completedOn: string
      odometer?: number | null
      notes?: string | null
      serviceRecordId?: string | null
    },
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rule = await db.maintenanceRule.findFirst({
      where: { id: ruleId },
      include: { vehicle: true, category: true },
    })
    if (!rule) throw Errors.notFound('Maintenance rule')

    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.maintenanceCompletion.create({
        data: {
          workspaceId,
          ruleId,
          completedOn: toDateOnly(input.completedOn),
          odometer: input.odometer ?? null,
          odometerUnit: input.odometer != null ? rule.vehicle.distanceUnit : null,
          serviceRecordId: input.serviceRecordId ?? null,
          notes: input.notes ?? null,
          createdByUserId: userId,
        },
      })

      const advanced = applyCompletion(this.toEngineInput(rule as RuleRow), {
        completedOn: calendarDate(input.completedOn),
        odometer: input.odometer ?? null,
        odometerUnit: input.odometer != null ? rule.vehicle.distanceUnit : null,
      })

      await tx.maintenanceRule.update({
        where: { id: ruleId },
        data: {
          lastCompletedOn: toDateOnly(input.completedOn),
          lastCompletedOdometer: advanced.lastCompletedOdometer,
          lastCompletedUnit: advanced.lastCompletedUnit,
        },
      })
    })

    await this.recomputeAndPersist(workspaceId, ruleId)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'maintenance.completed',
      resourceType: 'maintenance_rule',
      resourceId: ruleId,
      metadata: { completedOn: input.completedOn, odometer: input.odometer ?? null },
    })
    return this.getOne(workspaceId, ruleId)
  }

  /** Called by the service-creation flow: advances every rule matching the category. */
  async completeMatchingRules(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    ctx: {
      categoryId: string | null
      serviceRecordId: string
      completedOn: CalendarDate
      odometer: number | null
      odometerUnit: DistanceUnit | null
    },
  ): Promise<number> {
    if (!ctx.categoryId) {
      // Without a category there is nothing to match; still refresh the vehicle's rules
      // because the odometer probably moved.
      await this.recomputeVehicle(workspaceId, vehicleId)
      return 0
    }

    const db = this.prisma.forWorkspace(workspaceId)
    const matching = await db.maintenanceRule.findMany({
      where: { vehicleId, categoryId: ctx.categoryId, isActive: true },
    })

    for (const rule of matching) {
      await this.complete(workspaceId, rule.id, userId, {
        completedOn: ctx.completedOn,
        odometer: ctx.odometer,
        serviceRecordId: ctx.serviceRecordId,
        notes: 'Completed automatically by a matching service record',
      })
    }

    await this.recomputeVehicle(workspaceId, vehicleId)
    return matching.length
  }

  /** Recomputes and persists status for every rule on a vehicle. */
  async recomputeVehicle(workspaceId: string, vehicleId: string): Promise<void> {
    const db = this.prisma.forWorkspace(workspaceId)
    const rules = await db.maintenanceRule.findMany({
      where: { vehicleId },
      include: { category: true },
    })
    const reading = await this.currentReading(workspaceId, vehicleId)
    const now = today()

    for (const rule of rules) {
      const state = evaluateRule(this.toEngineInput(rule as RuleRow), reading, now)
      await db.maintenanceRule.update({
        where: { id: rule.id },
        data: {
          status: state.status,
          nextDueOn: state.nextDueOn ? toDateOnly(state.nextDueOn) : null,
          nextDueOdometer: state.nextDueOdometer,
        },
      })
    }
  }

  private async recomputeAndPersist(workspaceId: string, ruleId: string): Promise<void> {
    const db = this.prisma.forWorkspace(workspaceId)
    const rule = await db.maintenanceRule.findFirst({
      where: { id: ruleId },
      include: { category: true },
    })
    if (!rule) return
    const reading = await this.currentReading(workspaceId, rule.vehicleId)
    const state = evaluateRule(this.toEngineInput(rule as RuleRow), reading, today())
    await db.maintenanceRule.update({
      where: { id: ruleId },
      data: {
        status: state.status,
        nextDueOn: state.nextDueOn ? toDateOnly(state.nextDueOn) : null,
        nextDueOdometer: state.nextDueOdometer,
      },
    })
  }

  async getOne(workspaceId: string, ruleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rule = await db.maintenanceRule.findFirst({
      where: { id: ruleId },
      include: { category: true },
    })
    if (!rule) throw Errors.notFound('Maintenance rule')
    const reading = await this.currentReading(workspaceId, rule.vehicleId)
    return this.present(
      rule as RuleRow,
      evaluateRule(this.toEngineInput(rule as RuleRow), reading, today()),
    )
  }

  async completions(workspaceId: string, ruleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.maintenanceCompletion.findMany({
      where: { ruleId },
      orderBy: { completedOn: 'desc' },
      take: 50,
    })
    return rows.map((c) => ({
      id: c.id,
      completedOn: dateStr(c.completedOn),
      odometer: c.odometer,
      odometerUnit: c.odometerUnit,
      serviceRecordId: c.serviceRecordId,
      notes: c.notes,
    }))
  }

  /** Seeds rules for a vehicle from the system category defaults (MNT-003 templates). */
  async applyTemplate(workspaceId: string, vehicleId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const categories = await this.prisma.raw.serviceCategory.findMany({
      where: {
        workspaceId: null,
        OR: [{ defaultIntervalKm: { not: null } }, { defaultIntervalMonths: { not: null } }],
      },
      orderBy: { sortOrder: 'asc' },
    })

    const existing = await db.maintenanceRule.findMany({ where: { vehicleId } })
    const taken = new Set(existing.map((r) => r.categoryId).filter(Boolean))

    let created = 0
    for (const c of categories) {
      if (taken.has(c.id)) continue
      // Defaults are stored in km; convert for a miles vehicle so the number the user
      // sees matches the unit they work in.
      const distance =
        c.defaultIntervalKm === null
          ? null
          : vehicle.distanceUnit === 'MILES'
            ? Math.round(c.defaultIntervalKm / 1.609344 / 100) * 100
            : c.defaultIntervalKm

      await db.maintenanceRule.create({
        data: {
          workspaceId,
          vehicleId,
          categoryId: c.id,
          name: c.name,
          intervalType:
            distance !== null && c.defaultIntervalMonths !== null
              ? 'COMBINED'
              : distance !== null
                ? 'DISTANCE_BASED'
                : 'TIME_BASED',
          intervalDistance: distance,
          intervalDistanceUnit: distance !== null ? vehicle.distanceUnit : null,
          intervalMonths: c.defaultIntervalMonths,
        },
      })
      created++
    }

    await this.recomputeVehicle(workspaceId, vehicleId)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'maintenance.template_applied',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: { rulesCreated: created },
    })
    return { created }
  }

  private present(rule: RuleRow, state: MaintenanceState) {
    return {
      id: rule.id,
      vehicleId: rule.vehicleId,
      name: rule.name,
      category: rule.category
        ? { id: rule.category.id, key: rule.category.key, name: rule.category.name }
        : null,
      intervalType: rule.intervalType,
      intervalDistance: rule.intervalDistance,
      intervalDistanceUnit: rule.intervalDistanceUnit,
      intervalMonths: rule.intervalMonths,
      thresholdDistance: rule.thresholdDistance,
      thresholdDays: rule.thresholdDays,
      lastCompletedOn: dateStr(rule.lastCompletedOn),
      lastCompletedOdometer: rule.lastCompletedOdometer,
      isActive: rule.isActive,
      isUserOverridden: rule.isUserOverridden,
      notes: rule.notes,
      // Everything below is computed server-side. The UI renders it; it never recomputes.
      status: state.status,
      nextDueOn: state.nextDueOn,
      nextDueOdometer: state.nextDueOdometer,
      nextDueOdometerUnit: state.nextDueOdometerUnit,
      daysRemaining: state.daysRemaining,
      distanceRemaining: state.distanceRemaining,
      distanceRemainingUnit: state.distanceRemainingUnit,
      triggeringDimension: state.triggeringDimension,
      odometerConfidence: state.odometerConfidence,
      summary: state.summary,
    }
  }
}
