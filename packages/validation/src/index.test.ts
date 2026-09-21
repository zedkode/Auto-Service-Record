import { describe, it, expect } from 'vitest'
import { email, password, calendarDate, moneyAmount, odometerValue } from './primitives.js'
import { createVehicleSchema, vin, createOdometerEntrySchema } from './vehicle.js'
import { createInspectionSchema, createInsuranceSchema, createRoadTaxSchema } from './ownership.js'

describe('email', () => {
  it('normalises case and whitespace', () => {
    expect(email.parse('  Andrei@Example.COM ')).toBe('andrei@example.com')
  })
  it('rejects malformed addresses', () => {
    expect(email.safeParse('not-an-email').success).toBe(false)
  })
})

describe('password', () => {
  it('requires at least 12 characters', () => {
    expect(password.safeParse('short').success).toBe(false)
    expect(password.safeParse('a-long-enough-password').success).toBe(true)
  })
})

describe('calendarDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(calendarDate.safeParse('2026-09-20').success).toBe(true)
  })
  it.each(['20-09-2026', '2026/09/20', '2026-13-01'])('rejects %s', (v) => {
    expect(calendarDate.safeParse(v).success).toBe(false)
  })
})

describe('moneyAmount', () => {
  it.each(['129.99', '0', '1200', '-45.50'])('accepts %s', (v) => {
    expect(moneyAmount.safeParse(v).success).toBe(true)
  })
  it.each(['129.999', 'abc', '1,299.00'])('rejects %s', (v) => {
    expect(moneyAmount.safeParse(v).success).toBe(false)
  })
})

describe('odometerValue', () => {
  it('rejects negatives and non-integers', () => {
    expect(odometerValue.safeParse(-1).success).toBe(false)
    expect(odometerValue.safeParse(1.5).success).toBe(false)
  })
})

describe('vin', () => {
  it('accepts a valid 17-character VIN', () => {
    expect(vin.safeParse('WF0EXXGBBE8R12345').success).toBe(true)
  })
  it('rejects the confusable letters I, O and Q', () => {
    expect(vin.safeParse('WF0EXXGBBE8I12345').success).toBe(false)
    expect(vin.safeParse('WF0EXXGBBE8O12345').success).toBe(false)
  })
  it('rejects the wrong length', () => {
    expect(vin.safeParse('TOOSHORT').success).toBe(false)
  })
})

describe('createVehicleSchema', () => {
  it('requires manufacturer and model', () => {
    expect(createVehicleSchema.safeParse({}).success).toBe(false)
  })
  it('applies defaults', () => {
    const r = createVehicleSchema.parse({ manufacturer: 'Ford', model: 'Mondeo' })
    expect(r.distanceUnit).toBe('MILES')
    expect(r.status).toBe('ACTIVE')
  })
  it('uppercases the registration', () => {
    const r = createVehicleSchema.parse({
      manufacturer: 'Ford',
      model: 'Mondeo',
      registrationNumber: 'ab12cde',
    })
    expect(r.registrationNumber).toBe('AB12CDE')
  })
  it('rejects an implausible model year', () => {
    expect(
      createVehicleSchema.safeParse({ manufacturer: 'F', model: 'M', modelYear: 1500 }).success,
    ).toBe(false)
  })
})

describe('createOdometerEntrySchema', () => {
  it('requires a reason when overriding a regression', () => {
    const r = createOdometerEntrySchema.safeParse({
      value: 100,
      unit: 'MILES',
      recordedOn: '2026-09-20',
      allowRegression: true,
    })
    expect(r.success).toBe(false)
  })
  it('accepts an override with a reason', () => {
    const r = createOdometerEntrySchema.safeParse({
      value: 100,
      unit: 'MILES',
      recordedOn: '2026-09-20',
      allowRegression: true,
      correctionReason: 'Typo in previous entry',
    })
    expect(r.success).toBe(true)
  })
})

describe('ownership schemas', () => {
  it('rejects an expiry that precedes the inspection', () => {
    // A reminder generated from this would be permanently in the past.
    const r = createInspectionSchema.safeParse({
      performedOn: '2026-09-01',
      expiresOn: '2025-09-01',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['expiresOn'])
    }
  })

  it('accepts an inspection with no expiry (not every one has a certificate)', () => {
    expect(createInspectionSchema.safeParse({ performedOn: '2026-09-01' }).success).toBe(true)
  })

  it('defaults an inspection to MOT with an unknown result', () => {
    const r = createInspectionSchema.parse({ performedOn: '2026-09-01' })
    expect(r.inspectionType).toBe('MOT')
    expect(r.result).toBe('UNKNOWN')
  })

  it('rejects a policy expiring before it starts', () => {
    const r = createInsuranceSchema.safeParse({
      providerName: 'Test Insurer',
      startsOn: '2026-09-01',
      expiresOn: '2026-08-31',
    })
    expect(r.success).toBe(false)
  })

  it('requires an insurer name', () => {
    expect(
      createInsuranceSchema.safeParse({ providerName: '  ', startsOn: '2026-09-01' }).success,
    ).toBe(false)
  })

  it('keeps money as a decimal string, never a float', () => {
    const r = createInsuranceSchema.parse({
      providerName: 'Test Insurer',
      startsOn: '2026-09-01',
      premiumAmount: '499.99',
    })
    expect(r.premiumAmount).toBe('499.99')
    expect(
      createInsuranceSchema.safeParse({
        providerName: 'X',
        startsOn: '2026-09-01',
        premiumAmount: '499.999',
      }).success,
    ).toBe(false)
  })

  it('normalises and validates the road-tax country code', () => {
    expect(
      createRoadTaxSchema.parse({ countryCode: 'gb', startsOn: '2026-09-01' }).countryCode,
    ).toBe('GB')
    expect(
      createRoadTaxSchema.safeParse({ countryCode: 'GBR', startsOn: '2026-09-01' }).success,
    ).toBe(false)
  })

  it('defaults road tax to GB without hard-coding the domain to the UK', () => {
    // A non-GB code must be equally acceptable (INIT.md §1.1).
    expect(createRoadTaxSchema.parse({ startsOn: '2026-09-01' }).countryCode).toBe('GB')
    expect(
      createRoadTaxSchema.parse({ countryCode: 'RO', startsOn: '2026-09-01' }).countryCode,
    ).toBe('RO')
  })
})
