import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { DomainError } from '../errors.js'

/**
 * The single place HTTP error responses are produced (API.md §5).
 * Production never leaks a stack trace, a SQL fragment or an internal path.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter')

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()
    const request = ctx.getRequest<FastifyRequest>()
    const requestId = (request as { correlationId?: string }).correlationId ?? 'unknown'

    const { status, body } = this.toResponse(exception, requestId)

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request.url },
        `Unhandled error on ${request.method} ${request.url}`,
      )
    }

    void reply.status(status).send(body)
  }

  private toResponse(exception: unknown, requestId: string) {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            requestId,
            ...(exception.details ? { details: exception.details } : {}),
          },
        },
      }
    }

    if (exception instanceof ZodError) {
      return {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request contains invalid fields.',
            requestId,
            details: exception.issues.map((i) => ({
              field: i.path.join('.'),
              code: i.code.toUpperCase(),
              message: i.message,
            })),
          },
        },
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse()
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message)
      return {
        status,
        body: {
          error: {
            code: status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : 'CONFLICT',
            message: Array.isArray(message) ? message.join(', ') : message,
            requestId,
          },
        },
      }
    }

    // Unknown failure: log the detail, send a generic message.
    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong. Please try again.',
          requestId,
          ...(this.isProduction
            ? {}
            : { debug: exception instanceof Error ? exception.message : String(exception) }),
        },
      },
    }
  }
}
