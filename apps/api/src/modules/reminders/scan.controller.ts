import { Controller, HttpCode, Post, Headers } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service.js'
import { RemindersService } from './reminders.service.js'
import { Public } from '../../common/decorators/index.js'
import { Errors } from '../../common/errors.js'

/**
 * Internal scan trigger, called by the worker's scheduler.
 *
 * The scan crosses workspaces by design, so it lives behind a shared secret rather than
 * a user session. It is NOT part of the public API surface and is never called by a
 * browser. Authenticated with a constant-time comparison of SESSION_SECRET.
 */
@Controller('internal')
export class ReminderScanController {
  private readonly logger = new Logger('ReminderScan')

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
  ) {}

  @Public()
  @HttpCode(200)
  @Post('reminders/scan')
  async scan(@Headers('x-internal-token') token?: string) {
    const expected = process.env.SESSION_SECRET ?? ''
    if (!token || !expected || !safeEqual(token, expected)) {
      // Deliberately a 404, not a 401: an unauthenticated caller learns nothing about
      // whether this route exists.
      throw Errors.notFound('Route')
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3101'
    const workspaces = await this.prisma.raw.workspace.findMany({
      where: { deletedAt: null },
      select: { id: true },
    })

    const totals = {
      workspaces: workspaces.length,
      scanned: 0,
      created: 0,
      updated: 0,
      notified: 0,
      emailsQueued: 0,
      skippedDuplicate: 0,
    }

    for (const ws of workspaces) {
      const r = await this.reminders.scanWorkspace(ws.id, appUrl)
      totals.scanned += r.scanned
      totals.created += r.created
      totals.updated += r.updated
      totals.notified += r.notified
      totals.emailsQueued += r.emailsQueued
      totals.skippedDuplicate += r.skippedDuplicate
    }

    this.logger.log(totals, 'reminder scan complete')
    return { data: totals }
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
