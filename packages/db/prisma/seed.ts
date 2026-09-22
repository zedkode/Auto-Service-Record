/**
 * Development seed. Local development only — never run against a real environment.
 *
 * Seed data exists so the dashboard has something real to render from the API. It is
 * never embedded in UI components (see the task brief §6 and CLAUDE.md).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hashPassword, PRODUCTION_PARAMS } from '@autoservices/auth'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true })

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set.')

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const DEV_EMAIL = 'andrei@autoservices.local'
const DEV_PASSWORD = 'DevPassword123!'

/** Deterministic dates relative to today, so the seed always looks current. */
const daysAgo = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d
}
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10))

/**
 * Built-in service categories (task brief §15).
 *
 * The suggested intervals are COMMON PRACTICE, not manufacturer specifications. The UI
 * says so and every value is user-editable (task brief §23) — presenting a generic
 * figure as manufacturer-approved would be worse than offering none.
 */
const SERVICE_CATEGORIES: Array<{
  key: string
  name: string
  km?: number
  months?: number
  description?: string
}> = [
  { key: 'engine_oil', name: 'Engine Oil', km: 15000, months: 12 },
  { key: 'oil_filter', name: 'Oil Filter', km: 15000, months: 12 },
  { key: 'air_filter', name: 'Air Filter', km: 30000, months: 24 },
  { key: 'cabin_filter', name: 'Cabin Filter', km: 30000, months: 12 },
  { key: 'fuel_filter', name: 'Fuel Filter', km: 60000, months: 48 },
  { key: 'brake_service', name: 'Brake Service', km: 30000, months: 24 },
  { key: 'brake_fluid', name: 'Brake Fluid', months: 24 },
  { key: 'coolant', name: 'Coolant', km: 100000, months: 60 },
  { key: 'gearbox_oil', name: 'Gearbox Oil', km: 60000, months: 48 },
  {
    key: 'timing_belt',
    name: 'Timing Belt',
    km: 160000,
    months: 120,
    description: 'Interval varies enormously by engine — check your manufacturer schedule.',
  },
  { key: 'timing_chain', name: 'Timing Chain', km: 250000 },
  { key: 'auxiliary_belt', name: 'Auxiliary Belt', km: 100000, months: 72 },
  { key: 'battery', name: 'Battery', months: 60 },
  { key: 'alternator', name: 'Alternator' },
  { key: 'starter_motor', name: 'Starter Motor' },
  { key: 'suspension', name: 'Suspension' },
  { key: 'clutch', name: 'Clutch' },
  { key: 'turbo', name: 'Turbo' },
  { key: 'dpf', name: 'DPF' },
  { key: 'egr', name: 'EGR' },
  { key: 'tyres', name: 'Tyres', km: 40000 },
  { key: 'wheel_alignment', name: 'Wheel Alignment', km: 20000, months: 24 },
  { key: 'general_inspection', name: 'General Inspection', months: 12 },
  { key: 'repair', name: 'Repair' },
  { key: 'other', name: 'Other' },
]

const MILES_TO_KM = 1.609344

/**
 * Fortnightly full fills for a vehicle, so the demo workspace shows what fuel tracking and
 * the consumption trend (RPT-003) actually look like. Without this the two features are
 * invisible until somebody types in a year of receipts by hand.
 *
 * Odometer readings are interpolated from the vehicle's own mileage history, so a fill
 * never contradicts a reading or runs backwards. Consumption drifts upward over the last
 * few months — a car that is quietly getting thirstier is the case the trend exists to
 * catch, and a flat line would demonstrate nothing.
 */
