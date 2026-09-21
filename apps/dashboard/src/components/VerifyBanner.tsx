import { useState } from 'react'
import { Button } from '@autoservices/ui'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

/**
 * Unverified accounts can use the app but are nudged. Verification gates workspace
 * creation, invitations and non-transactional email (PRODUCT.md §5.1), so the prompt is
 * informative rather than a hard block.
 */
export function VerifyBanner() {
  const { session } = useSession()
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (session.user.emailVerified || dismissed) return null

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-status-due-soon/30 bg-status-due-soon-subtle px-4 py-3">
      <span className="text-status-due-soon" aria-hidden="true">
        ◷
      </span>
      <p className="min-w-0 flex-1 text-[13px] text-content-primary">
        {sent ? (
          <>
            A new confirmation link is on its way to <strong>{session.user.email}</strong>.
          </>
        ) : (
          <>
            Confirm <strong>{session.user.email}</strong> to secure your account and enable
            reminders.
          </>
        )}
      </p>
      {!sent && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await api.auth.resendVerification()
              setSent(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          Resend email
        </Button>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-content-tertiary hover:text-content-primary"
      >
        ✕
      </button>
    </div>
  )
}
