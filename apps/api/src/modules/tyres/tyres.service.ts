import { Injectable } from '@nestjs/common'
import type {
  CreateTyreSetInput,
  FitTyreSetInput,
  MeasureTreadInput,
  RemoveTyreSetInput,
  UpdateTyreSetInput,
} from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { DomainError, Errors } from '../../common/errors.js'
import {
  currentInstallation,
  distanceOnSet,
  treadStatus,
  type DistanceUnit,
  type Installation,
} from './tyre.engine.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const num = (v: unknown) =>
  v === null || v === undefined
    ? null
    : typeof v === 'object' && 'toNumber' in (v as object)
      ? (v as { toNumber(): number }).toNumber()
      : Number(v)

/**
 * OWN-005 — tyre sets and the periods they spend on a vehicle.
 *
 * Distance and tread state are computed on every read from the vehicle's current mileage,
 * never stored: a set that is on the car covers more distance every day without anything
 * happening in this system, so a stored total is out of date the moment it is written —
 * the same reasoning as warranties (DECISIONS.md D-099).
 */
@Injectable()
export class TyresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string, vehicleId?: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const sets = await db.tyreSet.findMany({
      where: { deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { installations: { orderBy: { installedOn: 'desc' } } },
    })
    if (sets.length === 0) return []

    const vehicles = await db.vehicle.findMany({
      where: { id: { in: [...new Set(sets.map((s: SetRow) => s.vehicleId))] } },
      select: { id: true, currentOdometer: true, currentOdometerUnit: true },
    })
    const byId = new Map(vehicles.map((v: VehicleRow) => [v.id, v]))
    return sets.map((s: SetRow) => this.view(s, byId.get(s.vehicleId)))
  }

  async create(workspaceId: string, vehicleId: string, userId: string, input: CreateTyreSetInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true, currentOdometer: true, currentOdometerUnit: true },
    })
    if (!vehicle) throw Errors.vehicleNotFound()

    const created = await db.tyreSet.create({
      data: {
        workspaceId,
        vehicleId,
        name: input.name,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        size: input.size ?? null,
        season: input.season,
        loadIndex: input.loadIndex ?? null,
        speedRating: input.speedRating ?? null,
        purchasedOn: input.purchasedOn ? toDateOnly(input.purchasedOn) : null,
        purchasePrice: input.purchasePrice ?? null,
        currency: input.currency,
        notes: input.notes ?? null,
        createdByUserId: userId,
      },
      include: { installations: true },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'tyre_set.created',
      resourceType: 'tyre_set',
      resourceId: created.id,
      metadata: { vehicleId, season: created.season },
    })
    return this.view(created, vehicle)
  }

  async update(workspaceId: string, id: string, userId: string, input: UpdateTyreSetInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.tyreSet.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Tyre set')

    const updated = await db.tyreSet.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.season !== undefined ? { season: input.season } : {}),
        ...(input.loadIndex !== undefined ? { loadIndex: input.loadIndex } : {}),
        ...(input.speedRating !== undefined ? { speedRating: input.speedRating } : {}),
        ...(input.purchasedOn !== undefined ? { purchasedOn: toDateOnly(input.purchasedOn) } : {}),
        ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: { installations: { orderBy: { installedOn: 'desc' } } },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'tyre_set.updated',
      resourceType: 'tyre_set',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    })
    return this.view(updated, await this.vehicleOf(workspaceId, updated.vehicleId))
  }

  /**
   * Fits a set, taking off whatever was on.
   *
   * A car cannot wear two sets at once, so fitting one ends the current period rather than
   * refusing. Refusing would be technically defensible and practically wrong: the user is
   * recording a seasonal swap that has already happened to their car, and making them
   * perform it as two steps invites them to do the first and forget the second — leaving
   * two sets recorded as fitted, which is the state this rule exists to prevent
   * (DECISIONS.md D-108).
   */
  async fit(workspaceId: string, setId: string, userId: string, input: FitTyreSetInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const set = await db.tyreSet.findFirst({
      where: { id: setId, deletedAt: null },
      include: { installations: true },
    })
    if (!set) throw Errors.notFound('Tyre set')
    if (set.status === 'RETIRED') {
      throw new DomainError(
        'CONFLICT',
        'That set is retired. Reactivate it before fitting it again.',
        409,
      )
    }
    if (currentInstallation(set.installations.map(toEngineInstallation))) {
      throw new DomainError('CONFLICT', 'That set is already fitted.', 409)
    }

    const replaced = await db.tyreInstallation.findFirst({
      where: { vehicleId: set.vehicleId, removedOn: null },
      include: { tyreSet: { select: { id: true, name: true } } },
    })

    const created = await this.prisma.raw.$transaction(async (tx) => {
      if (replaced) {
        // Removed at the same reading the new set went on: the car was in one place.
        await tx.tyreInstallation.update({
          where: { id: replaced.id },
          data: {
            removedOn: toDateOnly(input.installedOn),
            removedOdometer: input.installedOdometer ?? null,
          },
        })
        await tx.tyreSet.update({ where: { id: replaced.tyreSetId }, data: { status: 'STORED' } })
      }
      const installation = await tx.tyreInstallation.create({
        data: {
          workspaceId,
          tyreSetId: setId,
          vehicleId: set.vehicleId,
          position: input.position,
          installedOn: toDateOnly(input.installedOn),
          installedOdometer: input.installedOdometer ?? null,
          odometerUnit: input.odometerUnit,
          treadDepthMm: input.treadDepthMm ?? null,
          treadMeasuredOn: input.treadDepthMm !== undefined ? toDateOnly(input.installedOn) : null,
          notes: input.notes ?? null,
          createdByUserId: userId,
        },
      })
      await tx.tyreSet.update({ where: { id: setId }, data: { status: 'IN_USE' } })
      return installation
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'tyre_set.fitted',
      resourceType: 'tyre_set',
      resourceId: setId,
      metadata: {
        installationId: created.id,
        position: created.position,
        replacedSetId: replaced?.tyreSetId ?? null,
        replacedSetName: replaced?.tyreSet?.name ?? null,
      },
    })
    return this.get(workspaceId, setId)
  }

  async remove(workspaceId: string, setId: string, userId: string, input: RemoveTyreSetInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const open = await db.tyreInstallation.findFirst({
      where: { tyreSetId: setId, removedOn: null },
    })
    if (!open) throw new DomainError('CONFLICT', 'That set is not currently fitted.', 409)
    if (dateStr(open.installedOn)! > input.removedOn) {
      throw new DomainError('VALIDATION_FAILED', 'It cannot come off before it went on.', 422)
    }

    await this.prisma.raw.$transaction(async (tx) => {
      await tx.tyreInstallation.update({
        where: { id: open.id },
        data: {
          removedOn: toDateOnly(input.removedOn),
          removedOdometer: input.removedOdometer ?? null,
          ...(input.treadDepthMm !== undefined
            ? { treadDepthMm: input.treadDepthMm, treadMeasuredOn: toDateOnly(input.removedOn) }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      })
      await tx.tyreSet.update({ where: { id: setId }, data: { status: 'STORED' } })
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'tyre_set.removed',
      resourceType: 'tyre_set',
      resourceId: setId,
      metadata: { installationId: open.id, removedOn: input.removedOn },
    })
    return this.get(workspaceId, setId)
  }

  /** Records a tread measurement against the period the set is in now. */
  async measureTread(workspaceId: string, setId: string, userId: string, input: MeasureTreadInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const open = await db.tyreInstallation.findFirst({
      where: { tyreSetId: setId, removedOn: null },
    })
    if (!open) {
      throw new DomainError(
        'CONFLICT',
        'Tread is measured on the set that is fitted. Fit this set first.',
        409,
      )
    }
    await db.tyreInstallation.update({
      where: { id: open.id },
      data: { treadDepthMm: input.treadDepthMm, treadMeasuredOn: toDateOnly(input.measuredOn) },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'tyre_set.tread_measured',
      resourceType: 'tyre_set',
      resourceId: setId,
      metadata: { treadDepthMm: input.treadDepthMm, measuredOn: input.measuredOn },
    })
    return this.get(workspaceId, setId)
  }

  async get(workspaceId: string, setId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const set = await db.tyreSet.findFirst({
      where: { id: setId, deletedAt: null },
      include: { installations: { orderBy: { installedOn: 'desc' } } },
    })
    if (!set) throw Errors.notFound('Tyre set')
    return this.view(set, await this.vehicleOf(workspaceId, set.vehicleId))
  }

  async softDelete(workspaceId: string, setId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const set = await db.tyreSet.findFirst({ where: { id: setId, deletedAt: null } })
    if (!set) throw Errors.notFound('Tyre set')
    const open = await db.tyreInstallation.findFirst({
      where: { tyreSetId: setId, removedOn: null },
    })
    // Removing a set that is on the car would leave the vehicle with nothing recorded as
    // fitted, which is a worse record than the one being deleted.
    if (open) {
      throw new DomainError('CONFLICT', 'Take the set off the vehicle before removing it.', 409)
    }
    await db.tyreSet.update({ where: { id: setId }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'tyre_set.deleted',
      resourceType: 'tyre_set',
      resourceId: setId,
      metadata: { soft: true },
    })
  }

  private async vehicleOf(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    return (
      (await db.vehicle.findFirst({
        where: { id: vehicleId },
        select: { id: true, currentOdometer: true, currentOdometerUnit: true },
      })) ?? undefined
    )
  }

  private view(set: SetRow, vehicle?: VehicleRow) {
    const installations = (set.installations ?? []).map(toEngineInstallation)
    const today = new Date().toISOString().slice(0, 10)

    return {
      id: set.id,
      vehicleId: set.vehicleId,
      name: set.name,
      manufacturer: set.manufacturer,
      model: set.model,
      size: set.size,
      season: set.season,
      loadIndex: set.loadIndex,
      speedRating: set.speedRating,
      purchasedOn: dateStr(set.purchasedOn),
      purchasePrice:
        set.purchasePrice === null ? null : (num(set.purchasePrice)?.toFixed(2) ?? null),
      currency: set.currency,
      status: set.status,
      notes: set.notes,
      fitted: currentInstallation(installations) !== null,
      // Computed here, on every read: see the class comment.
      distance: distanceOnSet(installations, {
        odometer: vehicle?.currentOdometer ?? null,
        unit: (vehicle?.currentOdometerUnit as DistanceUnit | null) ?? null,
      }),
      tread: treadStatus(installations, today),
      installations: (set.installations ?? []).map((i) => ({
        id: i.id,
        position: i.position,
        installedOn: dateStr(i.installedOn),
        installedOdometer: i.installedOdometer,
        removedOn: dateStr(i.removedOn),
        removedOdometer: i.removedOdometer,
        odometerUnit: i.odometerUnit,
        treadDepthMm: num(i.treadDepthMm),
        treadMeasuredOn: dateStr(i.treadMeasuredOn),
        notes: i.notes,
      })),
    }
  }
}

function toEngineInstallation(i: InstallationRow): Installation {
  return {
    installedOn: dateStr(i.installedOn)!,
    installedOdometer: i.installedOdometer,
    removedOn: dateStr(i.removedOn),
    removedOdometer: i.removedOdometer,
    odometerUnit: i.odometerUnit as DistanceUnit,
    treadDepthMm: num(i.treadDepthMm),
    treadMeasuredOn: dateStr(i.treadMeasuredOn),
  }
}

interface InstallationRow {
  id: string
  position: string
  installedOn: Date
  installedOdometer: number | null
  removedOn: Date | null
  removedOdometer: number | null
  odometerUnit: string
  treadDepthMm: unknown
  treadMeasuredOn: Date | null
  notes: string | null
}

interface SetRow {
  id: string
  vehicleId: string
  name: string
  manufacturer: string | null
  model: string | null
  size: string | null
  season: string
  loadIndex: string | null
  speedRating: string | null
  purchasedOn: Date | null
  purchasePrice: unknown
  currency: string
  status: string
  notes: string | null
  installations?: InstallationRow[]
}

interface VehicleRow {
  id: string
  currentOdometer: number | null
  currentOdometerUnit: string | null
}
