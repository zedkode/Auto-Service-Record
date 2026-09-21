import { z } from 'zod'
import {
  calendarDate,
  distanceUnit,
  odometerValue,
  shortText,
  mediumText,
  longText,
  currencyCode,
  moneyAmount,
  uuid,
} from './primitives.js'

export const servicePartSchema = z.object({
  name: shortText.min(1, 'Give the part a name.'),
  brand: shortText.optional(),
  manufacturer: shortText.optional(),
  partNumber: shortText.optional(),
  quantity: z.number().positive().max(9999).default(1),
  unitPrice: moneyAmount.optional(),
  warrantyMonths: z.number().int().min(0).max(600).optional(),
  supplierName: shortText.optional(),
  notes: mediumText.optional(),
})
export type ServicePartInput = z.infer<typeof servicePartSchema>

export const createServiceSchema = z.object({
  performedOn: calendarDate,
  title: shortText.min(1, 'Describe what was done.'),
  description: longText.optional(),
  categoryId: uuid.optional(),

  odometer: odometerValue.optional(),
  odometerUnit: distanceUnit.optional(),

  workshopName: shortText.optional(),
  mechanicName: shortText.optional(),

  partsTotal: moneyAmount.optional(),
  labourTotal: moneyAmount.optional(),
  taxTotal: moneyAmount.optional(),
  totalAmount: moneyAmount.optional(),
  currency: currencyCode.default('GBP'),

  warrantyMonths: z.number().int().min(0).max(600).optional(),
  nextServiceOn: calendarDate.optional(),
  nextServiceOdometer: odometerValue.optional(),

  notes: longText.optional(),
  parts: z.array(servicePartSchema).max(50).optional(),
})
export type CreateServiceInput = z.infer<typeof createServiceSchema>

export const updateServiceSchema = createServiceSchema.partial().omit({ parts: true })
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>

export const serviceCategorySchema = z.object({
  name: shortText.min(1, 'Give the category a name.'),
  description: mediumText.optional(),
  defaultIntervalKm: z.number().int().min(0).max(1_000_000).optional(),
  defaultIntervalMonths: z.number().int().min(0).max(600).optional(),
})
export type ServiceCategoryInput = z.infer<typeof serviceCategorySchema>