function fuelPlan(readings: Array<{ value: number; day: number }>) {
  const odometerOn = (day: number) => {
    const sorted = [...readings].sort((a, b) => b.day - a.day)
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    if (day >= first.day) return first.value
    if (day <= last.day) return last.value
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!
      const b = sorted[i + 1]!
      if (day <= a.day && day >= b.day) {
        const ratio = (a.day - day) / (a.day - b.day)
        return Math.round(a.value + (b.value - a.value) * ratio)
      }
    }
    return last.value
  }

  /**
   * The gap between fills is derived from how hard the vehicle is actually driven, so a
   * fill is a tank a driver could plausibly have bought. A fixed fortnight put 136 litres
   * into a Mondeo — more than the car holds — which is the kind of detail that makes
   * somebody stop trusting every other number on the page.
   */
  const sortedByDay = [...readings].sort((a, b) => b.day - a.day)
  const oldest = sortedByDay[0]!
  const newest = sortedByDay[sortedByDay.length - 1]!
  const milesPerDay = Math.max(
    5,
    (newest.value - oldest.value) / Math.max(1, oldest.day - newest.day),
  )
  // ~45 litres a fill: a large tank, comfortably short of a Mondeo's 62.
  const TARGET_MILES_PER_FILL = 470
  const step = Math.min(21, Math.max(3, Math.round(TARGET_MILES_PER_FILL / milesPerDay)))

  const days: number[] = []
  for (let day = 390; day >= 4; day -= step) days.push(day)

  const fills: Array<{
    day: number
    odometer: number
    litres: number
    unitPrice: string
    total: string
  }> = []

  let previous: number | null = null
  for (const day of days) {
    const odometer = odometerOn(day)
    if (previous !== null && odometer <= previous) continue

    // 5.9 L/100km settling to 6.5 over the final three months.
    const litresPer100Km = day > 90 ? 5.9 : 6.5
    const km = previous === null ? 0 : (odometer - previous) * MILES_TO_KM
    // The opening fill is a starting point, not a measured interval: give it a plausible
    // tank rather than a computed one.
    const litres = previous === null ? 52 : Math.round((km / 100) * litresPer100Km * 10) / 10
    const unitPrice = day > 200 ? 1.429 : 1.479
    fills.push({
      day,
      odometer,
      litres,
      unitPrice: unitPrice.toFixed(4),
      total: (litres * unitPrice).toFixed(2),
    })
    previous = odometer
  }
  return fills
}

/**
 * Fuel history for the demo vehicles, as its own idempotent pass.
 *
 * Deliberately not part of vehicle creation: that step skips vehicles that already exist,
 * so a workspace seeded before fuel tracking shipped would never get any. This backfills
 * whatever is missing and leaves alone whatever is not.
 */
async function seedFuelHistory(
  workspaceId: string,
  userId: string,
  vehicles: Array<{
    id: string
    fuelType: 'PETROL' | 'DIESEL' | null
    readings: Array<{ value: number; day: number }>
  }>,
) {
  const fuelCategory = await prisma.expenseCategory.findFirst({
    where: { workspaceId: null, key: 'fuel' },
    select: { id: true },
  })

  for (const vehicle of vehicles) {
    const existing = await prisma.fuelEntry.count({ where: { vehicleId: vehicle.id } })
    if (existing > 0) {
      console.log(`  fuel history already present for ${vehicle.id}, skipping`)
      continue
    }

    const plan = fuelPlan(vehicle.readings)
    await prisma.$transaction(async (tx) => {
      for (const f of plan) {
        const entry = await tx.fuelEntry.create({
          data: {
            workspaceId,
            vehicleId: vehicle.id,
            filledOn: dateOnly(daysAgo(f.day)),
            odometer: f.odometer,
            odometerUnit: 'MILES',
            quantity: f.litres,
            quantityUnit: 'LITRES',
            totalAmount: f.total,
            unitPrice: f.unitPrice,
            currency: 'GBP',
            fuelType: vehicle.fuelType,
            isFullTank: true,
            stationName: 'Shell Fosse Park',
            createdByUserId: userId,
          },
        })
        // `expenses` is the single cost surface (DECISIONS.md D-004): a fill that skipped
        // it would leave the demo's cost report quietly understating what the car costs.
        await tx.expense.create({
          data: {
            workspaceId,
            vehicleId: vehicle.id,
            categoryId: fuelCategory?.id ?? null,
            incurredOn: dateOnly(daysAgo(f.day)),
            amount: f.total,
            currency: 'GBP',
            vendorName: 'Shell Fosse Park',
            odometer: f.odometer,
            odometerUnit: 'MILES',
            description: `Fuel — ${f.litres} litres`,
            sourceType: 'FUEL',
            sourceRecordId: entry.id,
            createdByUserId: userId,
          },
        })
      }
    })
    console.log(`  seeded ${plan.length} fills for ${vehicle.id}`)
  }
}

