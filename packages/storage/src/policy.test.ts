import { describe, expect, it } from 'vitest'
import { checkUpload, extensionOf, looksLike, storageKey, MAX_BYTES } from './policy.js'
import { contentDisposition, sanitiseFilename } from './s3.storage.js'

const ok = (over: Partial<Parameters<typeof checkUpload>[0]> = {}) =>
  checkUpload({
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    byteSize: 1024,
    ...over,
  })

describe('checkUpload — allow-list', () => {
  it('accepts every permitted type with a matching extension', () => {
    const cases: Array<[string, string]> = [
      ['application/pdf', 'receipt.pdf'],
      ['image/jpeg', 'photo.jpg'],
      ['image/jpeg', 'photo.jpeg'],
      ['image/png', 'scan.png'],
      ['image/webp', 'shot.webp'],
      ['image/heic', 'iphone.heic'],
    ]
    for (const [contentType, filename] of cases) {
      expect(ok({ contentType, filename }).ok, `${contentType} ${filename}`).toBe(true)
    }
  })

  it('REFUSES SVG, which executes script in a browser', () => {
    const r = ok({ contentType: 'image/svg+xml', filename: 'logo.svg' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('CONTENT_TYPE_NOT_ALLOWED')
  })

  it('refuses executables and archives however they are dressed up', () => {
    for (const [contentType, filename] of [
      ['application/x-msdownload', 'setup.exe'],
      ['application/zip', 'bundle.zip'],
      ['text/html', 'page.html'],
      ['application/javascript', 'x.js'],
    ] as Array<[string, string]>) {
      expect(ok({ contentType, filename }).ok, filename).toBe(false)
    }
  })

  it('refuses a permitted type carrying a forbidden extension', () => {
    // The classic: declare something harmless, ship something else.
    const r = ok({ contentType: 'application/pdf', filename: 'payload.exe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('EXTENSION_NOT_ALLOWED')
  })

  it('refuses a permitted extension that disagrees with the declared type', () => {
    const r = ok({ contentType: 'application/pdf', filename: 'photo.png' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('TYPE_EXTENSION_MISMATCH')
  })

  it('is not fooled by a double extension', () => {
    // Only the FINAL extension counts; "invoice.pdf.exe" is an exe.
    expect(ok({ contentType: 'application/pdf', filename: 'invoice.pdf.exe' }).ok).toBe(false)
    expect(ok({ contentType: 'application/pdf', filename: 'invoice.exe.pdf' }).ok).toBe(true)
  })

  it('ignores case and content-type parameters', () => {
    expect(ok({ contentType: 'APPLICATION/PDF', filename: 'A.PDF' }).ok).toBe(true)
    expect(ok({ contentType: 'image/jpeg; charset=binary', filename: 'a.JPG' }).ok).toBe(true)
  })

  it('refuses a file with no extension at all', () => {
    const r = ok({ filename: 'invoice' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('EXTENSION_NOT_ALLOWED')
  })

  it('refuses a dotfile, which has no extension despite the dot', () => {
    expect(ok({ filename: '.pdf' }).ok).toBe(false)
  })
})

describe('checkUpload — size', () => {
  it('refuses an empty file', () => {
    const r = ok({ byteSize: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('EMPTY')
  })

  it('accepts exactly the cap and refuses one byte more', () => {
    expect(ok({ byteSize: MAX_BYTES }).ok).toBe(true)
    const r = ok({ byteSize: MAX_BYTES + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('TOO_LARGE')
  })

  it('refuses a negative size', () => {
    expect(ok({ byteSize: -1 }).ok).toBe(false)
  })
})

describe('checkUpload — filename', () => {
  it('refuses a name containing a null byte', () => {
    const r = ok({ filename: 'invoice\u0000.pdf' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('FILENAME_INVALID')
  })

  it('refuses an absurdly long name', () => {
    expect(ok({ filename: `${'a'.repeat(300)}.pdf` }).ok).toBe(false)
  })
})

describe('extensionOf', () => {
  it('takes the final extension and lowercases it', () => {
    expect(extensionOf('a/b/c/Invoice.PDF')).toBe('.pdf')
    expect(extensionOf('archive.tar.gz')).toBe('.gz')
  })
  it('returns empty when there is none', () => {
    expect(extensionOf('invoice')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
  })
})

describe('storageKey', () => {
  const key = storageKey({
    workspaceId: 'ws-1',
    documentId: '01a0c0d0-d1b9-724c-aab0-6a752b3a2a9c',
    extension: '.pdf',
    now: new Date('2026-09-21T10:00:00Z'),
  })

  it('namespaces by tenant and date', () => {
    expect(key).toBe('workspaces/ws-1/2026/09/01a0c0d0-d1b9-724c-aab0-6a752b3a2a9c.pdf')
  })

  it('NEVER contains the original filename', () => {
    // The filename is attacker-controlled; keeping it out of the key keeps path
    // separators and encoding tricks out of the object store.
    const k = storageKey({
      workspaceId: 'ws-1',
      documentId: 'doc-1',
      extension: '.pdf',
      now: new Date('2026-09-21T10:00:00Z'),
    })
    expect(k).not.toMatch(/invoice/i)
    expect(k.split('/')).toHaveLength(5)
  })

  it('pads the month so keys sort correctly', () => {
    const k = storageKey({
      workspaceId: 'w',
      documentId: 'd',
      extension: '.png',
      now: new Date('2026-01-05T00:00:00Z'),
    })
    expect(k).toContain('/2026/01/')
  })
})

describe('looksLike — magic bytes', () => {
  const bytes = (...b: number[]) => new Uint8Array(b)

  it('recognises a real PDF', () => {
    expect(looksLike('application/pdf', bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true)
  })

  it('rejects a file that merely claims to be a PDF', () => {
    // An HTML page renamed to .pdf and declared as application/pdf.
    expect(looksLike('application/pdf', bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c))).toBe(false)
  })

  it('recognises JPEG and PNG', () => {
    expect(looksLike('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true)
    expect(looksLike('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true)
  })

  it('requires WEBP to be RIFF *and* carry the WEBP fourcc', () => {
    const riffOnly = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20)
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)
    expect(looksLike('image/webp', riffOnly)).toBe(false)
    expect(looksLike('image/webp', webp)).toBe(true)
  })

  it('recognises HEIC by its ISO-BMFF brand at offset 4', () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, ...[...'ftypheic'].map((c) => c.charCodeAt(0))])
    expect(looksLike('image/heic', heic)).toBe(true)
  })

  it('rejects a truncated head rather than guessing', () => {
    expect(looksLike('image/png', bytes(0x89, 0x50))).toBe(false)
    expect(looksLike('image/heic', bytes(0, 0))).toBe(false)
  })
})

describe('sanitiseFilename', () => {
  it('strips characters that could forge a response header', () => {
    expect(sanitiseFilename('in"voice\r\nX-Evil: 1.pdf')).toBe('invoiceX-Evil: 1.pdf')
  })
  it('flattens path separators', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('.._.._etc_passwd')
  })
  it('never returns an empty name', () => {
    expect(sanitiseFilename('   ')).toBe('document')
  })
})

describe('contentDisposition (RFC 6266)', () => {
  it('always forces a download', () => {
    expect(contentDisposition('invoice.pdf')).toMatch(/^attachment;/)
  })

  it('sends a plain ASCII name for clients that only read filename=', () => {
    expect(contentDisposition('invoice.pdf')).toContain('filename="invoice.pdf"')
  })

  it('encodes a non-ASCII name instead of mangling it in a latin-1 header', () => {
    // Placed raw, "фактура.pdf" arrives as mojibake; filename* is the RFC's answer.
    const value = contentDisposition('фактура.pdf')
    expect(value).toContain("filename*=UTF-8''")
    expect(value).toContain(encodeURIComponent('фактура.pdf'))
    // And the ASCII fallback carries no bytes outside the printable range.
    const fallback = /filename="([^"]*)"/.exec(value)![1]!
    expect(fallback).toMatch(/^[\x20-\x7e]*$/)
  })

  it('STRIPS a right-to-left override, which fakes an extension', () => {
    // "invoice\u202Efdp.pdf" renders as "invoicefdp.pdf" reversed — a way to show .exe
    // as .pdf and vice versa.
    const value = contentDisposition('invoice\u202Efdp.pdf')
    expect(value).not.toContain('\u202e')
    expect(value).not.toContain('%E2%80%AE')
  })

  it('strips every bidi control, not just the override', () => {
    for (const ch of ['\u202a', '\u202b', '\u202c', '\u202d', '\u2066', '\u2069']) {
      expect(sanitiseFilename(`a${ch}b.pdf`)).toBe('ab.pdf')
    }
  })

  it('still refuses to let a filename forge a second header', () => {
    const value = contentDisposition('a"\r\nX-Evil: 1.pdf')
    expect(value).not.toContain('\r')
    expect(value).not.toContain('\n')
    expect(value).not.toContain('X-Evil: 1"')
  })
})
