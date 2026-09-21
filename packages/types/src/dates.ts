/**
 * Two genuinely different concepts (DATABASE.md §10):
 *   - Instant       : timestamptz, UTC, e.g. createdAt
 *   - CalendarDate  : a date with no time and no timezone, e.g. an MOT expiry
 *
 * An MOT expiring on 2026-11-30 expires that day everywhere. Passing it through a
 * timezone conversion makes a user in UTC+13 see it expire a day early.
 */
declare const dateBrand: unique symbol
export type CalendarDate = string & { readonly [dateBrand]: 'CalendarDate' }

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isCalendarDate(v: unknown): v is CalendarDate {
  return typeof v === 'string' && CALENDAR_DATE_RE.test(v)
}

export function calendarDate(v: string): CalendarDate {
  if (!CALENDAR_DATE_RE.test(v)) throw new Error(`Invalid calendar date: ${v}`)
  return v as CalendarDate
}

/** Today in a given IANA timezone, as a calendar date. Not the UTC date. */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts as CalendarDate
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export function addMonths(d: CalendarDate, months: number): CalendarDate {
  const y = +d.slice(0, 4)
  const m = +d.slice(5, 7) - 1
  const day = +d.slice(8, 10)
  const target = new Date(Date.UTC(y, m + months, 1))
  // Clamp to the last valid day of the target month: 31 Jan + 1 month is 28/29 Feb.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10) as CalendarDate
}

export function toCalendarDate(d: Date): CalendarDate {
  return d.toISOString().slice(0, 10) as CalendarDate
}