async function seedServiceCategories() {
  let created = 0
  for (const [i, c] of SERVICE_CATEGORIES.entries()) {
    const existing = await prisma.serviceCategory.findFirst({
      where: { workspaceId: null, key: c.key },
    })
    if (existing) continue
    await prisma.serviceCategory.create({
      data: {
        workspaceId: null,
        key: c.key,
        name: c.name,
        description: c.description ?? null,
        defaultIntervalKm: c.km ?? null,
        defaultIntervalMonths: c.months ?? null,
        isSystem: true,
        sortOrder: i,
      },
    })
    created++
  }
  console.log(
    `  service categories: ${created} created, ${SERVICE_CATEGORIES.length - created} already present`,
  )
}

/**
 * System expense categories. Deliberately few and broad: a long list makes users
 * hesitate over which one to pick, and the reports read better with fewer, fuller rows.
 * The keys are also what projected expenses map onto, so renaming one is a migration.
 */
const EXPENSE_CATEGORIES = [
  { key: 'servicing', name: 'Servicing & repairs' },
  { key: 'fuel', name: 'Fuel & charging' },
  { key: 'insurance', name: 'Insurance' },
  { key: 'tax', name: 'Road tax' },
  { key: 'inspection', name: 'Inspection & MOT' },
  { key: 'tyres', name: 'Tyres' },
  { key: 'cleaning', name: 'Cleaning & valeting' },
  { key: 'parking', name: 'Parking & tolls' },
  { key: 'finance', name: 'Finance & leasing' },
  { key: 'other', name: 'Other' },
]

async function seedExpenseCategories() {
  let created = 0
  for (const [i, c] of EXPENSE_CATEGORIES.entries()) {
    const existing = await prisma.expenseCategory.findFirst({
      where: { workspaceId: null, key: c.key },
    })
    if (existing) continue
    await prisma.expenseCategory.create({
      data: { workspaceId: null, key: c.key, name: c.name, isSystem: true, sortOrder: i },
    })
    created++
  }
  console.log(
    `  expense categories: ${created} created, ${EXPENSE_CATEGORIES.length - created} already present`,
  )
}

