import { z } from 'zod'
import {
  calendarDate,
  distanceUnit,
  odometerValue,
  shortText,
  longText,
  currencyCode,
  moneyAmount,
} from './primitives.js'

export const fuelType = z.enum([
  'PETROL',
  'DIESEL',
  'HYBRID',
  'PLUGIN_HYBRID',
  'ELECTRIC',
  'LPG',
  'CNG',
  'HYDROGEN',
  'OTHER',
])
export const transmission = z.enum(['MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC', 'CVT', 'DCT', 'OTHER'])
export const drivetrain = z.enum(['FWD', 'RWD', 'AWD', 'FOUR_WD', 'OTHER'])
export const vehicleStatus = z.enum(['ACTIVE', 'STORED', 'SOLD', 'SCRAPPED', 'ARCHIVED'])

const currentYear = new Date().getUTCFullYear()

/**
 * VIN: 17 characters, excluding I, O and Q by the ISO standard (they are excluded
 * precisely because they are confusable with 1 and 0). Optional — plenty of owners
 * do not have it to hand, and blocking vehicle creation on it would be hostile.
 */
export const vin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'A VIN is 17 characters and excludes I, O and Q.')

export const createVehicleSchema = z.object({
  manufacturer: shortText.min(1, 'Enter the manufacturer.'),
  model: shortText.min(1, 'Enter the model.'),
  generation: shortText.optional(),
  modelYear: z
    .number()
    .int()
    .min(1885, 'Cars did not exist yet.')
    .max(currentYear + 2)
    .optional(),
  trim: shortText.optional(),
  registrationNumber: z.string().trim().toUpperCase().max(16).optional(),
  vin: vin.optional(),
  engineName: shortText.optional(),
  engineCode: shortText.optional(),
  displacementCc: z.number().int().min(0).max(20_000).optional(),
  powerKw: z.number().int().min(0).max(2000).optional(),
  fuelType: fuelType.optional(),
  transmission: transmission.optional(),
  drivetrain: drivetrain.optional(),
  bodyType: shortText.optional(),
  colour: shortText.optional(),
  firstRegisteredOn: calendarDate.optional(),
  purchasedOn: calendarDate.optional(),
  purchasePrice: moneyAmount.optional(),
  purchaseCurrency: currencyCode.optional(),
  currentOdometer: odometerValue.optional(),
  distanceUnit: distanceUnit.default('MILES'),
  status: vehicleStatus.default('ACTIVE'),
  notes: longText.optional(),
})
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>

export const updateVehicleSchema = createVehicleSchema.partial()
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>

export const createOdometerEntrySchema = z
  .object({
    value: odometerValue,
    unit: distanceUnit,
    recordedOn: calendarDate,
    notes: shortText.optional(),
    /** Explicit, audited override for a genuine correction. Never a silent default. */
    allowRegression: z.boolean().default(false),
    correctionReason: shortText.optional(),
  })
  .refine((v) => !v.allowRegression || (v.correctionReason && v.correctionReason.length > 0), {
    message: 'A correction needs a reason.',
    path: ['correctionReason'],
  })
export type CreateOdometerEntryInput = z.infer<typeof createOdometerEntrySchema>
