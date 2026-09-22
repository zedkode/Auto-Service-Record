/**
 * EXP-001 — CSV serialisation.
 *
 * Shared rather than written inside the worker, because the API validates what can be
 * exported and the worker produces it; one definition of a column set keeps the two from
 * describing different files.
 */

/** A value that can appear in a cell. Dates arrive as ISO strings from the callers. */
export type CellValue = string | number | boolean | null | undefined

export interface Column<Row> {
  /** Header text, exactly as it appears in the first line of the file. */
  header: string
  value: (row: Row) => CellValue
}

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than as text.
 *
 * A vendor named `=cmd|'/c calc'!A1` in a service record is a CSV injection: Excel and
 * Google Sheets will evaluate it when the accountant opens the export, and the user who
 * typed it never had to attack this application at all — the export carried it out of our
 * system and into theirs. Prefixing with a single quote is the standard defusal: the cell
 * still reads correctly, and no spreadsheet evaluates it (SECURITY.md).
 */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r']

export function escapeCell(value: CellValue): string {
  if (value === null || value === undefined) return ''
  let text = String(value)

  if (FORMULA_LEADERS.some((c) => text.startsWith(c))) text = `'${text}`

  // Quote when the value contains anything that would otherwise break the row or column
  // boundaries; double any embedded quote, per RFC 4180.
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * CRLF line endings, per RFC 4180. Excel on Windows is the single most common consumer of
 * these files and is the least forgiving about bare newlines.
 */
export function toCsv<Row>(rows: readonly Row[], columns: readonly Column<Row>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/**
 * A UTF-8 byte-order mark. Excel assumes the system codepage for a CSV without one, so a
 * registration like `BUC 123Ș` or a vendor named `Kwik-Fit Köln` arrives as mojibake —
 * the same class of fault as the Content-Disposition bug in D-081, in a different place.
 */
export const UTF8_BOM = '﻿'

export function toCsvFile<Row>(rows: readonly Row[], columns: readonly Column<Row>[]): string {
  return UTF8_BOM + toCsv(rows, columns)
}

/** JSON export: an array of objects keyed by header, so both formats carry one shape. */
export function toJsonFile<Row>(rows: readonly Row[], columns: readonly Column<Row>[]): string {
  const objects = rows.map((row) => {
    const out: Record<string, CellValue> = {}
    for (const c of columns) out[c.header] = c.value(row) ?? null
    return out
  })
  return JSON.stringify(objects, null, 2) + '\n'
}
