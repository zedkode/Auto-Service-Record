import { randomUUID } from 'node:crypto'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { NestFactory } from '@nestjs/core'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import { AppModule } from './app.module.js'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js'
import { requestContext } from './common/context/request-context.js'

export interface BootstrapOptions {
  sessionSecret: string
  corsOrigins: string[]
  isProduction: boolean
  logger?: false | ('error' | 'warn' | 'log' | 'debug' | 'verbose')[]
}

/**
 * Builds the application exactly as production does. Tests use this too, so a guard,
 * filter or plugin can never be present in one and missing in the other.
 */
export async function createApp(opts: BootstrapOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: true })
  const fastify = adapter.getInstance()

  fastify.addHook('onRequest', (req, reply, done) => {
    const incoming = req.headers['x-request-id']
    const correlationId =
      (typeof incoming === 'string' && incoming.length <= 200 ? incoming : null) ?? randomUUID()
    ;(req as unknown as { correlationId: string }).correlationId = correlationId
    void reply.header('x-request-id', correlationId)
    requestContext.run({ correlationId }, done)
  })

  // Cast: plugin generics do not line up with the Nest adapter's FastifyInstance
  // type parameters. The runtime contract is correct.
  await fastify.register(fastifyCookie as never, { secret: opts.sessionSecret })
  await fastify.register(fastifyCors as never, {
    origin: opts.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // x-internal-token is used by the admin console's operational endpoints.
    allowedHeaders: ['content-type', 'x-request-id', 'x-internal-token'],
    exposedHeaders: ['x-request-id'],
  })

  // Signature verification needs the EXACT bytes that were signed, so the raw body is
  // captured before JSON parsing. Scoped to the webhook route to avoid retaining bodies
  // for every request (SECURITY.md §11).
  fastify.addHook('preParsing', (req, _reply, payload, done) => {
    if (!req.url.startsWith('/api/v1/webhooks/')) return done(null, payload)
    const chunks: Buffer[] = []
    payload.on('data', (chunk: Buffer) => chunks.push(chunk))
    payload.on('end', () => {
      ;(req as unknown as { rawBody: string }).rawBody = Buffer.concat(chunks).toString('utf8')
    })
    done(null, payload)
  })

  fastify.addHook('onSend', (_req, reply, payload, done) => {
    void reply.headers({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    })
    done(null, payload)
  })

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: opts.logger ?? ['error', 'warn', 'log'],
  })

  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new AllExceptionsFilter(opts.isProduction))
  app.enableShutdownHooks()
  return app
}
