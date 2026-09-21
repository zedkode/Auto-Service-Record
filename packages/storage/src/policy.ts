/**
 * Upload policy (SECURITY.md §10). Pure functions, no I/O — which is what makes the
 * rules that keep hostile files out of the platform cheap to test exhaustively.
 */

/**
 * The only types accepted. SVG is deliberately absent: it is XML that executes script in
 * a browser, so serving one from our own origin would be a stored-XSS vector.
 */
export const ALLOWED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
} as const

export type AllowedContentType = keyof typeof ALLOWED_TYPES

/** 20 MB per file (SECURITY.md §10). */
export const MAX_BYTES = 20 * 1024 * 1024

export type UploadRejection =
  | 'CONTENT_TYPE_NOT_ALLOWED'
  | 'EXTENSION_NOT_ALLOWED'
  | 'TYPE_EXTENSION_MISMATCH'
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'FILENAME_INVALID'

export type UploadCheck =
  | { ok: true; contentType: AllowedContentType; extension: string }
  | { ok: false; reason: UploadRejection; detail: string }

/** Lowercased final extension, including the dot. Empty when there is none. */
export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/**
 * Validates a declared upload before any object is created.
 *
 * The declared type and the extension must BOTH be allowed and must agree with each
 * other. Checking only one lets a caller upload `invoice.pdf` declared as `image/png`, or
 * an executable named `.pdf`, and the disagreement is exactly where an attacker lives.
 */
export function checkUpload(input: {
  filename: string
  contentType: string
  byteSize: number
}): UploadCheck {
  const filename = input.filename.trim()
  if (!filename || filename.length > 255 || filename.includes('\u0000')) {
    return { ok: false, reason: 'FILENAME_INVALID', detail: 'The file name is not usable.' }
  }

  if (input.byteSize <= 0) {
    return { ok: false, reason: 'EMPTY', detail: 'The file is empty.' }
  }
  if (input.byteSize > MAX_BYTES) {
    return {
      ok: false,
      reason: 'TOO_LARGE',
      detail: `Files must be ${Math.floor(MAX_BYTES / 1024 / 1024)} MB or smaller.`,
    }
  }

  // Strip any parameters: "image/jpeg; charset=binary" is still image/jpeg.
  const declared = input.contentType.split(';')[0]!.trim().toLowerCase()
  if (!(declared in ALLOWED_TYPES)) {
    return {
      ok: false,
      reason: 'CONTENT_TYPE_NOT_ALLOWED',
      detail: `${declared || 'That file type'} cannot be uploaded.`,
    }
  }
  const contentType = declared as AllowedContentType

  const extension = extensionOf(filename)
  const permitted = ALLOWED_TYPES[contentType] as readonly string[]
  if (!extension) {
    return { ok: false, reason: 'EXTENSION_NOT_ALLOWED', detail: 'The file has no extension.' }
  }
  const everyAllowedExtension = Object.values(ALLOWED_TYPES).flat() as string[]
  if (!everyAllowedExtension.includes(extension)) {
    return {
      ok: false,
      reason: 'EXTENSION_NOT_ALLOWED',
      detail: `${extension} files cannot be uploaded.`,
    }
  }
  if (!permitted.includes(extension)) {
    return {
      ok: false,
      reason: 'TYPE_EXTENSION_MISMATCH',
      detail: `A ${contentType} file cannot have a ${extension} extension.`,
    }
  }

  return { ok: true, contentType, extension }
}

/**
 * Object key: `workspaces/{workspaceId}/{yyyy}/{mm}/{uuidv7}{ext}` (DATABASE.md §4.9).
 *
 * Tenant-namespaced so a misconfigured policy still fails closed per workspace, and
 * unguessable so possession of one key tells you nothing about any other. The original
 * filename is metadata and is NEVER part of the key — it is attacker-controlled and would
 * otherwise carry path separators and encoding tricks into the object store.
 */
export function storageKey(input: {
  workspaceId: string
  documentId: string
  extension: string
  now?: Date
}): string {
  const now = input.now ?? new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `workspaces/${input.workspaceId}/${yyyy}/${mm}/${input.documentId}${input.extension}`
}

/**
 * Magic-byte check. The declared type is a claim by the uploader; this is what the file
 * actually starts with.
 *
 * HEIC is an ISO-BMFF container whose brand sits at offset 8, so it is matched
 * separately rather than by a fixed prefix.
 */
const SIGNATURES: Record<Exclude<AllowedContentType, 'image/heic'>, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
}

export function looksLike(contentType: AllowedContentType, head: Uint8Array): boolean {
  if (contentType === 'image/heic') {
    // ....ftypheic / heix / hevc / mif1
    if (head.length < 12) return false
    const brand = String.fromCharCode(...head.slice(4, 12))
    return brand.startsWith('ftyp')
  }

  const starts = SIGNATURES[contentType]
  const matched = starts.some((sig) => sig.every((byte, i) => head[i] === byte))
  if (!matched) return false

  if (contentType === 'image/webp') {
    if (head.length < 12) return false
    return String.fromCharCode(...head.slice(8, 12)) === 'WEBP'
  }
  return true
}
