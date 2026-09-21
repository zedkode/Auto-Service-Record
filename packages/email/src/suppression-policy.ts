import { CRITICAL_CATEGORIES, type NotificationCategory } from './types.js'

export type SuppressionReason = 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL'

/**
 * Whether a suppression blocks this particular message (EMAILS.md §7).
 *
 * A hard bounce means the mailbox does not exist, so nothing can be delivered to it and
 * every category is blocked. A spam complaint is about the mail we chose to send, not
 * about the account: locking someone out of their own password reset because they once
 * marked a service reminder as spam would be a worse failure than the complaint. So a
 * complaint blocks everything EXCEPT the categories a user cannot unsubscribe from.
 */
export function suppressionBlocks(
  reason: SuppressionReason,
  category: NotificationCategory,
): boolean {
  if (reason === 'COMPLAINT') return !CRITICAL_CATEGORIES.has(category)
  // HARD_BOUNCE and MANUAL block unconditionally.
  return true
}
