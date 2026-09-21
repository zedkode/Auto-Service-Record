import { describe, it, expect, beforeEach } from 'vitest'
import {
  EmailService,
  MemoryTransport,
  renderTemplate,
  TEMPLATE_KEYS,
  createTransport,
} from './index.js'

const SAMPLE: Record<string, Record<string, unknown>> = {
  'verify-email': { displayName: 'Andrei', url: 'https://app.example.com/verify?t=abc' },
  'password-reset': { url: 'https://app.example.com/reset?t=abc' },
  'password-changed': { url: 'https://app.example.com/sign-in' },
  'workspace-invitation': {
    inviterName: 'Andrei',
    workspaceName: 'Popescu Family Garage',
    role: 'Editor',
    url: 'https://app.example.com/invitations/abc123/accept',
  },
  welcome: { displayName: 'Andrei', url: 'https://app.example.com/vehicles/new' },
  'service-due': {
    vehicleName: 'Ford Mondeo',
    registration: 'AB16 CDE',
    itemName: 'Oil service',
    dueIn: '620 miles',
    currentOdometer: '131,260 mi',
    url: 'https://app.example.com/v/1',
  },
  'service-overdue': {
    vehicleName: 'Ford Mondeo',
    itemName: 'Engine oil',
    overdueBy: '613 days',
    url: 'https://app.example.com/v/1',
  },
  'odometer-stale': {
    vehicleName: 'Ford Mondeo',
    body: "Your mileage hasn't been updated for 60 days.",
    url: 'https://app.example.com/vehicles/1?tab=mileage',
  },
  'inspection-expiry': {
    vehicleName: 'BMW 530d',
    expiresOn: '30 November 2026',
    daysRemaining: 14,
    url: 'https://app.example.com/v/2',
  },
  'insurance-expiry': {
    vehicleName: 'Van 2',
    expiresOn: '7 October 2026',
    daysRemaining: 7,
    url: 'https://app.example.com/v/3',
  },
}

describe('templates', () => {
  it.each(TEMPLATE_KEYS)('%s renders HTML and plain text', (key) => {
    const out = renderTemplate(key, SAMPLE[key]!)
    expect(out.subject.length).toBeGreaterThan(0)
    expect(out.html.length).toBeGreaterThan(100)
    expect(out.text.length).toBeGreaterThan(20)
    // A naive HTML strip is not an acceptable text alternative.
    expect(out.text).not.toContain('<')
    // No unresolved placeholders survived.
    expect(out.html).not.toMatch(/\{\{|undefined|\[object Object\]/)
    expect(out.subject).not.toMatch(/undefined/)
  })

  it.each(TEMPLATE_KEYS)('%s uses an absolute CTA URL', (key) => {
    const out = renderTemplate(key, SAMPLE[key]!)
    expect(out.text).toMatch(/https:\/\//)
  })

  it('escapes user-supplied content exactly once', () => {
    const out = renderTemplate('welcome', {
      displayName: '<script>alert(1)</script>',
      url: 'https://app.example.com',
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;')
    // Double-escaping would render the literal text "&lt;" to the reader.
    expect(out.html).not.toContain('&amp;lt;')
  })

  it('does not mangle ordinary punctuation in names', () => {
    const out = renderTemplate('welcome', {
      displayName: "O'Brien",
      url: 'https://app.example.com',
    })
    expect(out.html).not.toContain('&amp;#39;')
  })

  it('never produces "due in ... ago" for an overdue item', () => {
    const out = renderTemplate('service-overdue', SAMPLE['service-overdue']!)
    expect(out.subject).not.toMatch(/due in .*ago/i)
    expect(out.text).not.toMatch(/due in .*ago/i)
    expect(out.subject).toContain('overdue')
  })

  it('puts the vehicle and the specifics in the subject', () => {
    const out = renderTemplate('service-due', SAMPLE['service-due']!)
    expect(out.subject).toContain('Ford Mondeo')
    expect(out.subject).toContain('620 miles')
  })
})

describe('EmailService', () => {
  let transport: MemoryTransport
  let service: EmailService

  beforeEach(() => {
    transport = new MemoryTransport()
    service = new EmailService({
      transport,
      fromName: 'AutoServices',
      fromEmail: 'notifications@example.com',
    })
  })

  it('sends through the transport', async () => {
    await service.send({
      template: 'welcome',
      to: 'a@example.com',
      props: SAMPLE.welcome!,
      category: 'ACCOUNT',
      idempotencyKey: 'k1',
    })
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]!.to).toBe('a@example.com')
  })

  it('does not send the same idempotency key twice', async () => {
    const input = {
      template: 'welcome' as const,
      to: 'a@example.com',
      props: SAMPLE.welcome!,
      category: 'ACCOUNT' as const,
      idempotencyKey: 'same-key',
    }
    await service.send(input)
    const second = await service.send(input)
    expect(transport.sent).toHaveLength(1)
    expect(second.skipped).toBe('DUPLICATE')
  })

  it('redirects every recipient when an override is configured', async () => {
    const guarded = new EmailService({
      transport,
      fromName: 'A',
      fromEmail: 'n@example.com',
      overrideRecipient: 'dev@example.com',
    })
    await guarded.send({
      template: 'welcome',
      to: 'real-person@example.com',
      props: SAMPLE.welcome!,
      category: 'ACCOUNT',
      idempotencyKey: 'k2',
    })
    expect(transport.sent[0]!.to).toBe('dev@example.com')
  })
})

describe('transport selection', () => {
  it('uses MemoryTransport under NODE_ENV=test', () => {
    expect(createTransport({ NODE_ENV: 'test' } as never).name).toBe('memory')
  })

  it('falls back to SMTP rather than crashing when Resend is unconfigured', () => {
    // The platform must never fail to start because Resend is missing (task brief §21).
    const t = createTransport({ NODE_ENV: 'development', MAIL_TRANSPORT: 'resend' } as never)
    expect(t.name).toBe('smtp')
  })
})

describe('idempotency under concurrency', () => {
  it('sends once when duplicate jobs run CONCURRENTLY', async () => {
    const transport = new MemoryTransport()
    const service = new EmailService({
      transport,
      fromName: 'A',
      fromEmail: 'n@example.com',
    })
    const input = {
      template: 'welcome' as const,
      to: 'a@example.com',
      props: SAMPLE.welcome!,
      category: 'ACCOUNT' as const,
      idempotencyKey: 'concurrent-key',
    }

    // This is the case a check-then-act implementation gets wrong.
    const results = await Promise.all([
      service.send(input),
      service.send(input),
      service.send(input),
    ])

    expect(transport.sent).toHaveLength(1)
    expect(results.filter((r) => r.skipped === 'DUPLICATE')).toHaveLength(2)
  })

  it('releases the reservation when the send fails, so a retry can proceed', async () => {
    let attempts = 0
    const flaky = {
      name: 'flaky',
      async send() {
        attempts++
        if (attempts === 1) throw new Error('transient provider failure')
        return { providerMessageId: 'ok' }
      },
    }
    const service = new EmailService({
      transport: flaky,
      fromName: 'A',
      fromEmail: 'n@example.com',
    })
    const input = {
      template: 'welcome' as const,
      to: 'a@example.com',
      props: SAMPLE.welcome!,
      category: 'ACCOUNT' as const,
      idempotencyKey: 'retry-key',
    }

    await expect(service.send(input)).rejects.toThrow('transient provider failure')
    const retry = await service.send(input)
    expect(retry.skipped).toBeUndefined()
    expect(retry.providerMessageId).toBe('ok')
  })
})
