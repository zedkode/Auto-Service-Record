import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

/**
 * Validates and NARROWS the payload using the shared schemas in @autoservices/validation.
 * Unknown properties are rejected by the schemas rather than silently stripped — a typo
 * in a filter that quietly returns everything is a data-leak-shaped bug (API.md §4).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    // Throws ZodError, which the exception filter renders as VALIDATION_FAILED.
    return this.schema.parse(value)
  }
}

export const zodBody = (schema: ZodType) => new ZodValidationPipe(schema)
