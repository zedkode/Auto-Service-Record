import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  checkUpload,
  looksLike,
  storageKey,
  DOWNLOAD_TTL_SECONDS,
  S3Storage,
  type AllowedContentType,
  type ObjectStorage,
} from '@autoservices/storage'
import type { CreateUploadSessionInput, UpdateDocumentInput } from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { DomainError, Errors } from '../../common/errors.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** Enough bytes for every signature we check, and small enough to be free. */
const MAGIC_BYTES = 16

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger('Documents')
  private readonly storage: ObjectStorage

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.storage = new S3Storage({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'autoservices',
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      forcePathStyle: true,
    })
  }

  /**
   * Step 1 of the upload: validate the *declared* file, reserve a row in PENDING, and
   * hand back a short-lived presigned PUT (SECURITY.md §10).
   *
   * Nothing is trusted yet. The row is not servable and the object does not exist; both
   * only become real in `finalise`, after the bytes have been checked.
   */
  async createUploadSession(workspaceId: string, userId: string, input: CreateUploadSessionInput) {
    const verdict = checkUpload({
      filename: input.filename,
      contentType: input.contentType,
      byteSize: input.byteSize,
    })
    if (!verdict.ok) {
      throw new DomainError('VALIDATION_FAILED', verdict.detail, 422, { reason: verdict.reason })
    }

    const db = this.prisma.forWorkspace(workspaceId)
    if (input.vehicleId) {
      const vehicle = await db.vehicle.findFirst({
        where: { id: input.vehicleId, deletedAt: null },
        select: { id: true },
      })
      if (!vehicle) throw Errors.vehicleNotFound()
    }
    if (input.attachedToType && input.attachedToId) {
      await this.assertAttachmentExists(workspaceId, input.attachedToType, input.attachedToId)
    }

    // Created first so the id seeds the key: unguessable, and unique by construction.
    const created = await db.document.create({
      data: {
        workspaceId,
        vehicleId: input.vehicleId ?? null,
        uploadedByUserId: userId,
        // Replaced immediately below; a placeholder keeps the column NOT NULL.
        storageKey: `pending/${crypto.randomUUID()}`,
        originalFilename: input.filename,
        contentType: verdict.contentType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        documentType: input.documentType,
        title: input.title ?? null,
        documentDate: input.documentDate ? toDateOnly(input.documentDate) : null,
        expiresOn: input.expiresOn ? toDateOnly(input.expiresOn) : null,
        attachedToType: input.attachedToType ?? null,
        attachedToId: input.attachedToId ?? null,
        status: 'PENDING',
        scanStatus: 'PENDING',
      },
    })

    const key = storageKey({
      workspaceId,
      documentId: created.id,
      extension: verdict.extension,
    })
    await db.document.update({ where: { id: created.id }, data: { storageKey: key } })

    const session = await this.storage.createUploadSession(key, verdict.contentType, input.byteSize)

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'document.upload_requested',
      resourceType: 'document',
      resourceId: created.id,
      // Never the key or the URL: both are credentials of a sort (SECURITY.md §12).
      metadata: { filename: input.filename, contentType: verdict.contentType },
    })

    return { documentId: created.id, upload: session }
  }

  /**
   * Step 2: confirm the object is really there, really that size, really those bytes.
   *
   * A client that uploads something other than what it declared is exactly the case this
   * exists for, so a mismatch quarantines rather than silently accepting.
   */
  async finalise(workspaceId: string, documentId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const doc = await db.document.findFirst({ where: { id: documentId, deletedAt: null } })
    if (!doc) throw Errors.notFound('Document')
    if (doc.status === 'AVAILABLE') return this.view(doc)
    if (doc.status !== 'PENDING') throw Errors.documentNotAvailable()

    const head = await this.storage.head(doc.storageKey)
    if (!head) {
      throw new DomainError('VALIDATION_FAILED', 'The file was not uploaded.', 422)
    }

    const quarantine = async (reason: string) => {
      await db.document.update({
        where: { id: documentId },
        data: { status: 'QUARANTINED', scanStatus: 'INFECTED' },
      })
      await this.audit.record({
        workspaceId,
        actorUserId: userId,
        action: 'document.quarantined',
        resourceType: 'document',
        resourceId: documentId,
        metadata: { reason },
      })
      this.logger.warn({ documentId, reason }, 'document quarantined on finalisation')
      throw new DomainError(
        'VALIDATION_FAILED',
        'The uploaded file does not match what was declared, so it has been quarantined.',
        422,
        { reason },
      )
    }

    if (head.byteSize !== doc.byteSize) {
      await quarantine(`size_mismatch:${head.byteSize}!=${doc.byteSize}`)
    }

    // Magic bytes: the declared type is the uploader's claim, this is what it actually is.
    const magic = await this.storage.readHead(doc.storageKey, MAGIC_BYTES)
    if (!looksLike(doc.contentType as AllowedContentType, magic)) {
      await quarantine(`content_mismatch:${doc.contentType}`)
    }

    if (doc.checksumSha256) {
      const actual = await this.sha256Of(doc.storageKey, doc.byteSize)
      if (actual !== doc.checksumSha256) await quarantine('checksum_mismatch')
    }

    const updated = await db.document.update({
      where: { id: documentId },
      data: {
        status: 'AVAILABLE',
        // Honest: no scanner is configured, so this is SKIPPED, not CLEAN.
        scanStatus: 'SKIPPED',
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'document.uploaded',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { byteSize: doc.byteSize, contentType: doc.contentType },
    })
    return this.view(updated)
  }

  /**
   * Step 3: a short-lived download URL, issued only after the row has been found inside
   * THIS workspace and confirmed servable.
   */
  async downloadUrl(workspaceId: string, documentId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const doc = await db.document.findFirst({ where: { id: documentId, deletedAt: null } })
    // 404 rather than 403: whether a document exists in another tenant is not ours to
    // confirm (ARCHITECTURE.md §4).
    if (!doc) throw Errors.notFound('Document')
    // A quarantined or still-pending object is never served, whatever the permissions.
    if (doc.status !== 'AVAILABLE') throw Errors.documentNotAvailable()

    const url = await this.storage.createDownloadUrl(
      doc.storageKey,
      doc.originalFilename,
      DOWNLOAD_TTL_SECONDS,
    )
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'document.downloaded',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { filename: doc.originalFilename },
    })
    return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS }
  }

  async list(
    workspaceId: string,
    filters: { vehicleId?: string; attachedToType?: string; attachedToId?: string } = {},
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      // Pending and quarantined rows are deliberately hidden: a half-uploaded file in the
      // list looks like a bug, and a quarantined one invites someone to try to open it.
      status: 'AVAILABLE',
    }
    if (filters.vehicleId) where.vehicleId = filters.vehicleId
    if (filters.attachedToType) where.attachedToType = filters.attachedToType as never
    if (filters.attachedToId) where.attachedToId = filters.attachedToId

    const rows = await db.document.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    })
    return rows.map((r) => this.view(r))
  }

  async update(
    workspaceId: string,
    documentId: string,
    userId: string,
    input: UpdateDocumentInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const doc = await db.document.findFirst({ where: { id: documentId, deletedAt: null } })
    if (!doc) throw Errors.notFound('Document')

    const updated = await db.document.update({
      where: { id: documentId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.documentType !== undefined ? { documentType: input.documentType } : {}),
        ...(input.documentDate !== undefined
          ? { documentDate: toDateOnly(input.documentDate) }
          : {}),
        ...(input.expiresOn !== undefined ? { expiresOn: toDateOnly(input.expiresOn) } : {}),
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'document.updated',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { fields: Object.keys(input) },
    })
    return this.view(updated)
  }

  /**
   * Soft delete. The object stays until retention-based reaping removes it (DOC-108), so
   * an accidental delete is recoverable and an audit trail still resolves to something.
   */
  async remove(workspaceId: string, documentId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const doc = await db.document.findFirst({ where: { id: documentId, deletedAt: null } })
    if (!doc) throw Errors.notFound('Document')

    await db.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date(), status: 'DELETED' },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'document.deleted',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { soft: true, filename: doc.originalFilename },
    })
  }

  private async sha256Of(key: string, byteSize: number): Promise<string> {
    const bytes = await this.storage.readHead(key, byteSize)
    return createHash('sha256').update(bytes).digest('hex')
  }

  /** The attachment target must exist inside this workspace, or it is not a target. */
  private async assertAttachmentExists(workspaceId: string, type: string, id: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const found = await (async () => {
      switch (type) {
        case 'VEHICLE':
          return db.vehicle.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
        case 'SERVICE_RECORD':
          return db.serviceRecord.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          })
        case 'VEHICLE_INSPECTION':
          return db.vehicleInspection.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          })
        case 'INSURANCE_POLICY':
          return db.insurancePolicy.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          })
        case 'ROAD_TAX_RECORD':
          return db.roadTaxRecord.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          })
        case 'EXPENSE':
          return db.expense.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
        default:
          return null
      }
    })()
    if (!found) throw Errors.notFound('Attachment target')
  }

  private view(d: {
    id: string
    vehicleId: string | null
    originalFilename: string
    contentType: string
    byteSize: number
    documentType: string
    title: string | null
    documentDate: Date | null
    expiresOn: Date | null
    attachedToType: string | null
    attachedToId: string | null
    status: string
    scanStatus: string
    createdAt: Date
  }) {
    return {
      id: d.id,
      vehicleId: d.vehicleId,
      filename: d.originalFilename,
      contentType: d.contentType,
      byteSize: d.byteSize,
      documentType: d.documentType,
      title: d.title,
      documentDate: dateStr(d.documentDate),
      expiresOn: dateStr(d.expiresOn),
      attachedToType: d.attachedToType,
      attachedToId: d.attachedToId,
      status: d.status,
      scanStatus: d.scanStatus,
      createdAt: d.createdAt.toISOString(),
      // The storage key is deliberately absent: it is the only address of the object and
      // nothing in the UI needs it.
    }
  }
}
