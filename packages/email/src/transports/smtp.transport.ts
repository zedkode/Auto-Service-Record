import nodemailer, { type Transporter } from 'nodemailer'
import type { MailTransport, RenderedEmail, TransportResult } from '../types.js'

/**
 * Local development transport. Points at Mailpit, so nothing can reach a real person
 * from a developer machine (EMAILS.md §11).
 */
export class SmtpTransport implements MailTransport {
  readonly name = 'smtp'
  private readonly transporter: Transporter

  constructor(opts: { host: string; port: number; secure?: boolean }) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? false,
      // Mailpit accepts anything; no credentials exist locally.
      tls: { rejectUnauthorized: false },
    })
  }

  async send(message: RenderedEmail): Promise<TransportResult> {
    const info = await this.transporter.sendMail({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    return { providerMessageId: info.messageId }
  }
}
