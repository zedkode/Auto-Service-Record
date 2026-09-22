import { z } from 'zod'
import {
  calendarDate,
  currencyCode,
  distanceUnit,
  longText,
  mediumText,
  moneyAmount,
  odometerValue,
  shortText,
  uuid,
} from './primitives.js'

export const inspectionType = z.enum([
  'MOT',
  'ITP',
  'TUV',
  'CT',
  'STATE_INSPECTION',
  'EMISSIONS',
  'OTHER',
])
export const inspectionResult = z.enum(['PASS', 'PASS_WITH_ADVISORIES', 'FAIL', 'UNKNOWN'])
export const advisorySeverity = z.enum(['MINOR', 'MAJOR', 'DANGEROUS'])
export const paymentFrequency = z.enum(['ONE_OFF', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])
export const policyRenewalType = z.enum(['MANUAL', 'AUTOMATIC', 'UNKNOWN'])

/**
 * An expiry that precedes the event it follows from is always a data-entry mistake, and
 * one that silently produces a reminder in the past. Rejected at the edge rather than
 * explained later.
 */
const expiryAfter =
  <T extends { expiresOn?: string }>(startField: 'performedOn' | 'startsOn') =>
  (value: T & Record<string, unknown>, ctx: z.RefinementCtx) => {
    const start = value[startField]
    if (typeof start === 'string' && value.expiresOn && value.expiresOn < start) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresOn'],
        message: 'The expiry date cannot be before the start date.',
      })
    }
  }

export const inspectionAdvisorySchema = z.object({
  severity: advisorySeverity,
  text: mediumText.min(1, 'Describe the advisory.'),
})
export type InspectionAdvisoryInput = z.infer<typeof inspectionAdvisorySchema>

export const createInspectionSchema = z
  .object({
    inspectionType: inspectionType.default('MOT'),
    result: inspectionResult.default('UNKNOWN'),
    performedOn: calendarDate,
    expiresOn: calendarDate.optional(),
    odometer: odometerValue.optional(),
    odometerUnit: distanceUnit.optional(),
    centreName: shortText.optional(),
    certificateNumber: shortText.optional(),
    notes: longText.optional(),
    advisories: z.array(inspectionAdvisorySchema).max(50).optional(),
  })
  .superRefine(expiryAfter('performedOn'))
export type CreateInspectionInput = z.infer<typeof createInspectionSchema>

export const updateInspectionSchema = z
  .object({
    inspectionType: inspectionType.optional(),
    result: inspectionResult.optional(),
    performedOn: calendarDate.optional(),
    expiresOn: calendarDate.optional(),
    odometer: odometerValue.optional(),
    odometerUnit: distanceUnit.optional(),
    centreName: shortText.optional(),
    certificateNumber: shortText.optional(),
    notes: longText.optional(),
  })
  .superRefine(expiryAfter('performedOn'))
export type UpdateInspectionInput = z.infer<typeof updateInspectionSchema>

export const resolveAdvisorySchema = z.object({
  isResolved: z.boolean(),
  resolvedServiceRecordId: uuid.optional(),
})
export type ResolveAdvisoryInput = z.infer<typeof resolveAdvisorySchema>

export const createInsuranceSchema = z
  .object({
    providerName: shortText.min(1, 'Who is the insurer?'),
    policyNumber: shortText.optional(),
    coverType: shortText.optional(),
    startsOn: calendarDate,
    expiresOn: calendarDate.optional(),
    premiumAmount: moneyAmount.optional(),
    excessAmount: moneyAmount.optional(),
    currency: currencyCode.default('GBP'),
    paymentFrequency: paymentFrequency.optional(),
    renewalType: policyRenewalType.default('UNKNOWN'),
    coverageNotes: longText.optional(),
  })
  .superRefine(expiryAfter('startsOn'))
export type CreateInsuranceInput = z.infer<typeof createInsuranceSchema>

