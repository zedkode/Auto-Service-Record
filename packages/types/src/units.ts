/**
 * Branded distance types. Mixing miles and kilometres is a compile error, not a runtime
 * surprise — see AGENTS.md rule 10 and DATABASE.md §9.
 *
 * Canonical internal unit for computation is metres (integer). Stored values keep the
 * unit the user actually entered; we never rewrite a reading into another unit.
 */
import type { DistanceUnit } from './enums.js'

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type Miles = Brand<number, 'Miles'>
export type Kilometers = Brand<number, 'Kilometers'>
export type Metres = Brand<number, 'Metres'>

export const miles = (n: number): Miles => n as Miles
export const kilometers = (n: number): Kilometers => n as Kilometers
export const metres = (n: number): Metres => Math.round(n) as Metres

/** Exact, by definition. */
const METRES_PER_MILE = 1609.344
const METRES_PER_KM = 1000

export const milesToMetres = (v: Miles): Metres => metres(v * METRES_PER_MILE)
export const kilometersToMetres = (v: Kilometers): Metres => metres(v * METRES_PER_KM)
export const metresToMiles = (v: Metres): Miles => miles(v / METRES_PER_MILE)
export const metresToKilometers = (v: Metres): Kilometers => kilometers(v / METRES_PER_KM)

/** A distance value paired with the unit it was recorded in. */
export interface Distance {
  value: number
  unit: DistanceUnit
}

export function toMetres(d: Distance): Metres {
  return d.unit === 'MILES'
    ? milesToMetres(miles(d.value))
    : kilometersToMetres(kilometers(d.value))
}

export function fromMetres(m: Metres, unit: DistanceUnit): Distance {
  const value = unit === 'MILES' ? metresToMiles(m) : metresToKilometers(m)
  return { value: Math.round(value), unit }
}

/** Convert a distance into the requested unit. Returns a new Distance; never mutates. */
export function convertDistance(d: Distance, to: DistanceUnit): Distance {
  if (d.unit === to) return { ...d }
  return fromMetres(toMetres(d), to)
}

/** Compare two distances safely regardless of their units. */
export function compareDistance(a: Distance, b: Distance): number {
  return toMetres(a) - toMetres(b)
}

export const distanceUnitLabel = (u: DistanceUnit, short = true): string =>
  u === 'MILES' ? (short ? 'mi' : 'miles') : short ? 'km' : 'kilometres'
