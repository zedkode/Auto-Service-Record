/**
 * Money is never a float. Amounts travel as strings (JSON numbers are IEEE-754 doubles;
 * 0.1 + 0.2 is a support ticket) and are always paired with a currency. See DECISIONS.md D-015.
 */
export type CurrencyCode = string & { readonly __currency?: never }

export interface Money {
  /** Decimal string, e.g. "129.99". Never a number. */
  amount: string
  currency: CurrencyCode
}

export const money = (amount: string | number, currency: string): Money => ({
  amount: typeof amount === 'number' ? amount.toFixed(2) : amount,
  currency,
})

export const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
  RON: 'lei',
}

/** Sum amounts that share a currency. Throws on a currency mismatch rather than guessing. */
export function sumMoney(values: readonly Money[], currency: string): Money {
  let total = 0n
  for (const v of values) {
    if (v.currency !== currency) {
      throw new Error(`Currency mismatch: expected ${currency}, received ${v.currency}`)
    }
    total += toMinorUnits(v.amount)
  }
  return { amount: fromMinorUnits(total), currency }
}

/** "129.99" -> 12999n. Parsed as integer minor units to avoid float arithmetic entirely. */
export function toMinorUnits(amount: string): bigint {
  const negative = amount.trim().startsWith('-')
  const cleaned = amount.trim().replace(/^[-+]/, '')
  const [whole = '0', fraction = ''] = cleaned.split('.')
  const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
  return negative ? -minor : minor
}

export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}