async function main() {
  console.log('Seeding development data…')
  await seedServiceCategories()
  await seedExpenseCategories()

  const passwordHash = await hashPassword(DEV_PASSWORD, PRODUCTION_PARAMS)

  // ---- Primary development user + personal garage -------------------------------
  const user = await prisma.user.upsert({
    where: { email: DEV_EMAIL },
    update: {},
    create: {
      email: DEV_EMAIL,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          displayName: 'Andrei',
          timezone: 'Europe/London',
          locale: 'en-GB',
          preferredDistanceUnit: 'MILES',
          preferredCurrency: 'GBP',
        },
      },
    },
    include: { profile: true },
  })

  let workspace = await prisma.workspace.findFirst({
    where: { ownerUserId: user.id, type: 'PERSONAL' },
  })

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: 'My Garage',
        slug: `my-garage-${user.id.slice(0, 8)}`,
        type: 'PERSONAL',
        ownerUserId: user.id,
        defaultCurrency: 'GBP',
        defaultDistanceUnit: 'MILES',
        timezone: 'Europe/London',
        members: {
          create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
        },
      },
    })
  }

  // ---- A second user and workspace, used by the tenant-isolation tests ----------
  const otherUser = await prisma.user.upsert({
    where: { email: 'other@autoservices.local' },
    update: {},
    create: {
      email: 'other@autoservices.local',
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Other Owner' } },
    },
  })

  let otherWorkspace = await prisma.workspace.findFirst({
    where: { ownerUserId: otherUser.id, type: 'PERSONAL' },
  })
  if (!otherWorkspace) {
    otherWorkspace = await prisma.workspace.create({
      data: {
        name: "Someone Else's Garage",
        slug: `other-garage-${otherUser.id.slice(0, 8)}`,
        type: 'PERSONAL',
        ownerUserId: otherUser.id,
        members: {
          create: { userId: otherUser.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
        },
      },
    })
  }

  // ---- Vehicles ------------------------------------------------------------------
  const vehicleSeeds = [
    {
      manufacturer: 'Ford',
      model: 'Mondeo',
      generation: 'Mk5',
      trim: 'Titanium X Sport',
      modelYear: 2016,
      registrationNumber: 'AB16 CDE',
      vin: 'WF0EXXGBBEGR12345',
      engineName: '2.0 TDCi',
      engineCode: 'T8CC',
      displacementCc: 1997,
      powerKw: 132,
      fuelType: 'DIESEL' as const,
      transmission: 'MANUAL' as const,
      drivetrain: 'FWD' as const,
      bodyType: 'Estate',
      colour: 'Magnetic Grey',
      purchasedOn: dateOnly(daysAgo(400)),
      purchasePrice: '8750.00',
      purchaseOdometer: 96_400,
      readings: [
        { value: 96_400, day: 400 },
        { value: 108_200, day: 250 },
        { value: 121_500, day: 120 },
        { value: 128_940, day: 45 },
        { value: 131_260, day: 5 },
      ],
    },
    {
      manufacturer: 'BMW',
      model: '530d',
      generation: 'F10',
      trim: 'M Sport',
      modelYear: 2014,
      registrationNumber: 'BD64 XYZ',
      vin: 'WBAFR91060C123456',
      engineName: '3.0d',
      engineCode: 'N57D30',
      displacementCc: 2993,
      powerKw: 190,
      fuelType: 'DIESEL' as const,
      transmission: 'AUTOMATIC' as const,
      drivetrain: 'RWD' as const,
      bodyType: 'Saloon',
      colour: 'Alpine White',
      purchasedOn: dateOnly(daysAgo(700)),
      purchasePrice: '11200.00',
      purchaseOdometer: 74_300,
      readings: [
        { value: 74_300, day: 700 },
        { value: 88_100, day: 420 },
        { value: 99_650, day: 180 },
        { value: 104_880, day: 60 },
      ],
    },
  ]

  for (const v of vehicleSeeds) {
    const existing = await prisma.vehicle.findFirst({
      where: { workspaceId: workspace.id, registrationNumber: v.registrationNumber },
    })
    if (existing) {
      console.log(`  vehicle ${v.registrationNumber} already present, skipping`)
      continue
    }

    const { readings, ...vehicleData } = v
    const last = readings[readings.length - 1]!

    await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: {
          ...vehicleData,
          workspaceId: workspace!.id,
          purchaseCurrency: 'GBP',
          distanceUnit: 'MILES',
          status: 'ACTIVE',
          currentOdometer: last.value,
          currentOdometerUnit: 'MILES',
          currentOdometerAt: dateOnly(daysAgo(last.day)),
        },
      })

      // Append-only mileage history; the vehicle's currentOdometer is only a cache.
      for (const r of readings) {
        await tx.odometerEntry.create({
          data: {
            workspaceId: workspace!.id,
            vehicleId: vehicle.id,
            value: r.value,
            unit: 'MILES',
            recordedOn: dateOnly(daysAgo(r.day)),
            source: 'MANUAL',
            createdByUserId: user.id,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          workspaceId: workspace!.id,
          actorType: 'SYSTEM',
          action: 'vehicle.created',
          resourceType: 'vehicle',
          resourceId: vehicle.id,
          metadata: { source: 'seed' },
        },
      })

      console.log(`  created ${v.manufacturer} ${v.model} (${v.registrationNumber})`)
    })
  }

  const demoVehicles = await prisma.vehicle.findMany({
    where: { workspaceId: workspace.id, deletedAt: null },
    select: { id: true, fuelType: true, registrationNumber: true },
  })
  await seedFuelHistory(
    workspace.id,
    user.id,
    demoVehicles
      .map((v) => {
        const seed = vehicleSeeds.find((s) => s.registrationNumber === v.registrationNumber)
        return seed ? { id: v.id, fuelType: v.fuelType, readings: seed.readings } : null
      })
      .filter((v) => v !== null),
  )

  // A vehicle in the OTHER workspace — the target of the cross-tenant access tests.
  const otherVehicleExists = await prisma.vehicle.findFirst({
    where: { workspaceId: otherWorkspace.id },
  })
  if (!otherVehicleExists) {
    await prisma.vehicle.create({
      data: {
        workspaceId: otherWorkspace.id,
        manufacturer: 'Volkswagen',
        model: 'Golf',
        trim: 'GTD',
        modelYear: 2018,
        registrationNumber: 'ZZ18 TOP',
        fuelType: 'DIESEL',
        transmission: 'MANUAL',
        distanceUnit: 'MILES',
        currentOdometer: 52_300,
        currentOdometerUnit: 'MILES',
        currentOdometerAt: dateOnly(daysAgo(10)),
      },
    })
    console.log('  created Volkswagen Golf in the second workspace (isolation fixture)')
  }

  console.log('\nSeed complete.')
  console.log(`  Dev user     : ${DEV_EMAIL}`)
  console.log(`  Dev password : ${DEV_PASSWORD}`)
  console.log(`  Workspace    : ${workspace.name} (${workspace.id})`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
