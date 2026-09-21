/**
 * Locale-aware formatting. Never hand-rolled — Intl handles the cases we would get wrong.
 * UI_UX.md §7.
 */
export function formatDistance(
  value: number | null | undefined,
  unit: 'MILES' | 'KILOMETERS',
  locale = 'en-GB',
): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat(locale).format(value)} ${unit === 'MILES' ? 'mi' : 'km'}`
}

export function formatMoney(
  amount: string | null | undefined,
  currency: string | null | undefined,
  locale = 'en-GB',
): string {
  if (!amount || !currency) return '—'
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount))
}

/** Calendar dates are rendered as written — never passed through a timezone. */
export function formatDate(iso: string | null | undefined, locale = 'en-GB'): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function formatRelativeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}
