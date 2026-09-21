import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { can } from '@autoservices/permissions'
import type { WorkspaceRole } from '@autoservices/types'
import type {
  CreateInspectionInput,
  CreateInsuranceInput,
  CreateRoadTaxInput,
  ResolveAdvisoryInput,
  UpdateInspectionInput,
  UpdateInsuranceInput,
  UpdateRoadTaxInput,
} from '@autoservices/validation'
import { calendarDate, daysBetween, type CalendarDate } from '@autoservices/types'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'
import { ExpenseProjectionService } from '../expenses/expense-projection.service.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2))

const today = (): CalendarDate => calendarDate(new Date().toISOString().slice(0, 10))

export type ExpiryStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' | 'NONE'

/** Matches the reminder engine's horizon so the tab and the reminders agree. */
const EXPIRY_SOON_DAYS = 90

/**
 * Due-state is computed here, never in the browser.
 *
 * A component that does its own date arithmetic renders differently depending on when it
 * was mounted and on the viewer's clock, and would disagree with the reminder that was
 * emailed (DECISIONS.md D-041). The server owns the answer; the UI renders it.
 */
function expiry(expiresOn: Date | null, now: CalendarDate = today()) {
  if (!expiresOn) return { expiryStatus: 'NONE' as ExpiryStatus, daysRemaining: null }
  const remaining = daysBetween(now, expiresOn.toISOString().slice(0, 10) as CalendarDate)
  const status: ExpiryStatus =
    remaining < 0 ? 'EXPIRED' : remaining <= EXPIRY_SOON_DAYS ? 'EXPIRING_SOON' : 'VALID'
  return { expiryStatus: status, daysRemaining: remaining }
}

/**
 * Whether this caller may see monetary fields on ownership records.
 *
 * A DRIVER holds `ownership:read` — they need to know the MOT or insurance has expired,
 * because driving without either is illegal — but the existing doctrine is that a DRIVER
 * sees no money (ARCHITECTURE.md §5.1 note 2). Rather than invent a parallel permission,
 * the money is filtered out of the response by the same `expense:read` that governs it
 * everywhere else (DECISIONS.md D-050).
 */
const seesMoney = (role: WorkspaceRole) => can(role, 'expense:read')

