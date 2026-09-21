import { describe, expect, it } from 'vitest'
import { suppressionBlocks } from './suppression-policy.js'
import { suppressionFromEvent } from './webhook.js'

describe('suppressionBlocks', () => {
  it('blocks every category for a hard bounce, including security mail', () => {
    // The mailbox does not exist. Sending anyway cannot help the user and does hurt
    // the sending domain.
    expect(suppressionBlocks('HARD_BOUNCE', 'SECURITY')).toBe(true)
    expect(suppressionBlocks('HARD_BOUNCE', 'ACCOUNT')).toBe(true)
    expect(suppressionBlocks('HARD_BOUNCE', 'INSURANCE')).toBe(true)
  })

  it('still lets a complainer reset their password', () => {
    expect(suppressionBlocks('COMPLAINT', 'ACCOUNT')).toBe(false)
    expect(suppressionBlocks('COMPLAINT', 'SECURITY')).toBe(false)
  })

  it('blocks non-critical mail after a complaint', () => {
    for (const c of [
      'MAINTENANCE',
      'INSPECTION',
      'INSURANCE',
      'DIGEST',
      'PRODUCT_UPDATES',
    ] as const) {
      expect(suppressionBlocks('COMPLAINT', c)).toBe(true)
    }
  })

  it('treats a manual suppression as absolute', () => {
    expect(suppressionBlocks('MANUAL', 'SECURITY')).toBe(true)
  })
})

describe('suppressionFromEvent', () => {
  it('suppresses a permanent bounce', () => {
    const v = suppressionFromEvent({
      type: 'email.bounced',
      data: { bounce: { type: 'Permanent', subType: 'NoEmail' } },
    })
    expect(v).toMatchObject({ suppress: true, reason: 'HARD_BOUNCE' })
  })

  it('does NOT suppress a transient bounce', () => {
    // A full mailbox clears by itself; suppressing would silently end this owner's
    // MOT and insurance reminders.
    const v = suppressionFromEvent({
      type: 'email.bounced',
      data: { bounce: { type: 'Transient', subType: 'MailboxFull' } },
    })
    expect(v.suppress).toBe(false)
  })

  it('does NOT suppress an unclassified bounce', () => {
    const v = suppressionFromEvent({ type: 'email.bounced', data: {} })
    expect(v.suppress).toBe(false)
  })

  it('always suppresses a complaint', () => {
    const v = suppressionFromEvent({ type: 'email.complained', data: {} })
    expect(v).toMatchObject({ suppress: true, reason: 'COMPLAINT' })
  })

  it('ignores delivery and engagement events', () => {
    for (const type of ['email.delivered', 'email.opened', 'email.clicked', 'email.sent']) {
      expect(suppressionFromEvent({ type }).suppress).toBe(false)
    }
  })
})
