/**
 * REMINDER POLICIES (task brief §27).
 *
 * Reusable window logic, not a bespoke function per source. A "window" identifies which
 * notification this is — the 30-day warning, the 7-day warning, the overdue nag — and
 * becomes part of the idempotency key, so each window fires exactly once.
 */
import { createHash } from 'node:crypto'
import { daysBetween, type CalendarDate } from '@autoservices/types'

export const DEFAULT_LEAD_DAYS = [30, 14, 7, 1]
export const DEFAULT_LEAD_DISTANCES = [1000, 500]

export interface WindowDecision {
  /** Null means nothing to send right now. */
  windowKey: string | null
  /** Whether the underlying thing is already past due. */
  overdue: boolean
  /**
   * Relative phrase, ready to follow "Due": "in 7 days", "today", "620 miles ago".
   */
  phrase: string
  /**
   * Bare magnitude with no direction: "7 days", "620 miles". Callers that supply their
   * own preposition use this — "Overdue by 620 miles" rather than the nonsense
   * "Overdue by 620 miles ago" that reusing `phrase` produced.
   */
  magnitude: string
}

/**
 * Decides whether a date-based reminder has entered a notification window.
 *
 * Windows are evaluated worst-first so an item that jumps past several thresholds (for
 * example after a week of downtime) reports the most urgent one rather than the oldest.
 */
export function evaluateDateWindow(
  dueOn: CalendarDate,
  today: CalendarDate,
  leadDays: readonly number[] = DEFAULT_LEAD_DAYS,
): WindowDecision {
  const remaining = daysBetween(today, dueOn)

  if (remaining < 0) {
    // Overdue items nag weekly rather than daily; the window key is the ISO week, so a
    // retry in the same week cannot produce a second message.
    const days = `${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? '' : 's'}`
    return {
      windowKey: `overdue-${isoWeek(today)}`,
      overdue: true,
      phrase: `${days} ago`,
      magnitude: days,
    }
  }

  if (remaining === 0) {
    return { windowKey: 'due-0d', overdue: false, phrase: 'today', magnitude: 'today' }
  }

  const sorted = [...leadDays].sort((a, b) => a - b)
  for (const lead of sorted) {
    if (remaining <= lead) {
      const days = `${remaining} day${remaining === 1 ? '' : 's'}`
      return { windowKey: `due-${lead}d`, overdue: false, phrase: `in ${days}`, magnitude: days }
    }
  }

  return {
    windowKey: null,
    overdue: false,
    phrase: `in ${remaining} days`,
    magnitude: `${remaining} days`,
  }
}

/** Distance equivalent: fires as the vehicle approaches the due odometer. */
export function evaluateDistanceWindow(
  dueOdometer: number,
  currentOdometer: number,
  unitLabel: string,
  leadDistances: readonly number[] = DEFAULT_LEAD_DISTANCES,
  today?: CalendarDate,
): WindowDecision {
  const remaining = dueOdometer - currentOdometer
  const n = (v: number) => Math.abs(v).toLocaleString('en-GB')

  if (remaining < 0) {
    const dist = `${n(remaining)} ${unitLabel}`
    return {
      windowKey: `overdue-${today ? isoWeek(today) : 'dist'}`,
      overdue: true,
      phrase: `${dist} ago`,
      magnitude: dist,
    }
  }
  if (remaining === 0) {
    return { windowKey: 'due-0mi', overdue: false, phrase: 'now', magnitude: 'now' }
  }

  const sorted = [...leadDistances].sort((a, b) => a - b)
  for (const lead of sorted) {
    if (remaining <= lead) {
      const dist = `${n(remaining)} ${unitLabel}`
      return { windowKey: `due-${lead}mi`, overdue: false, phrase: `in ${dist}`, magnitude: dist }
    }
  }
  const dist = `${n(remaining)} ${unitLabel}`
  return { windowKey: null, overdue: false, phrase: `in ${dist}`, magnitude: dist }
}

/**
 * Stable delivery key (EMAILS.md §4). The same reminder, user, channel and window always
 * produces the same key, so a retried worker is a no-op rather than a second message.
 */
export function deliveryKey(parts: {
  workspaceId: string
  reminderId: string
  channel: string
  userId: string
  windowKey: string
}): string {
  return createHash('sha256')
    .update(
      [parts.workspaceId, parts.reminderId, parts.channel, parts.userId, parts.windowKey].join('|'),
    )
    .digest('hex')
}

/** ISO week identifier, e.g. 2026-W38. */
export function isoWeek(date: CalendarDate): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
