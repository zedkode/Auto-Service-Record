/**
 * EXP-002 — one vehicle's complete history, as a document.
 *
 * The purpose is PRODUCT.md §4.4: proving history at sale. A car with a documented history
 * sells for more, and this is the artefact that does the proving — so the layout matters
 * less than two things.
 *
 * **It must never overstate what it is.** This is a record of what the owner entered, not
 * a verified or certified history, and it says so on the first page and in the footer of
 * every other. A document handed to a buyer that implies provenance it does not have is
 * the one way this feature could do real harm.
 *
 * **It must not leak the documents themselves.** Receipts and certificates are private
 * objects behind signed URLs (HARD-003); the PDF lists what exists, never the files or any
 * link to them.
 */
import PDFDocument from 'pdfkit'

export interface HistoryVehicle {
  manufacturer: string
  model: string
  trim: string | null
  modelYear: number | null
  registrationNumber: string | null
  vin: string | null
  colour: string | null
  fuelType: string | null
  transmission: string | null
  currentOdometer: number | null
  currentOdometerUnit: string | null
  purchasedOn: string | null
  status: string
}

export interface HistoryService {
  performedOn: string
  title: string
  category: string | null
  workshopName: string | null
  odometer: number | null
  odometerUnit: string | null
  totalAmount: string | null
  currency: string
  notes: string | null
  parts: Array<{ name: string; brand: string | null; partNumber: string | null }>
}

export interface HistoryInspection {
  performedOn: string
  expiresOn: string | null
  inspectionType: string
  result: string
  centreName: string | null
  odometer: number | null
  advisories: Array<{ severity: string; description: string; resolved: boolean }>
}

export interface HistoryOdometer {
  recordedOn: string
  value: number
  unit: string
  isCorrection: boolean
}

export interface HistoryWarranty {
  warrantyType: string
  providerName: string | null
  startsOn: string
  expiresOn: string | null
  distanceLimit: number | null
  distanceLimitUnit: string | null
}

export interface VehicleHistory {
  vehicle: HistoryVehicle
  services: HistoryService[]
  inspections: HistoryInspection[]
  odometer: HistoryOdometer[]
  warranties: HistoryWarranty[]
  /** Names and dates only. The files themselves never leave storage. */
  documents: Array<{ title: string; kind: string; issuedOn: string | null }>
  fuelSummary: { fills: number; firstOn: string | null; lastOn: string | null } | null
  generatedOn: string
  workspaceName: string
}

const INK = '#111827'
const MUTED = '#6b7280'
const RULE = '#e5e7eb'
const PAGE_MARGIN = 48

const money = (amount: string | null, currency: string) =>
  amount === null ? '—' : `${currency} ${amount}`

const distance = (value: number | null, unit: string | null) =>
  value === null ? '—' : `${value.toLocaleString('en-GB')} ${unit === 'KILOMETERS' ? 'km' : 'mi'}`

