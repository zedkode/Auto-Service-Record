/**
 * Shared schema primitives. One definition, two consumers (API validation and client
 * forms) — a frontend that validates differently from the server is a bug factory.
 * See API.md §9.
 */
import { z } from 'zod'

export const uuid = z.uuid()

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address.' }))

/**
 * Length and breach-checking beat composition rules (SECURITY.md §4), so there is a
 * minimum length and a maximum (Argon2 inputs are bounded) but no symbol requirement.
 */
export const password = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'That password is too long.')

export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected format YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'That is not a real date.')

export const distanceUnit = z.enum(['MILES', 'KILOMETERS'])

export const odometerValue = z
  .number()
  .int('Mileage must be a whole number.')
  .min(0, 'Mileage cannot be negative.')
  .max(10_000_000, 'That mileage looks too high.')

export const currencyCode = z
  .string()
  .length(3, 'Use a 3-letter currency code.')
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter uppercase currency code, such as GBP.')

/** Money crosses the wire as a decimal string. See DECISIONS.md D-015. */
export const moneyAmount = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'Enter an amount such as 129.99.')

export const shortText = z.string().trim().max(200)
export const mediumText = z.string().trim().max(1000)
export const longText = z.string().trim().max(10_000)

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
})

export type PaginationQuery = z.infer<typeof paginationQuery>
