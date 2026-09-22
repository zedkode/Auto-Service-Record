import { Injectable, Logger } from '@nestjs/common'
import {
  DATE_FILTERED,
  EXPORT_FORMATS,
  EXPORT_KINDS,
  REQUIRES_VEHICLE,
  formatAllowed,
  type ExportFormat,
  type ExportKind,
} from '@autoservices/export'
import { s3FromEnv, type ObjectStorage } from '@autoservices/storage'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { QueueService } from '../../common/queue/queue.service.js'
import { DomainError, Errors } from '../../common/errors.js'

const dateStr = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/**
 * How long a signed download link lives. Deliberately short: the link is the only thing
 * standing between the object and anyone who obtains it, and an export is a copy of the
 * whole workspace (SECURITY.md).
 */
export const DOWNLOAD_LINK_TTL_SECONDS = 120

/** A cap on queued work per workspace, so one account cannot fill the queue. */
export const MAX_PENDING_PER_WORKSPACE = 3

export interface CreateExportInput {
  kind: ExportKind
  format: ExportFormat
  from?: string
  to?: string
  vehicleId?: string
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger('Exports')
  private readonly storage: ObjectStorage

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {
    this.storage = s3FromEnv()
  }

  /**
   * Accepts the request and returns immediately. The file is built by the worker: a
   * workspace with years of history produces one that takes seconds to assemble, and an
   * HTTP request that waits for it times out on exactly the accounts that need it most.
   */
  async create(workspaceId: string, userId: string, input: CreateExportInput) {
    if (!EXPORT_KINDS.includes(input.kind)) {
      throw new DomainError('VALIDATION_FAILED', `Unknown export kind "${input.kind}".`, 422)
    }
    if (!EXPORT_FORMATS.includes(input.format)) {
      throw new DomainError('VALIDATION_FAILED', `Unknown format "${input.format}".`, 422)
    }
    if (input.from && input.to && input.from > input.to) {
      throw new DomainError('VALIDATION_FAILED', 'The start date is after the end date.', 422)
    }
    /**
     * A vehicle history is a document, not a table: it is only produced as a PDF, and it
     * has to say which vehicle. Refused here rather than queued, because a job accepted
     * and then failed is worse than a request refused (EXP-002).
     */
    if (!formatAllowed(input.kind, input.format)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        input.format === 'PDF'
          ? 'Only a vehicle history is produced as a PDF.'
          : 'A vehicle history is only produced as a PDF.',
        422,
      )
    }
    if (REQUIRES_VEHICLE.has(input.kind) && !input.vehicleId) {
      throw new DomainError('VALIDATION_FAILED', 'Choose which vehicle the history is for.', 422)
    }

    const db = this.prisma.forWorkspace(workspaceId)

    if (input.vehicleId) {
      const vehicle = await db.vehicle.findFirst({
        where: { id: input.vehicleId, deletedAt: null },
        select: { id: true },
      })
      if (!vehicle) throw Errors.vehicleNotFound()
    }

    const queued = await db.exportJob.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } })
    if (queued >= MAX_PENDING_PER_WORKSPACE) {
      throw new DomainError(
        'CONFLICT',
        `You already have ${queued} exports being prepared. Wait for one to finish.`,
        409,
      )
    }

    // Date filters are recorded only where they mean something; a vehicle list has no
    // date to filter on, and storing one would describe a file that does not exist.
    const params: Record<string, string> = {}
    if (DATE_FILTERED.has(input.kind)) {
      if (input.from) params.from = input.from
      if (input.to) params.to = input.to
    }
    if (input.vehicleId) params.vehicleId = input.vehicleId

    const job = await db.exportJob.create({
      data: {
        workspaceId,
        requestedByUserId: userId,
        kind: input.kind,
        format: input.format,
        params,
        status: 'PENDING',
      },
    })

    await this.queue.enqueue(
      'reports',
      'build-export',
      { exportJobId: job.id, workspaceId },
      job.id,
    )

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'export.requested',
      resourceType: 'export_job',
      resourceId: job.id,
      metadata: { kind: input.kind, format: input.format, ...params },
    })

    return this.view(job)
  }

  async list(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.exportJob.findMany({ orderBy: { createdAt: 'desc' }, take: 25 })
    return rows.map((r: ExportRow) => this.view(r))
  }

  async get(workspaceId: string, id: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const row = await db.exportJob.findFirst({ where: { id } })
    if (!row) throw new DomainError('NOT_FOUND', 'Export could not be found.', 404)
    return this.view(row)
  }

  /**
   * Issues a signed, expiring URL — after the permission check the guard has already done,
   * and only for an export belonging to this workspace. The object key never leaves the
   * server, so a client cannot ask for a different one (SECURITY.md; HARD-003).
   */
  async downloadUrl(workspaceId: string, id: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const row = await db.exportJob.findFirst({ where: { id } })
    if (!row) throw new DomainError('NOT_FOUND', 'Export could not be found.', 404)

    if (row.status !== 'READY' || !row.objectKey) {
      throw new DomainError(
        'CONFLICT',
        row.status === 'FAILED'
          ? 'That export could not be built.'
          : 'That export is not ready yet.',
        409,
      )
    }
    if (row.expiresAt && row.expiresAt < new Date()) {
      // Mark it, so the list stops offering a download that cannot work.
      await db.exportJob.update({ where: { id: row.id }, data: { status: 'EXPIRED' } })
      throw new DomainError('CONFLICT', 'That export has expired. Request a new one.', 409)
    }

    const url = await this.storage.createDownloadUrl(
      row.objectKey,
      row.filename ?? 'export',
      DOWNLOAD_LINK_TTL_SECONDS,
    )

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'export.downloaded',
      resourceType: 'export_job',
      resourceId: row.id,
      metadata: { kind: row.kind, format: row.format },
    })

    return { url, expiresInSeconds: DOWNLOAD_LINK_TTL_SECONDS, filename: row.filename }
  }

  private view(row: ExportRow) {
    return {
      id: row.id,
      kind: row.kind,
      format: row.format,
      status: row.status,
      params: row.params ?? {},
      filename: row.filename,
      byteSize: row.byteSize,
      rowCount: row.rowCount,
      error: row.error,
      expiresAt: dateStr(row.expiresAt),
      completedAt: dateStr(row.completedAt),
      createdAt: dateStr(row.createdAt),
    }
  }
}

interface ExportRow {
  id: string
  kind: string
  format: string
  status: string
  params: unknown
  filename: string | null
  byteSize: number | null
  rowCount: number | null
  error: string | null
  expiresAt: Date | null
  completedAt: Date | null
  createdAt: Date
}
