/**
 * REM-002 — reminder policy tests.
 *
 * The windows decide when a user is interrupted and the keys decide whether they are
 * interrupted twice. Both are worth testing exhaustively.
 */
import { describe, expect, it } from 'vitest'
import { calendarDate, type CalendarDate } from '@autoservices/types'
import {
  evaluateDateWindow,
  evaluateDistanceWindow,
  deliveryKey,
  isoWeek,
  DEFAULT_LEAD_DAYS,
} from './reminder.policy.js'

const TODAY = calendarDate('2026-09-20')
const inDays = (n: number): CalendarDate => {
  const d = new Date(Date.UTC(2026, 8, 20))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10) as CalendarDate
}

describe('date windows', () => {
  const cases: Array<[string, number, string | null]> = [
    ['a year away', 365, null],
    ['31 days — just outside the widest window', 31, null],
    ['30 days — first window', 30, 'due-30d'],
    ['20 days — still the 30-day window', 20, 'due-30d'],
    ['14 days', 14, 'due-14d'],
    ['10 days', 10, 'due-14d'],
    ['7 days', 7, 'due-7d'],
    ['3 days', 3, 'due-7d'],
    ['1 day', 1, 'due-1d'],
    ['today', 0, 'due-0d'],
  ]

  it.each(cases)('%s -> %s', (_l, offset, expected) => {
    expect(evaluateDateWindow(inDays(offset), TODAY).windowKey).toBe(expected)
  })

  it('picks the MOST urgent window, not the oldest', () => {
    // 3 days out is inside 30, 14 and 7. It must report the 7-day window.
    expect(evaluateDateWindow(inDays(3), TODAY).windowKey).toBe('due-7d')
  })

  it('nags weekly once overdue, not daily', () => {
    const a = evaluateDateWindow(inDays(-3), TODAY)
    const b = evaluateDateWindow(inDays(-5), TODAY)
    expect(a.overdue).toBe(true)
    // Same week -> same key -> the idempotency ledger suppresses the second message.
    expect(a.windowKey).toBe(b.windowKey)
    expect(a.windowKey).toMatch(/^overdue-2026-W\d\d$/)
  })

  it('produces a different key in the following week', () => {
    const thisWeek = evaluateDateWindow(inDays(-1), TODAY)
    const nextWeek = evaluateDateWindow(inDays(-8), calendarDate('2026-09-27'))
    expect(thisWeek.windowKey).not.toBe(nextWeek.windowKey)
  })

  it('describes the remaining time in plain language', () => {
    expect(evaluateDateWindow(inDays(1), TODAY).phrase).toBe('in 1 day')
    expect(evaluateDateWindow(inDays(7), TODAY).phrase).toBe('in 7 days')
    expect(evaluateDateWindow(inDays(0), TODAY).phrase).toBe('today')
    expect(evaluateDateWindow(inDays(-2), TODAY).phrase).toBe('2 days ago')
  })

  it('honours custom lead days', () => {
    expect(evaluateDateWindow(inDays(60), TODAY, [90]).windowKey).toBe('due-90d')
    expect(evaluateDateWindow(inDays(60), TODAY, DEFAULT_LEAD_DAYS).windowKey).toBeNull()
  })
})

describe('distance windows', () => {
  it('stays quiet when far away', () => {
    expect(evaluateDistanceWindow(160_000, 150_000, 'miles').windowKey).toBeNull()
  })

  it('fires at the 1000-unit window', () => {
    expect(evaluateDistanceWindow(160_000, 159_200, 'miles').windowKey).toBe('due-1000mi')
  })

  it('escalates to the 500-unit window', () => {
    expect(evaluateDistanceWindow(160_000, 159_700, 'miles').windowKey).toBe('due-500mi')
  })

  it('reports due exactly at the threshold', () => {
    const d = evaluateDistanceWindow(160_000, 160_000, 'miles')
    expect(d.windowKey).toBe('due-0mi')
    expect(d.overdue).toBe(false)
  })

  it('reports overdue past it', () => {
    const d = evaluateDistanceWindow(160_000, 160_800, 'miles', undefined, TODAY)
    expect(d.overdue).toBe(true)
    expect(d.phrase).toBe('800 miles ago')
  })

  it('formats large numbers readably', () => {
    expect(evaluateDistanceWindow(160_000, 158_500, 'miles').phrase).toBe('in 1,500 miles')
  })
})

describe('delivery keys', () => {
  const base = {
    workspaceId: 'ws-1',
    reminderId: 'rem-1',
    channel: 'EMAIL',
    userId: 'user-1',
    windowKey: 'due-7d',
  }

  it('is stable for identical inputs', () => {
    expect(deliveryKey(base)).toBe(deliveryKey({ ...base }))
  })

  it.each([
    ['workspace', { workspaceId: 'ws-2' }],
    ['reminder', { reminderId: 'rem-2' }],
    ['channel', { channel: 'IN_APP' }],
    ['user', { userId: 'user-2' }],
    ['window', { windowKey: 'due-1d' }],
  ])('changes when the %s changes', (_l, override) => {
    expect(deliveryKey({ ...base, ...override })).not.toBe(deliveryKey(base))
  })

  it('is a sha256 hex digest', () => {
    expect(deliveryKey(base)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('isoWeek', () => {
  it('is stable within a week and changes across weeks', () => {
    expect(isoWeek(calendarDate('2026-09-21'))).toBe(isoWeek(calendarDate('2026-09-25')))
    expect(isoWeek(calendarDate('2026-09-21'))).not.toBe(isoWeek(calendarDate('2026-09-28')))
  })
})

describe('phrase vs magnitude', () => {
  it('magnitude carries no direction, so callers can add their own preposition', () => {
    const overdue = evaluateDateWindow(inDays(-3), TODAY)
    expect(overdue.phrase).toBe('3 days ago')
    expect(overdue.magnitude).toBe('3 days')
    // REGRESSION: "Overdue by 3 days ago." shipped to a real notification.
    expect(`Overdue by ${overdue.magnitude}.`).toBe('Overdue by 3 days.')
  })

  it('applies to distance windows too', () => {
    const d = evaluateDistanceWindow(160_000, 183_200, 'miles', undefined, TODAY)
    expect(d.phrase).toBe('23,200 miles ago')
    expect(d.magnitude).toBe('23,200 miles')
    expect(`Overdue by ${d.magnitude}.`).toBe('Overdue by 23,200 miles.')
  })

  it('every decision exposes both fields', () => {
    for (const offset of [-10, 0, 3, 100]) {
      const d = evaluateDateWindow(inDays(offset), TODAY)
      expect(typeof d.phrase).toBe('string')
      expect(typeof d.magnitude).toBe('string')
      expect(d.magnitude).not.toMatch(/\bago\b|^in /)
    }
  })
})
