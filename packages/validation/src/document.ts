import { z } from 'zod'
import { calendarDate, shortText, uuid } from './primitives.js'

export const documentType = z.enum([
  'INVOICE',
  'RECEIPT',
  'INSURANCE_POLICY',
  'INSPECTION_CERTIFICATE',
  'REGISTRATION',
  'WARRANTY',
  'MANUAL',
  'PHOTO',
  'OTHER',
])

export const documentAttachmentType = z.enum([
  'VEHICLE',
  'SERVICE_RECORD',
  'VEHICLE_INSPECTION',
  'INSURANCE_POLICY',
  'ROAD_TAX_RECORD',
  'EXPENSE',
])

/** A SHA-256 digest, lowercase hex. Verified against the stored object on finalisation. */
export const sha256Hex = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 checksum.')

export const createUploadSessionSchema = z.object({
  filename: shortText.min(1, 'The file needs a name.').max(255),
  contentType: shortText.min(1, 'The file type is missing.'),
  byteSize: z.number().int().positive('The file is empty.'),
  checksumSha256: sha256Hex,
  vehicleId: uuid.optional(),
  documentType: documentType.default('OTHER'),
  title: shortText.optional(),
  documentDate: calendarDate.optional(),
  expiresOn: calendarDate.optional(),
  attachedToType: documentAttachmentType.optional(),
  attachedToId: uuid.optional(),
})
export type CreateUploadSessionInput = z.infer<typeof createUploadSessionSchema>

export const updateDocumentSchema = z.object({
  title: shortText.optional(),
  documentType: documentType.optional(),
  documentDate: calendarDate.optional(),
  expiresOn: calendarDate.optional(),
})
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>
