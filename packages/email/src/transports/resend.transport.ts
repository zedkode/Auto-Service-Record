/**
 * THE ONLY FILE PERMITTED TO IMPORT THE RESEND SDK (ADR-006, EMAILS.md §2).
 * Enforced by an ESLint no-restricted-imports rule.
 */
import { Resend } from 'resend'
import type { MailTransport, RenderedEmail, TransportResult } from '../types.js'

export class ResendTransport implements MailTransport {
  readonly name = 'resend'
  private readonly client: Resend

  constructor(apiKey: string) {
    // A test run must never be able to reach the real provider (EMAILS.md §12).
    if (process.env.NODE_ENV === 'test') {
      throw new Error('ResendTransport must not be constructed in tests. Use MemoryTransport.')
    }
    if (!apiKey) throw new Error('RESEND_API_KEY is required for the resend transport.')
    this.client = new Resend(apiKey)
  }

  async send(message: RenderedEmail): Promise<TransportResult> {
    const result = await this.client.emails.send({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (result.error) {
      throw new Error(`Resend rejected the message: ${result.error.message}`)
    }
    return { providerMessageId: result.data?.id ?? 'unknown' }
  }
}
