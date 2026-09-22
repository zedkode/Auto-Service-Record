import { z } from 'zod'
// Reuses the vehicle schema's enum rather than declaring a second copy that could drift.
import { fuelType } from './vehicle.js'
import {
  calendarDate,
  currencyCode,
  distanceUnit,
  longText,
  moneyAmount,
  odometerValue,
  shortText,
} from './primitives.js'

export const quantityUnit = z.enum(['LITRES', 'US_GALLONS', 'IMP_GALLONS', 'KWH'])

export const createFuelEntrySchema = z
  .object({
    filledOn: calendarDate,
    odometer: odometerValue,
    odometerUnit: distanceUnit.optional(),

    /** Three decimals: fuel is sold to the hundredth of a litre. */
    quantity: z
      .number()
      .positive('Enter how much you put in.')
      .max(10_000, 'That quantity looks too high.'),
    quantityUnit: quantityUnit.default('LITRES'),

    totalAmount: moneyAmount.optional(),
    unitPrice: moneyAmount.optional(),
    currency: currencyCode.default('GBP'),

    fuelType: fuelType.optional(),

    /**
     * Defaults to a full tank because that is what most people do, and because only full
     * fills produce a consumption figure (DECISIONS.md D-002).
     */
    isFullTank: z.boolean().default(true),
    /** Set when a fill went unrecorded since the last one, which breaks the chain. */
    missedFill: z.boolean().default(false),

    stationName: shortText.optional(),
    notes: longText.optional(),
  })
  .refine((v) => !(v.isFullTank === false && v.missedFill === true), {
    message: 'A missed fill is recorded on the next full fill, not on a partial one.',
    path: ['missedFill'],
  })
export type CreateFuelEntryInput = z.infer<typeof createFuelEntrySchema>

export const updateFuelEntrySchema = z.object({
  filledOn: calendarDate.optional(),
  odometer: odometerValue.optional(),
  odometerUnit: distanceUnit.optional(),
  quantity: z.number().positive().max(10_000).optional(),
  quantityUnit: quantityUnit.optional(),
  totalAmount: moneyAmount.optional(),
  unitPrice: moneyAmount.optional(),
  currency: currencyCode.optional(),
  fuelType: fuelType.optional(),
  isFullTank: z.boolean().optional(),
  missedFill: z.boolean().optional(),
  stationName: shortText.optional(),
  notes: longText.optional(),
})
export type UpdateFuelEntryInput = z.infer<typeof updateFuelEntrySchema>
