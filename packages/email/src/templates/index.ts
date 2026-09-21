import { renderLayout, escapeHtml } from './layout.js'
import type { TemplateKey } from '../types.js'

export interface TemplateOutput {
  subject: string
  html: string
  text: string
}

/**
 * Template props are open-ended per template and validated by the caller (the reminder
 * that produced them). Values are coerced explicitly with `str()` rather than typed as
 * `any`, so a missing prop renders a documented fallback instead of "undefined".
 */
export type TemplateProps = Record<string, unknown>

const str = (v: unknown, fallback = ''): string =>
  v === null || v === undefined ? fallback : String(v)

type Renderer = (props: TemplateProps) => TemplateOutput

/**
 * Every template produces HTML AND a hand-written plain-text alternative, with an
 * absolute CTA URL (EMAILS.md §3.1).
 */
const TEMPLATES: Record<TemplateKey, Renderer> = {
  'verify-email': (p) => ({
    subject: 'Confirm your email address',
    html: renderLayout({
      preheader: 'Confirm your email to finish setting up AutoServices.',
      heading: 'Confirm your email address',
      body: `<p style="margin:0 0 12px;">Hello ${escapeHtml(str(p.displayName, 'there'))},</p>
             <p style="margin:0;">Confirm your email address to finish setting up your account. This link expires in 24 hours.</p>`,
      cta: { label: 'Confirm email address', url: str(p.url) },
      footerNote: 'If you did not create an account, you can ignore this email.',
    }),
    text: `Hello ${str(p.displayName, 'there')},

Confirm your email address to finish setting up your AutoServices account:

${str(p.url)}

This link expires in 24 hours.

If you did not create an account, you can ignore this email.`,
  }),

  'password-reset': (p) => ({
    subject: 'Reset your password',
    html: renderLayout({
      preheader: 'Reset your AutoServices password.',
      heading: 'Reset your password',
      body: `<p style="margin:0 0 12px;">We received a request to reset your password.</p>
             <p style="margin:0;">This link expires in one hour and can be used once. All your other sessions will be signed out.</p>`,
      cta: { label: 'Reset password', url: str(p.url) },
      footerNote: 'If you did not request this, you can ignore it — your password has not changed.',
    }),
    text: `Reset your AutoServices password:

${str(p.url)}

This link expires in one hour and can be used once.

If you did not request this, ignore this email — your password has not changed.`,
  }),

  'password-changed': (p) => ({
    subject: 'Your password was changed',
    html: renderLayout({
      preheader: 'Your AutoServices password was just changed.',
      heading: 'Your password was changed',
      body: `<p style="margin:0 0 12px;">Your password was changed and all other sessions were signed out.</p>
             <p style="margin:0;"><strong>If this wasn't you</strong>, reset your password immediately and contact support.</p>`,
      cta: { label: 'Sign in', url: str(p.url) },
    }),
    text: `Your AutoServices password was changed and all other sessions were signed out.

If this wasn't you, reset your password immediately: ${str(p.url)}`,
  }),

  'workspace-invitation': (p) => ({
    subject: `${str(p.inviterName)} invited you to ${str(p.workspaceName)}`,
    html: renderLayout({
      preheader: `Join ${str(p.workspaceName)} on AutoServices.`,
      heading: `You have been invited to ${str(p.workspaceName)}`,
      body: `<p style="margin:0 0 12px;"><strong>${escapeHtml(str(p.inviterName))}</strong> has invited you to join <strong>${escapeHtml(str(p.workspaceName))}</strong> as ${escapeHtml(str(p.role))}.</p>
             <p style="margin:0;">This invitation expires in 7 days.</p>`,
      cta: { label: 'Accept invitation', url: str(p.url) },
      footerNote: 'If you were not expecting this, you can ignore it.',
    }),
    text: `${str(p.inviterName)} invited you to join ${str(p.workspaceName)} on AutoServices as ${str(p.role)}.

Accept: ${str(p.url)}

This invitation expires in 7 days.`,
  }),

  welcome: (p) => ({
    subject: 'Welcome to AutoServices',
    html: renderLayout({
      preheader: 'Add your first vehicle to start building its history.',
      heading: `Welcome, ${str(p.displayName, 'there')}`,
      body: `<p style="margin:0 0 12px;">Your personal garage is ready.</p>
             <p style="margin:0;">Add your first vehicle and record its mileage — everything else is calculated from there.</p>`,
      cta: { label: 'Add your first vehicle', url: str(p.url) },
      showPreferences: true,
    }),
    text: `Welcome to AutoServices, ${str(p.displayName, 'there')}.

Your personal garage is ready. Add your first vehicle:

${str(p.url)}`,
  }),

  'service-due': (p) => ({
    // Specific beats generic — the vehicle and the distance are in the subject.
    subject: `${str(p.vehicleName)}: ${str(p.itemName)} due in ${str(p.dueIn)}`,
    html: renderLayout({
      preheader: `${str(p.itemName)} is coming up on your ${str(p.vehicleName)}.`,
      heading: `${str(p.itemName)} is due soon`,
      body: `<p style="margin:0 0 12px;">Your <strong>${escapeHtml(str(p.vehicleName))}</strong>${p.registration ? ` (${escapeHtml(str(p.registration))})` : ''} is due for ${escapeHtml(str(p.itemName))} in ${escapeHtml(str(p.dueIn))}.</p>
             <p style="margin:0;">Current mileage on record: ${escapeHtml(str(p.currentOdometer, 'not recorded'))}.</p>`,
      cta: { label: 'View maintenance', url: str(p.url) },
      showPreferences: true,
    }),
    text: `${str(p.vehicleName)}: ${str(p.itemName)} due in ${str(p.dueIn)}

Current mileage on record: ${str(p.currentOdometer, 'not recorded')}

View maintenance: ${str(p.url)}`,
  }),

  /**
   * Separate from service-due because the grammar differs: an overdue item is "overdue
   * by X", never "due in X ago". Reusing one template produced exactly that.
   */
  'service-overdue': (p) => ({
    subject: `${str(p.vehicleName)}: ${str(p.itemName)} is overdue`,
    html: renderLayout({
      preheader: `${str(p.itemName)} on your ${str(p.vehicleName)} is overdue.`,
      heading: `${str(p.itemName)} is overdue`,
      body: `<p style="margin:0 0 12px;">Your <strong>${escapeHtml(str(p.vehicleName))}</strong> is overdue for ${escapeHtml(str(p.itemName))} by <strong>${escapeHtml(str(p.overdueBy))}</strong>.</p>
             <p style="margin:0;">Leaving this much longer risks a more expensive repair.</p>`,
      cta: { label: 'View maintenance', url: str(p.url) },
      showPreferences: true,
    }),
    text: `${str(p.vehicleName)}: ${str(p.itemName)} is overdue by ${str(p.overdueBy)}.

View maintenance: ${str(p.url)}`,
  }),

  'odometer-stale': (p) => ({
    subject: `${str(p.vehicleName)}: update your mileage`,
    html: renderLayout({
      preheader: 'Your mileage is out of date, so reminders may be inaccurate.',
      heading: 'Time to update your mileage',
      body: `<p style="margin:0 0 12px;">${escapeHtml(str(p.body, 'Your mileage has not been updated for a while.'))}</p>
             <p style="margin:0;">Maintenance reminders are calculated from your latest reading, so an old number means the dates and distances we show you are guesses.</p>`,
      cta: { label: 'Update mileage', url: str(p.url) },
      showPreferences: true,
    }),
    text: `${str(p.vehicleName)}: update your mileage

${str(p.body, 'Your mileage has not been updated for a while.')}

Maintenance reminders are calculated from your latest reading.

Update it: ${str(p.url)}`,
  }),

  'inspection-expiry': (p) => ({
    subject: `${str(p.vehicleName)}: MOT expires in ${str(p.daysRemaining)} days`,
    html: renderLayout({
      preheader: `Your MOT expires on ${str(p.expiresOn)}.`,
      heading: 'Your MOT is expiring',
      body: `<p style="margin:0;">The MOT on your <strong>${escapeHtml(str(p.vehicleName))}</strong> expires on <strong>${escapeHtml(str(p.expiresOn))}</strong>, in ${escapeHtml(str(p.daysRemaining))} days.</p>`,
      cta: { label: 'View vehicle', url: str(p.url) },
      showPreferences: true,
    }),
    text: `${str(p.vehicleName)}: MOT expires on ${str(p.expiresOn)} (in ${str(p.daysRemaining)} days).

View vehicle: ${str(p.url)}`,
  }),

  'insurance-expiry': (p) => ({
    subject: `${str(p.vehicleName)}: insurance expires in ${str(p.daysRemaining)} days`,
    html: renderLayout({
      preheader: `Your policy expires on ${str(p.expiresOn)}.`,
      heading: 'Your insurance is expiring',
      body: `<p style="margin:0;">The policy on your <strong>${escapeHtml(str(p.vehicleName))}</strong> expires on <strong>${escapeHtml(str(p.expiresOn))}</strong>, in ${escapeHtml(str(p.daysRemaining))} days.</p>`,
      cta: { label: 'View vehicle', url: str(p.url) },
      showPreferences: true,
    }),
    text: `${str(p.vehicleName)}: insurance expires on ${str(p.expiresOn)} (in ${str(p.daysRemaining)} days).

View vehicle: ${str(p.url)}`,
  }),
}

export function renderTemplate(key: TemplateKey, props: TemplateProps): TemplateOutput {
  const renderer = TEMPLATES[key]
  if (!renderer) throw new Error(`Unknown email template: ${key}`)
  return renderer(props)
}

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[]