const date = (iso: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`
}

/** Builds the PDF and resolves with its bytes. */
export function buildVehicleHistoryPdf(history: VehicleHistory): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    // Required for `bufferedPageRange`/`switchToPage`: the footers are written after the
    // content, because the page count is not known until the content has been laid out.
    bufferPages: true,
    margins: { top: PAGE_MARGIN, bottom: 64, left: PAGE_MARGIN, right: PAGE_MARGIN },
    info: {
      Title: `${history.vehicle.manufacturer} ${history.vehicle.model} — vehicle history`,
      Author: history.workspaceName,
      Subject: 'Vehicle history record',
    },
  })

  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const v = history.vehicle
  const width = doc.page.width - PAGE_MARGIN * 2

  // --- cover -----------------------------------------------------------------------
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(24)
  doc.text(`${v.manufacturer} ${v.model}`, { width })
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
  doc.text([v.trim, v.modelYear, v.colour].filter(Boolean).join(' · ') || 'Vehicle history', {
    width,
  })
  doc.moveDown(0.8)

  doc.fontSize(10).fillColor(INK)
  pairs(doc, width, [
    ['Registration', v.registrationNumber ?? '—'],
    ['VIN', v.vin ?? '—'],
    ['Fuel', v.fuelType ?? '—'],
    ['Transmission', v.transmission ?? '—'],
    ['Current mileage', distance(v.currentOdometer, v.currentOdometerUnit)],
    ['Owned since', date(v.purchasedOn)],
  ])

  doc.moveDown(0.6)
  rule(doc, width)
  doc.moveDown(0.6)

  /**
   * The disclaimer sits above the history, not buried at the end. A buyer reading this
   * document should learn what it is before they read what it says.
   */
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
  doc.text('What this document is', { width })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  doc.text(
    'A record of what the owner entered into AutoServices. It is not a certified or ' +
      'independently verified history, and nothing here has been checked against a ' +
      'manufacturer, a workshop or a national register. Treat it as the owner’s account, ' +
      'supported by the receipts and certificates they hold.',
    { width, align: 'left' },
  )
  doc.moveDown(0.4)
  doc.fontSize(8.5)
  doc.text(
    `Prepared ${date(history.generatedOn)} from ${history.services.length} service ` +
      `record${history.services.length === 1 ? '' : 's'}, ` +
      `${history.inspections.length} inspection${history.inspections.length === 1 ? '' : 's'} and ` +
      `${history.odometer.length} mileage reading${history.odometer.length === 1 ? '' : 's'}.`,
    { width },
  )

  // --- services --------------------------------------------------------------------
  section(doc, width, 'Service history')
  if (history.services.length === 0) {
    empty(doc, width, 'No services recorded.')
  } else {
    for (const s of history.services) {
      entry(doc, width, {
        left: date(s.performedOn),
        title: s.title,
        right: money(s.totalAmount, s.currency),
        lines: [
          [s.category, s.workshopName].filter(Boolean).join(' · ') || null,
          s.odometer !== null ? `At ${distance(s.odometer, s.odometerUnit)}` : null,
          s.parts.length > 0
            ? `Parts: ${s.parts
                .map((p) => [p.name, p.brand, p.partNumber].filter(Boolean).join(' '))
                .join('; ')}`
            : null,
          s.notes,
        ],
      })
    }
  }

  // --- inspections -----------------------------------------------------------------
  section(doc, width, 'Inspections')
  if (history.inspections.length === 0) {
    empty(doc, width, 'No inspections recorded.')
  } else {
    for (const i of history.inspections) {
      entry(doc, width, {
        left: date(i.performedOn),
        // "MOT — unknown" reads as though something is wrong with the MOT. An unrecorded
        // result is a gap in the record, and saying so is both clearer and more honest.
        title:
          i.result === 'UNKNOWN'
            ? `${i.inspectionType === 'OTHER' ? 'Inspection' : i.inspectionType} — result not recorded`
            : `${i.inspectionType === 'OTHER' ? 'Inspection' : i.inspectionType} — ${i.result
                .replace(/_/g, ' ')
                .toLowerCase()}`,
        right: i.expiresOn ? `Valid to ${date(i.expiresOn)}` : '',
        lines: [
          [i.centreName, i.odometer !== null ? `at ${i.odometer.toLocaleString('en-GB')}` : null]
            .filter(Boolean)
            .join(' · ') || null,
          // Advisories are part of an honest history: a pass with advisories is not a
          // clean pass, and hiding them here would be the document lying by omission.
          ...i.advisories.map(
            (a) =>
              `${a.severity}: ${a.description}${a.resolved ? ' (resolved)' : ' (outstanding)'}`,
          ),
        ],
      })
    }
  }

  // --- warranties ------------------------------------------------------------------
  if (history.warranties.length > 0) {
    section(doc, width, 'Warranties')
    for (const w of history.warranties) {
      entry(doc, width, {
        left: date(w.startsOn),
        title: `${w.warrantyType.replace(/_/g, ' ').toLowerCase()}${w.providerName ? ` — ${w.providerName}` : ''}`,
        right: w.expiresOn ? `to ${date(w.expiresOn)}` : '',
        lines: [
          w.distanceLimit !== null
            ? `Mileage limit ${distance(w.distanceLimit, w.distanceLimitUnit)}`
            : null,
        ],
      })
    }
  }

  // --- mileage ---------------------------------------------------------------------
  section(doc, width, 'Mileage record')
  if (history.odometer.length === 0) {
    empty(doc, width, 'No mileage readings recorded.')
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(INK)
    // Three columns of dates and readings: a mileage log is the part a buyer checks for
    // consistency, so it is shown in full rather than summarised.
    const perColumn = Math.ceil(history.odometer.length / 3)
    const columnWidth = width / 3
    const top = doc.y
    let maxY = top
    for (let c = 0; c < 3; c++) {
      const slice = history.odometer.slice(c * perColumn, (c + 1) * perColumn)
      if (slice.length === 0) continue
      doc.y = top
      for (const o of slice) {
        doc.fillColor(o.isCorrection ? MUTED : INK)
        doc.text(
          `${date(o.recordedOn)}   ${distance(o.value, o.unit)}${o.isCorrection ? ' (corrected)' : ''}`,
          PAGE_MARGIN + c * columnWidth,
          doc.y,
          { width: columnWidth - 8 },
        )
      }
      maxY = Math.max(maxY, doc.y)
    }
    doc.x = PAGE_MARGIN
    doc.y = maxY
  }

  // --- fuel ------------------------------------------------------------------------
  if (history.fuelSummary && history.fuelSummary.fills > 0) {
    section(doc, width, 'Fuel and charging')
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    doc.text(
      `${history.fuelSummary.fills.toLocaleString('en-GB')} fills recorded between ` +
        `${date(history.fuelSummary.firstOn)} and ${date(history.fuelSummary.lastOn)}.`,
      { width },
    )
  }

  // --- documents index -------------------------------------------------------------
  section(doc, width, 'Documents held')
  if (history.documents.length === 0) {
    empty(doc, width, 'No documents attached.')
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    // Names only. The files stay behind signed URLs; an index tells a buyer what to ask
    // for without this PDF becoming a way to hand them out.
    doc.text('Listed so a buyer knows what to ask to see. The files are not included.', {
      width,
    })
    doc.moveDown(0.3)
    doc.fillColor(INK)
    for (const d of history.documents) {
      doc.text(`${date(d.issuedOn)}   ${d.title}  (${d.kind.replace(/_/g, ' ').toLowerCase()})`, {
        width,
      })
    }
  }

  stampFooters(doc, history)
  doc.end()
  return done
}

// --- small layout helpers ----------------------------------------------------------

function rule(doc: PDFKit.PDFDocument, width: number) {
  doc
    .strokeColor(RULE)
    .lineWidth(0.75)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + width, doc.y)
    .stroke()
}

function section(doc: PDFKit.PDFDocument, width: number, title: string) {
  // Keep a heading with at least a little of its content rather than stranding it.
  if (doc.y > doc.page.height - 140) doc.addPage()
  doc.moveDown(1)
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(title, PAGE_MARGIN, doc.y, { width })
  doc.moveDown(0.3)
  rule(doc, width)
  doc.moveDown(0.5)
}

function empty(doc: PDFKit.PDFDocument, width: number, message: string) {
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MUTED).text(message, { width })
}

function pairs(doc: PDFKit.PDFDocument, width: number, items: Array<[string, string]>) {
  const columnWidth = width / 3
  const top = doc.y
  items.forEach(([label, value], i) => {
    const column = i % 3
    const row = Math.floor(i / 3)
    const x = PAGE_MARGIN + column * columnWidth
    const y = top + row * 32
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x, y, {
        width: columnWidth - 8,
      })
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(INK)
      .text(value, x, y + 11, {
        width: columnWidth - 8,
      })
  })
  doc.x = PAGE_MARGIN
  doc.y = top + Math.ceil(items.length / 3) * 32
}

function entry(
  doc: PDFKit.PDFDocument,
  width: number,
  e: { left: string; title: string; right: string; lines: Array<string | null> },
) {
  if (doc.y > doc.page.height - 110) doc.addPage()
  const top = doc.y
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(e.left, PAGE_MARGIN, top, { width: 78 })
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(INK)
    .text(e.title, PAGE_MARGIN + 84, top, { width: width - 84 - 96 })
  if (e.right) {
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(INK)
      .text(e.right, PAGE_MARGIN + width - 96, top, { width: 96, align: 'right' })
  }
  let y = Math.max(doc.y, top + 13)
  for (const line of e.lines) {
    if (!line) continue
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(line, PAGE_MARGIN + 84, y, { width: width - 84 })
    y = doc.y
  }
  doc.x = PAGE_MARGIN
  doc.y = y + 7
}

/**
 * Page numbers and the standing caveat, written after the content so the page count is
 * known. Every page carries it: a document is read a page at a time, and page four on its
 * own must not read as a certified record.
 */
function stampFooters(doc: PDFKit.PDFDocument, history: VehicleHistory) {
  const range = doc.bufferedPageRange()
  const v = history.vehicle
  const label = [v.manufacturer, v.model, v.registrationNumber].filter(Boolean).join(' · ')
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const y = doc.page.height - 44
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `${label} — owner-entered record, not a verified history · prepared ${date(history.generatedOn)}`,
        PAGE_MARGIN,
        y,
        { width: doc.page.width - PAGE_MARGIN * 2 - 60, lineBreak: false },
      )
    doc.text(`${i - range.start + 1} / ${range.count}`, doc.page.width - PAGE_MARGIN - 60, y, {
      width: 60,
      align: 'right',
      lineBreak: false,
    })
  }
}
