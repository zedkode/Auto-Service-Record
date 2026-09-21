import type { EmailMessageRef, MailTransport, SendEmailInput, RenderedEmail } from './types.js'
import { renderTemplate } from './templates/index.js'
import { MemoryIdempotencyStore, type IdempotencyStore } from './idempotency.js'
import { MemoryTransport } from './transports/memory.transport.js'
import { SmtpTransport } from './transports/smtp.transport.js'

export interface EmailServiceOptions {
  transport: MailTransport
  fromName: string
  fromEmail: string
  replyTo?: string
  /** Non-production safety net: redirect every message here regardless of recipient. */
  overrideRecipient?: string
  /** Defaults to in-process. Inject the Redis store for cross-replica correctness. */
  idempotencyStore?: IdempotencyStore
  /** How long a reservation is held. Must exceed the job's total retry window. */
  idempotencyTtlSeconds?: number
}

export class EmailService {
  private readonly store: IdempotencyStore
  private readonly ttl: number

  constructor(private readonly options: EmailServiceOptions) {
    this.store = options.idempotencyStore ?? new MemoryIdempotencyStore()
    this.ttl = options.idempotencyTtlSeconds ?? 24 * 60 * 60
  }

  get transportName(): string {
    return this.options.transport.name
  }

  render(input: Pick<SendEmailInput, 'template' | 'props' | 'to'>): RenderedEmail {
    const out = renderTemplate(input.template, input.props)
    return {
      to: this.options.overrideRecipient ?? input.to,
      from: `${this.options.fromName} <${this.options.fromEmail}>`,
      replyTo: this.options.replyTo,
      subject: out.subject,
      html: out.html,
      text: out.text,
    }
  }

  async send(input: SendEmailInput): Promise<EmailMessageRef> {
    // Reserve BEFORE sending. Reserving afterwards leaves a window in which two
    // concurrent jobs both pass the check and the user receives two emails.
    const owned = await this.store.reserve(input.idempotencyKey, this.ttl)
    if (!owned) {
      return {
        idempotencyKey: input.idempotencyKey,
        providerMessageId: null,
        transport: this.options.transport.name,
        subject: '',
        skipped: 'DUPLICATE',
      }
    }

    const message = this.render(input)
    try {
      const result = await this.options.transport.send(message)
      return {
        idempotencyKey: input.idempotencyKey,
        providerMessageId: result.providerMessageId,
        transport: this.options.transport.name,
        subject: message.subject,
      }
    } catch (err) {
      // The send failed, so the reservation must not block the retry.
      await this.store.release(input.idempotencyKey)
      throw err
    }
  }
}

/**
 * Transport selection. The platform must never fail to start because Resend is not
 * configured — it falls back to SMTP (Mailpit) with a warning (task brief §21).
 */
export function createTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const requested = env.MAIL_TRANSPORT ?? 'smtp'

  if (env.NODE_ENV === 'test' || requested === 'memory') return new MemoryTransport()

  if (requested === 'resend') {
    if (!env.RESEND_API_KEY) {
      console.warn(
        '[email] MAIL_TRANSPORT=resend but RESEND_API_KEY is not set — falling back to SMTP. ' +
          'No mail will reach real recipients.',
      )
      return new SmtpTransport({
        host: env.SMTP_HOST ?? 'localhost',
        port: Number(env.SMTP_PORT ?? 51025),
      })
    }
    // Imported lazily so the Resend SDK is not loaded (or required) unless it is used.
    throw new Error('RESEND_TRANSPORT_LAZY')
  }

  return new SmtpTransport({
    host: env.SMTP_HOST ?? 'localhost',
    port: Number(env.SMTP_PORT ?? 51025),
  })
}

export async function createTransportAsync(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MailTransport> {
  if (env.MAIL_TRANSPORT === 'resend' && env.RESEND_API_KEY && env.NODE_ENV !== 'test') {
    const { ResendTransport } = await import('./transports/resend.transport.js')
    return new ResendTransport(env.RESEND_API_KEY)
  }
  return createTransport(env)
}

export function createEmailService(env: NodeJS.ProcessEnv = process.env): EmailService {
  return new EmailService({
    transport: createTransport(env),
    fromName: env.MAIL_FROM_NAME ?? 'AutoServices',
    fromEmail: env.MAIL_FROM_EMAIL ?? 'notifications@autoservices.local',
    replyTo: env.MAIL_REPLY_TO,
    overrideRecipient: env.MAIL_OVERRIDE_RECIPIENT || undefined,
  })
}
