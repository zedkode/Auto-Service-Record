import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common'
import { NotificationsService } from './notifications.service.js'
import { CurrentUser, type AuthedUser } from '../../common/decorators/index.js'

/** User-scoped, not workspace-scoped: a user's notifications span their workspaces. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.notifications.list(user.id, {
      unreadOnly: unread === 'true',
      limit: limit ? Number(limit) : undefined,
    })
    return { data, meta: { total: data.length } }
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthedUser) {
    return { data: { count: await this.notifications.unreadCount(user.id) } }
  }

  @HttpCode(200)
  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return { data: await this.notifications.markRead(user.id, id) }
  }

  @HttpCode(200)
  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthedUser) {
    return { data: await this.notifications.markAllRead(user.id) }
  }
}

@Controller('workspaces/:workspaceId/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async get(@CurrentUser() user: AuthedUser, @Param('workspaceId') workspaceId: string) {
    return { data: await this.notifications.preferences(user.id, workspaceId) }
  }

  @Put()
  async set(
    @CurrentUser() user: AuthedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { category: string; channel: string; isEnabled: boolean },
  ) {
    const data = await this.notifications.setPreference(
      user.id,
      workspaceId,
      body.category,
      body.channel,
      body.isEnabled,
    )
    return { data }
  }
}
