import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service.js'
import { Public } from '../../common/decorators/index.js'

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Cheap liveness signal. Never touches a dependency. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'api', timestamp: new Date().toISOString() }
  }

  /** Event loop responsive. What the orchestrator restarts on. */
  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok', uptime: Math.round(process.uptime()) }
  }

  /** Dependency check. What the load balancer polls before sending traffic. */
  @Public()
  @Get('health/ready')
  async ready() {
    const database = await this.prisma.healthy()
    const checks = { database }
    const ok = Object.values(checks).every(Boolean)
    return {
      status: ok ? 'ok' : 'degraded',
      checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v ? 'up' : 'down'])),
      timestamp: new Date().toISOString(),
    }
  }
}