export const updateInsuranceSchema = z
  .object({
    providerName: shortText.min(1).optional(),
    policyNumber: shortText.optional(),
    coverType: shortText.optional(),
    startsOn: calendarDate.optional(),
    expiresOn: calendarDate.optional(),
    premiumAmount: moneyAmount.optional(),
    excessAmount: moneyAmount.optional(),
    currency: currencyCode.optional(),
    paymentFrequency: paymentFrequency.optional(),
    renewalType: policyRenewalType.optional(),
    coverageNotes: longText.optional(),
  })
  .superRefine(expiryAfter('startsOn'))
export type UpdateInsuranceInput = z.infer<typeof updateInsuranceSchema>

/** ISO 3166-1 alpha-2. The domain is not UK-only (INIT.md §1.1). */
export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Use a 2-letter country code.')
  .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, such as GB.')

export const createRoadTaxSchema = z
  .object({
    countryCode: countryCode.default('GB'),
    taxType: shortText.optional(),
    reference: shortText.optional(),
    startsOn: calendarDate,
    expiresOn: calendarDate.optional(),
    amount: moneyAmount.optional(),
    currency: currencyCode.default('GBP'),
    paymentFrequency: paymentFrequency.optional(),
    notes: longText.optional(),
  })
  .superRefine(expiryAfter('startsOn'))
export type CreateRoadTaxInput = z.infer<typeof createRoadTaxSchema>

export const updateRoadTaxSchema = z
  .object({
    countryCode: countryCode.optional(),
    taxType: shortText.optional(),
    reference: shortText.optional(),
    startsOn: calendarDate.optional(),
    expiresOn: calendarDate.optional(),
    amount: moneyAmount.optional(),
    currency: currencyCode.optional(),
    paymentFrequency: paymentFrequency.optional(),
    notes: longText.optional(),
  })
  .superRefine(expiryAfter('startsOn'))
export type UpdateRoadTaxInput = z.infer<typeof updateRoadTaxSchema>

export const warrantyType = z.enum(['MANUFACTURER', 'DEALER', 'THIRD_PARTY', 'PART', 'REPAIR'])

/**
 * A mileage limit is meaningless without its unit, and a unit is meaningless without a
 * limit. Enforced together because `MILES` and `KILOMETERS` are never compared raw
 * (AGENTS.md) — a bare number would have to be assumed into one of them somewhere.
 */
const distancePairs = <
  T extends {
    distanceLimit?: number | null
    distanceLimitUnit?: string | null
    startOdometer?: number | null
    startOdometerUnit?: string | null
  },
>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.distanceLimit != null && !value.distanceLimitUnit) {
    ctx.addIssue({
      code: 'custom',
      path: ['distanceLimitUnit'],
      message: 'Choose miles or kilometres for the mileage limit.',
    })
  }
  if (value.startOdometer != null && !value.startOdometerUnit) {
    ctx.addIssue({
      code: 'custom',
      path: ['startOdometerUnit'],
      message: 'Choose miles or kilometres for the starting reading.',
    })
  }
}

export const createWarrantySchema = z
  .object({
    warrantyType: warrantyType,
    providerName: shortText.optional(),
    reference: shortText.optional(),
    startsOn: calendarDate,
    expiresOn: calendarDate.optional(),
    distanceLimit: z.number().int().positive().max(2_000_000).optional(),
    distanceLimitUnit: distanceUnit.optional(),
    startOdometer: z.number().int().nonnegative().max(2_000_000).optional(),
    startOdometerUnit: distanceUnit.optional(),
    coverageNotes: longText.optional(),
    serviceRecordId: z.uuid().optional(),
  })
  .superRefine(expiryAfter('startsOn'))
  .superRefine(distancePairs)
export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>

export const updateWarrantySchema = z
  .object({
    warrantyType: warrantyType.optional(),
    providerName: shortText.optional(),
    reference: shortText.optional(),
    startsOn: calendarDate.optional(),
    expiresOn: calendarDate.optional(),
    distanceLimit: z.number().int().positive().max(2_000_000).optional(),
    distanceLimitUnit: distanceUnit.optional(),
    startOdometer: z.number().int().nonnegative().max(2_000_000).optional(),
    startOdometerUnit: distanceUnit.optional(),
    coverageNotes: longText.optional(),
  })
  .superRefine(expiryAfter('startsOn'))
  .superRefine(distancePairs)
export type UpdateWarrantyInput = z.infer<typeof updateWarrantySchema>
