import { z } from 'zod'
import {
  calendarDate,
  distanceUnit,
  odometerValue,
  shortText,
  longText,
  uuid,
} from './primitives.js'

export const intervalType = z.enum(['TIME_BASED', 'DISTANCE_BASED', 'COMBINED'])

export const createMaintenanceRuleSchema = z
  .object({
    name: shortText.min(1, 'Give the item a name.'),
    categoryId: uuid.optional(),
    intervalType: intervalType.default('COMBINED'),
    intervalDistance: z.number().int().min(1).max(1_000_000).optional(),
    intervalDistanceUnit: distanceUnit.optional(),
    intervalMonths: z.number().int().min(1).max(600).optional(),
    thresholdDistance: z.number().int().min(0).max(100_000).optional(),
    thresholdDays: z.number().int().min(0).max(3650).optional(),
    lastCompletedOn: calendarDate.optional(),
    lastCompletedOdometer: odometerValue.optional(),
    notes: longText.optional(),
  })
  // A rule with neither dimension can never become due, so it would be silently useless.
  .refine((v) => v.intervalDistance !== undefined || v.intervalMonths !== undefined, {
    message: 'Set a distance interval, a time interval, or both.',
    path: ['intervalDistance'],
  })
  .refine((v) => v.intervalType !== 'DISTANCE_BASED' || v.intervalDistance !== undefined, {
    message: 'A distance-based item needs a distance interval.',
    path: ['intervalDistance'],
  })
  .refine((v) => v.intervalType !== 'TIME_BASED' || v.intervalMonths !== undefined, {
    message: 'A time-based item needs a time interval.',
    path: ['intervalMonths'],
  })
export type CreateMaintenanceRuleInput = z.infer<typeof createMaintenanceRuleSchema>

export const updateMaintenanceRuleSchema = z.object({
  name: shortText.min(1).optional(),
  intervalType: intervalType.optional(),
  intervalDistance: z.number().int().min(1).max(1_000_000).nullable().optional(),
  intervalMonths: z.number().int().min(1).max(600).nullable().optional(),
  thresholdDistance: z.number().int().min(0).max(100_000).nullable().optional(),
  thresholdDays: z.number().int().min(0).max(3650).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: longText.nullable().optional(),
})
export type UpdateMaintenanceRuleInput = z.infer<typeof updateMaintenanceRuleSchema>

export const completeMaintenanceSchema = z.object({
  completedOn: calendarDate,
  odometer: odometerValue.optional(),
  notes: shortText.optional(),
})
export type CompleteMaintenanceInput = z.infer<typeof completeMaintenanceSchema>
