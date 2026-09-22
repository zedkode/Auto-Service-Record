import { describe, expect, it } from 'vitest'
import { escapeCell, toCsv, toCsvFile, toJsonFile, UTF8_BOM, type Column } from './csv.js'
import { exportFilename, EXPENSE_COLUMNS, type ExpenseRow } from './kinds.js'

interface Row {
  a: string | null
  b: number | null
}
const columns: Column<Row>[] = [
  { header: 'A', value: (r) => r.a },
  { header: 'B', value: (r) => r.b },
]

describe('the rule: a cell can never break out of its cell', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeCell('Kwik Fit')).toBe('Kwik Fit')
    expect(escapeCell(42)).toBe('42')
    expect(escapeCell(true)).toBe('true')
  })

  it('writes null and undefined as empty, not as the word "null"', () => {
    expect(escapeCell(null)).toBe('')
    expect(escapeCell(undefined)).toBe('')
  })

  it('quotes a value containing a comma', () => {
    expect(escapeCell('Brakes, front')).toBe('"Brakes, front"')
  })

  it('quotes and doubles an embedded quote', () => {
    expect(escapeCell('15" alloys')).toBe('"15"" alloys"')
  })

  it('quotes a value containing a newline, so one record stays one row', () => {
    expect(escapeCell('Line one\nLine two')).toBe('"Line one\nLine two"')
    expect(escapeCell('Line one\r\nLine two')).toBe('"Line one\r\nLine two"')
  })
})

describe('the rule: an export never carries a formula into a spreadsheet', () => {
  // A vendor name is user input. Without this, an export hands the attack to whoever opens
  // the file — usually an accountant on a different machine, who never touched this app.
  it.each([
    ['=1+1', "'=1+1"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    // Apostrophes need no CSV quoting — only " , CR and LF do — so this stays unquoted.
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
  ])('defuses %s', (input, expected) => {
    expect(escapeCell(input)).toBe(expected)
  })

  it('defuses a tab leader', () => {
    // Prefixed but not quoted: a tab inside a field is legal unquoted CSV.
    expect(escapeCell('\t=1+1')).toBe("'\t=1+1")
  })

  it('quotes as well as prefixes when the value ALSO needs quoting', () => {
    expect(escapeCell('=SUM(A1,B1)')).toBe('"\'=SUM(A1,B1)"')
  })

  it('does not mangle a value that merely contains an equals sign', () => {
    expect(escapeCell('tyre pressure = 32psi')).toBe('tyre pressure = 32psi')
  })

  it('defuses a negative number written as text but leaves a real number alone', () => {
    // A numeric -50 is a number, not a formula, and must stay usable as one.
    expect(escapeCell(-50)).toBe("'-50")
  })
})

describe('the rule: the file is RFC 4180', () => {
  it('writes a header row followed by the data, CRLF separated', () => {
    const csv = toCsv([{ a: 'x', b: 1 }], columns)
    expect(csv).toBe('A,B\r\nx,1\r\n')
  })

  it('writes just the header when there is nothing to export', () => {
    // An empty file with no header is indistinguishable from a broken export.
    expect(toCsv([], columns)).toBe('A,B\r\n')
  })

  it('prefixes the file with a BOM so Excel reads UTF-8', () => {
    const file = toCsvFile([{ a: 'Köln', b: 1 }], columns)
    expect(file.startsWith(UTF8_BOM)).toBe(true)
    expect(file).toContain('Köln')
  })
})

describe('the rule: JSON and CSV describe the same thing', () => {
  it('keys JSON objects by the same headers the CSV uses', () => {
    const json = JSON.parse(toJsonFile([{ a: 'x', b: 2 }], columns))
    expect(json).toEqual([{ A: 'x', B: 2 }])
  })

  it('writes a missing value as null rather than dropping the key', () => {
    const json = JSON.parse(toJsonFile([{ a: null, b: null }], columns))
    expect(json).toEqual([{ A: null, B: null }])
  })

  it('does NOT prefix quotes in JSON — the formula risk is a spreadsheet one', () => {
    const json = JSON.parse(toJsonFile([{ a: '=1+1', b: 1 }], columns))
    expect(json[0].A).toBe('=1+1')
  })

  it('writes an empty array for an empty export', () => {
    expect(JSON.parse(toJsonFile([], columns))).toEqual([])
  })
})

describe('the rule: money survives the trip as text', () => {
  it('writes a decimal amount exactly as stored', () => {
    const row: ExpenseRow = {
      incurredOn: '2026-03-01',
      category: 'Servicing & repairs',
      description: 'Major service',
      vendorName: 'Kwik Fit',
      amount: '1234.50',
      currency: 'GBP',
      vehicle: 'Ford Mondeo',
      registrationNumber: 'AB16 CDE',
      odometer: 120_000,
      odometerUnit: 'MILES',
      source: 'SERVICE',
    }
    const csv = toCsv([row], EXPENSE_COLUMNS)
    // Not 1234.5, and not 1,234.50 — the first loses a penny's precision in the reader,
    // the second breaks the column.
    expect(csv).toContain('1234.50')
    expect(csv).not.toContain('1234.5,')
  })
})

describe('filenames', () => {
  it('names the file for its contents and its date', () => {
    expect(exportFilename('EXPENSES', 'CSV', '2026-09-22')).toBe(
      'autoservices-expenses-2026-09-22.csv',
    )
    expect(exportFilename('ODOMETER', 'JSON', '2026-09-22')).toBe(
      'autoservices-mileage-2026-09-22.json',
    )
  })
})
