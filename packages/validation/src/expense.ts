import { z } from 'zod'
import {
  calendarDate,
  currencyCode,
  distanceUnit,
  longText,
  moneyAmount,
  odometerValue,
  shortText,
  uuid,
} from './primitives.js'

export const expenseSourceType = z.enum(['MANUAL', 'SERVICE', 'FUEL', 'INSURANCE', 'TAX', 'OTHER'])

export const createExpenseSchema = z.object({
  vehicleId: uuid.optional(),
  categoryId: uuid.optional(),
  incurredOn: calendarDate,
  amount: moneyAmount,
  currency: currencyCode.default('GBP'),
  vendorName: shortText.optional(),
  odometer: odometerValue.optional(),
  odometerUnit: distanceUnit.optional(),
  description: longText.optional(),
})
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>

export const updateExpenseSchema = createExpenseSchema.partial()
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>

export const expenseCategorySchema = z.object({
  name: shortText.min(1, 'Give the category a name.'),
})
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>
