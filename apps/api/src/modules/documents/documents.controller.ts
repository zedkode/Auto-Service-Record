import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { createUploadSessionSchema, updateDocumentSchema } from '@autoservices/validation'
import { DocumentsService } from './documents.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../common/decorators/index.js'
import { RateLimit } from '../../common/guards/rate-limit.guard.js'

/**
 * DOC-101/102/103/104/106 — the document vault.
 *
 * Files never pass through this API: the client uploads directly to object storage with
 * a short-lived presigned URL, and downloads the same way. What the API owns is the
 * decision — who may upload, what may be uploaded, and who may be handed a URL.
 */
@Controller('workspaces/:workspaceId')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('documents')
  @RequirePermission('document:read')
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('vehicleId') vehicleId?: string,
    @Query('attachedToType') attachedToType?: string,
    @Query('attachedToId') attachedToId?: string,
  ) {
    const data = await this.documents.list(ws.workspaceId, {
      vehicleId,
      attachedToType,
      attachedToId,
    })
    return { data, meta: { total: data.length } }
  }

  @Post('documents/upload-session')
  // 60 an hour per workspace (SECURITY.md §8). Issuing a session costs a database row
  // and a signature, so an unbounded loop is a cheap way to fill the table.
  @RateLimit([{ limit: 60, windowSeconds: 3600, keyParam: 'workspaceId' }])
  @RequirePermission('document:write')
  async createUploadSession(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Body(zodBody(createUploadSessionSchema)) body: unknown,
  ) {
    return {
      data: await this.documents.createUploadSession(ws.workspaceId, user.id, body as never),
    }
  }

  @Post('documents/:documentId/finalise')
  @RequirePermission('document:write')
  async finalise(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('documentId') documentId: string,
  ) {
    return { data: await this.documents.finalise(ws.workspaceId, documentId, user.id) }
  }

  /** Returns a URL, not the bytes. Valid for five minutes (SECURITY.md §10). */
  @Get('documents/:documentId/download')
  @RequirePermission('document:read')
  async download(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('documentId') documentId: string,
  ) {
    return { data: await this.documents.downloadUrl(ws.workspaceId, documentId, user.id) }
  }

  @Patch('documents/:documentId')
  @RequirePermission('document:write')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('documentId') documentId: string,
    @Body(zodBody(updateDocumentSchema)) body: unknown,
  ) {
    return {
      data: await this.documents.update(ws.workspaceId, documentId, user.id, body as never),
    }
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  @RequirePermission('document:delete')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('documentId') documentId: string,
  ) {
    await this.documents.remove(ws.workspaceId, documentId, user.id)
  }
}
