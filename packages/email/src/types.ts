/**
 * Email abstraction (EMAILS.md §2, ADR-006).
 *
 * Nothing outside src/transports/resend.transport.ts may import the Resend SDK.
 * Controllers and jobs depend on EmailService, never on a provider.
 */
export type TemplateKey =
  | 'verify-email'
  | 'password-reset'
  | 'password-changed'
  | 'workspace-invitation'
  | 'welcome'
  | 'service-due'
  | 'service-overdue'
  | 'odometer-stale'
  | 'inspection-expiry'
  | 'insurance-expiry'

export type NotificationCategory =
  | 'ACCOUNT'
  | 'SECURITY'
  | 'MAINTENANCE'
  | 'INSPECTION'
  | 'INSURANCE'
  | 'TAX'
  | 'WARRANTY'
  | 'DOCUMENT'
  | 'DIGEST'
  | 'PRODUCT_UPDATES'

/** Transactional and security mail ignores preferences and cannot be disabled. */
export const CRITICAL_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
  'ACCOUNT',
  'SECURITY',
])

export interface RenderedEmail {
  to: string
  from: string
  replyTo?: string
  subject: string
  html: string
  /** Hand-written, not a naive HTML strip (EMAILS.md §3.1). */
  text: string
}

export interface TransportResult {
  providerMessageId: string
}

export interface MailTransport {
  readonly name: string
  send(message: RenderedEmail): Promise<TransportResult>
}

export interface SendEmailInput {
  template: TemplateKey
  to: string
  props: Record<string, unknown>
  category: NotificationCategory
  /** Required. There are no unkeyed sends — retries must be safe (EMAILS.md §4). */
  idempotencyKey: string
  workspaceId?: string
  userId?: string
  correlationId?: string
}

export interface EmailMessageRef {
  idempotencyKey: string
  providerMessageId: string | null
  transport: string
  subject: string
  skipped?: 'DUPLICATE' | 'SUPPRESSED' | 'OPTED_OUT'
}
