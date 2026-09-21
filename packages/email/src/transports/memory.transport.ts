import type { MailTransport, RenderedEmail, TransportResult } from '../types.js'

/** Test transport. Captures messages so assertions need no network. */
export class MemoryTransport implements MailTransport {
  readonly name = 'memory'
  readonly sent: RenderedEmail[] = []

  async send(message: RenderedEmail): Promise<TransportResult> {
    this.sent.push(message)
    return { providerMessageId: `memory-${this.sent.length}` }
  }

  clear(): void {
    this.sent.length = 0
  }
}