@Injectable()
export class OwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projection: ExpenseProjectionService,
  ) {}

  /**
   * Mirrors a policy into the expense ledger (OWN-008). The premium is projected once,
   * dated from the start of cover; instalment schedules are not modelled yet, so a
   * monthly policy still shows its full premium on one date rather than pretending to
   * a payment plan the platform does not hold.
   */
  private async projectInsurance(
    workspaceId: string,
    row: {
      id: string
      vehicleId: string
      startsOn: Date
      premiumAmount: Prisma.Decimal | null
      currency: string
      providerName: string
    },
    userId: string,
  ) {
    await this.projection.project({
      workspaceId,
      sourceType: 'INSURANCE',
      sourceRecordId: row.id,
      vehicleId: row.vehicleId,
      incurredOn: row.startsOn,
      amount: ExpenseProjectionService.amountOf(row.premiumAmount),
      currency: row.currency,
      description: `Insurance premium — ${row.providerName}`,
      vendorName: row.providerName,
      createdByUserId: userId,
    })
  }

  private async projectRoadTax(
    workspaceId: string,
    row: {
      id: string
      vehicleId: string
      startsOn: Date
      amount: Prisma.Decimal | null
      currency: string
      countryCode: string
    },
    userId: string,
  ) {
    await this.projection.project({
      workspaceId,
      sourceType: 'TAX',
      sourceRecordId: row.id,
      vehicleId: row.vehicleId,
      incurredOn: row.startsOn,
      amount: ExpenseProjectionService.amountOf(row.amount),
      currency: row.currency,
      description: `Road tax (${row.countryCode})`,
      createdByUserId: userId,
    })
  }

  /**
   * Renewal silences the record it replaces.
   *
   * The reminder engine stops *emitting* a superseded record, but a reminder row already
   * raised for it stays open and would keep showing "MOT has expired" on a vehicle whose
   * MOT was renewed this morning. Cancelling here is what makes a renewal feel like one.
   */
  private async supersedeReminders(
    workspaceId: string,
    vehicleId: string,
    sourceType: 'INSPECTION' | 'INSURANCE' | 'TAX',
    keepSourceId: string,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    await db.reminder.updateMany({
      where: {
        vehicleId,
        sourceType,
        sourceId: { not: keepSourceId },
        status: { in: ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'] },
      },
      data: { status: 'CANCELLED' },
    })
  }

  /** Confirms the vehicle is in THIS workspace before anything is attached to it. */
  private async assertVehicle(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true },
    })
    if (!vehicle) throw Errors.vehicleNotFound()
    return vehicle
  }

  // --- inspections ------------------------------------------------------------

  async listInspections(workspaceId: string, role: WorkspaceRole, vehicleId?: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.vehicleInspection.findMany({
      where: { deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
      include: { advisories: { orderBy: { severity: 'desc' } } },
    })
    return rows.map((r) => this.inspectionView(r, role))
  }

  async getInspection(workspaceId: string, role: WorkspaceRole, id: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const row = await db.vehicleInspection.findFirst({
      where: { id, deletedAt: null },
      include: { advisories: { orderBy: { severity: 'desc' } } },
    })
    if (!row) throw Errors.notFound('Inspection')
    return this.inspectionView(row, role)
  }

  async createInspection(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    role: WorkspaceRole,
    input: CreateInspectionInput,
  ) {
    await this.assertVehicle(workspaceId, vehicleId)
    const db = this.prisma.forWorkspace(workspaceId)
    const { advisories, ...rest } = input

    const created = await db.vehicleInspection.create({
      data: {
        workspaceId,
        vehicleId,
        inspectionType: rest.inspectionType,
        result: rest.result,
        performedOn: toDateOnly(rest.performedOn),
        expiresOn: rest.expiresOn ? toDateOnly(rest.expiresOn) : null,
        odometer: rest.odometer ?? null,
        odometerUnit: rest.odometerUnit ?? null,
        centreName: rest.centreName ?? null,
        certificateNumber: rest.certificateNumber ?? null,
        notes: rest.notes ?? null,
        createdByUserId: userId,
        // The child carries workspaceId implicitly through the nested write; the
        // composite FK is what makes a mismatched tenant impossible at the database.
        advisories: advisories?.length
          ? { create: advisories.map((a) => ({ severity: a.severity, text: a.text })) }
          : undefined,
      },
      include: { advisories: true },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'inspection.created',
      resourceType: 'vehicle_inspection',
      resourceId: created.id,
      metadata: { vehicleId, inspectionType: created.inspectionType, result: created.result },
    })
    await this.supersedeReminders(workspaceId, vehicleId, 'INSPECTION', created.id)
    return this.inspectionView(created, role)
  }

  async updateInspection(
    workspaceId: string,
    id: string,
    userId: string,
    role: WorkspaceRole,
    input: UpdateInspectionInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.vehicleInspection.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Inspection')

    const updated = await db.vehicleInspection.update({
      where: { id },
      data: {
        ...(input.inspectionType !== undefined ? { inspectionType: input.inspectionType } : {}),
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.performedOn !== undefined ? { performedOn: toDateOnly(input.performedOn) } : {}),
        ...(input.expiresOn !== undefined ? { expiresOn: toDateOnly(input.expiresOn) } : {}),
        ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
        ...(input.odometerUnit !== undefined ? { odometerUnit: input.odometerUnit } : {}),
        ...(input.centreName !== undefined ? { centreName: input.centreName } : {}),
        ...(input.certificateNumber !== undefined
          ? { certificateNumber: input.certificateNumber }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: { advisories: { orderBy: { severity: 'desc' } } },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'inspection.updated',
      resourceType: 'vehicle_inspection',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    })
    return this.inspectionView(updated, role)
  }

  /**
   * Soft delete. An inspection is part of a vehicle's permanent history and its
   * certificate number may be the only record the owner has (AGENTS.md §2).
   */
  async removeInspection(workspaceId: string, id: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.vehicleInspection.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Inspection')
    await db.vehicleInspection.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'inspection.deleted',
      resourceType: 'vehicle_inspection',
      resourceId: id,
      metadata: { soft: true },
    })
  }

  async resolveAdvisory(
    workspaceId: string,
    advisoryId: string,
    userId: string,
    input: ResolveAdvisoryInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.inspectionAdvisory.findFirst({ where: { id: advisoryId } })
    if (!existing) throw Errors.notFound('Advisory')

    if (input.resolvedServiceRecordId) {
      const service = await db.serviceRecord.findFirst({
        where: { id: input.resolvedServiceRecordId, deletedAt: null },
        select: { id: true },
      })
      if (!service) throw Errors.notFound('Service record')
    }

    const updated = await db.inspectionAdvisory.update({
      where: { id: advisoryId },
      data: {
        isResolved: input.isResolved,
        resolvedAt: input.isResolved ? new Date() : null,
        resolvedServiceRecordId: input.isResolved ? (input.resolvedServiceRecordId ?? null) : null,
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: input.isResolved ? 'advisory.resolved' : 'advisory.reopened',
      resourceType: 'inspection_advisory',
      resourceId: advisoryId,
      metadata: { serviceRecordId: input.resolvedServiceRecordId ?? null },
    })
    return this.advisoryView(updated)
  }

  // --- insurance --------------------------------------------------------------

  async listInsurance(workspaceId: string, role: WorkspaceRole, vehicleId?: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.insurancePolicy.findMany({
      where: { deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
    })
    return rows.map((r) => this.insuranceView(r, role))
  }

  async createInsurance(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    role: WorkspaceRole,
    input: CreateInsuranceInput,
  ) {
    await this.assertVehicle(workspaceId, vehicleId)
    const db = this.prisma.forWorkspace(workspaceId)
    const created = await db.insurancePolicy.create({
      data: {
        workspaceId,
        vehicleId,
        providerName: input.providerName,
        policyNumber: input.policyNumber ?? null,
        coverType: input.coverType ?? null,
        startsOn: toDateOnly(input.startsOn),
        expiresOn: input.expiresOn ? toDateOnly(input.expiresOn) : null,
        premiumAmount: input.premiumAmount ?? null,
        excessAmount: input.excessAmount ?? null,
        currency: input.currency,
        paymentFrequency: input.paymentFrequency ?? null,
        renewalType: input.renewalType,
        coverageNotes: input.coverageNotes ?? null,
        createdByUserId: userId,
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'insurance.created',
      resourceType: 'insurance_policy',
      resourceId: created.id,
      // Never the premium: audit metadata is read far more widely than the record.
      metadata: { vehicleId, providerName: created.providerName },
    })
    await this.supersedeReminders(workspaceId, vehicleId, 'INSURANCE', created.id)
    await this.projectInsurance(workspaceId, created, userId)
    return this.insuranceView(created, role)
  }

  async updateInsurance(
    workspaceId: string,
    id: string,
    userId: string,
    role: WorkspaceRole,
    input: UpdateInsuranceInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.insurancePolicy.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Policy')

    const updated = await db.insurancePolicy.update({
      where: { id },
      data: {
        ...(input.providerName !== undefined ? { providerName: input.providerName } : {}),
        ...(input.policyNumber !== undefined ? { policyNumber: input.policyNumber } : {}),
        ...(input.coverType !== undefined ? { coverType: input.coverType } : {}),
        ...(input.startsOn !== undefined ? { startsOn: toDateOnly(input.startsOn) } : {}),
        ...(input.expiresOn !== undefined ? { expiresOn: toDateOnly(input.expiresOn) } : {}),
        ...(input.premiumAmount !== undefined ? { premiumAmount: input.premiumAmount } : {}),
        ...(input.excessAmount !== undefined ? { excessAmount: input.excessAmount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.paymentFrequency !== undefined
          ? { paymentFrequency: input.paymentFrequency }
          : {}),
        ...(input.renewalType !== undefined ? { renewalType: input.renewalType } : {}),
        ...(input.coverageNotes !== undefined ? { coverageNotes: input.coverageNotes } : {}),
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'insurance.updated',
      resourceType: 'insurance_policy',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    })
    await this.projectInsurance(workspaceId, updated, userId)
    return this.insuranceView(updated, role)
  }

  async removeInsurance(workspaceId: string, id: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.insurancePolicy.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Policy')
    await db.insurancePolicy.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'insurance.deleted',
      resourceType: 'insurance_policy',
      resourceId: id,
      metadata: { soft: true },
    })
    await this.projection.retract('INSURANCE', id)
  }

  // --- road tax ---------------------------------------------------------------

  async listRoadTax(workspaceId: string, role: WorkspaceRole, vehicleId?: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.roadTaxRecord.findMany({
      where: { deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
    })
    return rows.map((r) => this.roadTaxView(r, role))
  }

  async createRoadTax(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    role: WorkspaceRole,
    input: CreateRoadTaxInput,
  ) {
    await this.assertVehicle(workspaceId, vehicleId)
    const db = this.prisma.forWorkspace(workspaceId)
    const created = await db.roadTaxRecord.create({
      data: {
        workspaceId,
        vehicleId,
        countryCode: input.countryCode,
        taxType: input.taxType ?? null,
        reference: input.reference ?? null,
        startsOn: toDateOnly(input.startsOn),
        expiresOn: input.expiresOn ? toDateOnly(input.expiresOn) : null,
        amount: input.amount ?? null,
        currency: input.currency,
        paymentFrequency: input.paymentFrequency ?? null,
        notes: input.notes ?? null,
        createdByUserId: userId,
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'road_tax.created',
      resourceType: 'road_tax_record',
      resourceId: created.id,
      metadata: { vehicleId, countryCode: created.countryCode },
    })
    await this.supersedeReminders(workspaceId, vehicleId, 'TAX', created.id)
    await this.projectRoadTax(workspaceId, created, userId)
    return this.roadTaxView(created, role)
  }

  async updateRoadTax(
    workspaceId: string,
    id: string,
    userId: string,
    role: WorkspaceRole,
    input: UpdateRoadTaxInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.roadTaxRecord.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Road tax record')

    const updated = await db.roadTaxRecord.update({
      where: { id },
      data: {
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
        ...(input.taxType !== undefined ? { taxType: input.taxType } : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.startsOn !== undefined ? { startsOn: toDateOnly(input.startsOn) } : {}),
        ...(input.expiresOn !== undefined ? { expiresOn: toDateOnly(input.expiresOn) } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.paymentFrequency !== undefined
          ? { paymentFrequency: input.paymentFrequency }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'road_tax.updated',
      resourceType: 'road_tax_record',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    })
    await this.projectRoadTax(workspaceId, updated, userId)
    return this.roadTaxView(updated, role)
  }

  async removeRoadTax(workspaceId: string, id: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.roadTaxRecord.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Road tax record')
    await db.roadTaxRecord.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'road_tax.deleted',
      resourceType: 'road_tax_record',
      resourceId: id,
      metadata: { soft: true },
    })
    await this.projection.retract('TAX', id)
  }

  // --- views ------------------------------------------------------------------

  private advisoryView(a: {
    id: string
    severity: string
    text: string
    isResolved: boolean
    resolvedAt: Date | null
    resolvedServiceRecordId: string | null
  }) {
    return {
      id: a.id,
      severity: a.severity,
      text: a.text,
      isResolved: a.isResolved,
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      resolvedServiceRecordId: a.resolvedServiceRecordId,
    }
  }

  private inspectionView(
    r: Prisma.VehicleInspectionGetPayload<{ include: { advisories: true } }>,
    _role: WorkspaceRole,
  ) {
    return {
      id: r.id,
      vehicleId: r.vehicleId,
      inspectionType: r.inspectionType,
      result: r.result,
      performedOn: dateStr(r.performedOn),
      expiresOn: dateStr(r.expiresOn),
      odometer: r.odometer,
      odometerUnit: r.odometerUnit,
      centreName: r.centreName,
      certificateNumber: r.certificateNumber,
      notes: r.notes,
      ...expiry(r.expiresOn),
      advisories: r.advisories.map((a) => this.advisoryView(a)),
      unresolvedAdvisories: r.advisories.filter((a) => !a.isResolved).length,
      createdAt: r.createdAt.toISOString(),
    }
  }

  private insuranceView(r: Prisma.InsurancePolicyGetPayload<object>, role: WorkspaceRole) {
    const money = seesMoney(role)
    return {
      id: r.id,
      vehicleId: r.vehicleId,
      providerName: r.providerName,
      policyNumber: r.policyNumber,
      coverType: r.coverType,
      startsOn: dateStr(r.startsOn),
      expiresOn: dateStr(r.expiresOn),
      ...expiry(r.expiresOn),
      // Omitted entirely rather than nulled, so a client cannot mistake "hidden" for
      // "not recorded".
      ...(money
        ? {
            premiumAmount: dec(r.premiumAmount),
            excessAmount: dec(r.excessAmount),
            currency: r.currency,
            paymentFrequency: r.paymentFrequency,
          }
        : {}),
      renewalType: r.renewalType,
      coverageNotes: r.coverageNotes,
      createdAt: r.createdAt.toISOString(),
    }
  }

  private roadTaxView(r: Prisma.RoadTaxRecordGetPayload<object>, role: WorkspaceRole) {
    const money = seesMoney(role)
    return {
      id: r.id,
      vehicleId: r.vehicleId,
      countryCode: r.countryCode,
      taxType: r.taxType,
      reference: r.reference,
      startsOn: dateStr(r.startsOn),
      expiresOn: dateStr(r.expiresOn),
      ...expiry(r.expiresOn),
      ...(money
        ? {
            amount: dec(r.amount),
            currency: r.currency,
            paymentFrequency: r.paymentFrequency,
          }
        : {}),
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    }
  }
}
